/**
 * Phase 6 security AUTH-1: the ADMIN_EMAILS break-glass granted full admin to
 * anyone holding a session under that address, confirmed or not.
 * AUTH-2 / AUTH-3: changing a role or suspending a user left their sessions
 * alive until the token expired.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ADMIN_EMAILS } from '@/lib/constants';

const OWNER = ADMIN_EMAILS[0];

let sessionUser: Record<string, unknown> | null = null;
let profileRole: string | null = 'user';
let profileThrows = false;
/** Per-id overrides; anyone else reads as { role: profileRole, not suspended }. */
const profiles: Record<string, { role?: string; is_suspended?: boolean; suspension_expires_at?: string | null }> = {};
const rpc = vi.fn<(name: string, args?: unknown) => Promise<{ data: unknown; error: null }>>(
  async (name) => ({ data: name === 'rate_limit_hit' ? true : 1, error: null }),
);
const updateUserById = vi.fn<(id: string, attrs: Record<string, unknown>) => Promise<{ error: null }>>(async () => ({ error: null }));
const updates: Array<{ table: string; values: unknown }> = [];

function builder(table: string) {
  let id = '';
  const b = {
    select: () => b,
    eq: (k: string, v: string) => { if (k === 'id') id = v; return b; },
    insert: async () => ({ error: null }),
    update: (values: unknown) => { updates.push({ table, values }); return b; },
    single: async () => {
      if (profileThrows) throw new Error('db down');
      if (table === 'profiles') {
        const o = profiles[id] ?? {};
        return { data: { id, role: o.role ?? profileRole, display_name: 'T', is_suspended: o.is_suspended ?? false, suspension_expires_at: o.suspension_expires_at ?? null }, error: null };
      }
      return { data: null, error: null };
    },
    maybeSingle: async () => b.single(),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
  };
  return b;
}

const client = {
  auth: {
    getUser: async () => ({ data: { user: sessionUser } }),
    admin: { updateUserById },
  },
  from: (t: string) => builder(t),
  rpc,
};

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client, createAdminClient: () => client }));
vi.mock('@/lib/email', () => ({ sendAccountSuspended: async () => undefined, sendAccountReinstated: async () => undefined }));
vi.mock('@/lib/supabase/profile-email', () => ({ profileWithEmail: async () => null }));

const { supabaseAuth, isBreakGlassAdmin } = await import('@/lib/auth/supabase');

describe('ADMIN_EMAILS break-glass needs a confirmed address (AUTH-1)', () => {
  beforeEach(() => {
    profileRole = 'user';
    profileThrows = false;
    for (const k of Object.keys(profiles)) delete profiles[k];
  });

  it('an UNCONFIRMED session under the admin address is not admin', async () => {
    sessionUser = { id: 'u1', email: OWNER, email_confirmed_at: null, app_metadata: {} };
    expect(await supabaseAuth.isAdmin('u1', OWNER)).toBe(false);
  });

  it('...not even when the role lookup fails (the break-glass case)', async () => {
    sessionUser = { id: 'u1', email: OWNER, email_confirmed_at: null, app_metadata: {} };
    profileThrows = true;
    expect(await supabaseAuth.isAdmin('u1', OWNER)).toBe(false);
  });

  it('a CONFIRMED owner address keeps the break-glass', async () => {
    sessionUser = { id: 'u1', email: OWNER.toUpperCase(), email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {} };
    expect(await supabaseAuth.isAdmin('u1', OWNER)).toBe(true);
  });

  it('...but fails closed when the profile cannot be read (suspension unknown; Codex P1)', async () => {
    sessionUser = { id: 'u1', email: OWNER, email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {} };
    profileThrows = true;
    expect(await supabaseAuth.isAdmin('u1', OWNER)).toBe(false);
  });

  it('a caller-supplied email is ignored; only the session user counts', async () => {
    sessionUser = { id: 'u1', email: 'someone@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {} };
    expect(await supabaseAuth.isAdmin('u1', OWNER)).toBe(false);
  });

  it('pure check', () => {
    const confirmed = { id: 'u1', email: OWNER, email_confirmed_at: '2026-01-01T00:00:00Z' };
    expect(isBreakGlassAdmin(confirmed, 'u1')).toBe(true);
    expect(isBreakGlassAdmin(confirmed, 'other-user')).toBe(false);
    expect(isBreakGlassAdmin({ ...confirmed, email_confirmed_at: undefined }, 'u1')).toBe(false);
    expect(isBreakGlassAdmin(null, 'u1')).toBe(false);
  });

  it('levels 1 and 2 are unchanged: app_metadata admin, then profiles.role admin', async () => {
    sessionUser = { id: 'u1', email: 'a@example.com', email_confirmed_at: null, app_metadata: { role: 'admin' } };
    expect(await supabaseAuth.isAdmin('u1')).toBe(true);
    sessionUser = { id: 'u1', email: 'a@example.com', email_confirmed_at: null, app_metadata: {} };
    profileRole = 'admin';
    expect(await supabaseAuth.isAdmin('u1')).toBe(true);
  });
});

describe('role change and suspension end the target user\'s sessions (AUTH-2, AUTH-3)', () => {
  beforeEach(() => {
    rpc.mockClear();
    updates.length = 0;
    // The caller is an admin through profiles.role.
    sessionUser = { id: 'admin-1', email: 'admin@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {} };
    profileRole = 'admin';
    profileThrows = false;
  });

  it('PATCH /api/admin/users/[id]/role revokes the target\'s sessions', async () => {
    const { PATCH } = await import('@/app/api/admin/users/[id]/role/route');
    const res = await PATCH(
      new NextRequest('http://localhost/api/admin/users/target/role', { method: 'PATCH', body: JSON.stringify({ role: 'user' }) }),
      { params: Promise.resolve({ id: 'target' }) },
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('admin_revoke_user_sessions', { p_user_id: 'target' });
    expect((await res.json()).sessions_revoked).toBe(true);
  });

  it('POST /api/admin/users/[id]/suspend revokes the target\'s sessions', async () => {
    const { POST } = await import('@/app/api/admin/users/[id]/suspend/route');
    profileRole = 'admin';
    const res = await POST(
      new NextRequest('http://localhost/api/admin/users/target/suspend', { method: 'POST', body: JSON.stringify({ reason: 'fraud' }) }),
      { params: Promise.resolve({ id: 'target' }) },
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('admin_revoke_user_sessions', { p_user_id: 'target' });
  });
});

describe('a suspended account is never admin, and suspension bans sign-in (Codex P1)', () => {
  const CONFIRMED = '2026-01-01T00:00:00Z';
  beforeEach(() => {
    profileRole = 'user';
    profileThrows = false;
    for (const k of Object.keys(profiles)) delete profiles[k];
    updateUserById.mockClear();
    rpc.mockClear();
  });

  it.each([
    ['profiles.role admin', { app_metadata: {} }, { role: 'admin' }],
    ['app_metadata admin', { app_metadata: { role: 'admin' } }, {}],
    ['ADMIN_EMAILS break-glass', { app_metadata: {}, email: OWNER }, {}],
  ])('%s + suspended -> not admin; requireAdmin 403', async (_label, user, profile) => {
    sessionUser = { id: 'adm', email: 'a@example.com', email_confirmed_at: CONFIRMED, ...user };
    profiles.adm = { ...profile, is_suspended: true };
    expect(await supabaseAuth.isAdmin('adm')).toBe(false);
    const res = await supabaseAuth.requireAdmin();
    expect(res.error?.status).toBe(403);
  });

  it('an expired suspension no longer blocks', async () => {
    sessionUser = { id: 'adm', email: 'a@example.com', email_confirmed_at: CONFIRMED, app_metadata: {} };
    profiles.adm = { role: 'admin', is_suspended: true, suspension_expires_at: '2020-01-01T00:00:00Z' };
    expect(await supabaseAuth.isAdmin('adm')).toBe(true);
  });

  it('suspend bans the Auth user (until the expiry when one is given, else indefinitely)', async () => {
    sessionUser = { id: 'admin-1', email: 'admin@example.com', email_confirmed_at: CONFIRMED, app_metadata: {} };
    profiles['admin-1'] = { role: 'admin' };
    const { POST } = await import('@/app/api/admin/users/[id]/suspend/route');
    const call = (body: unknown) => POST(
      new NextRequest('http://localhost/api/admin/users/target/suspend', { method: 'POST', body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: 'target' }) },
    );
    expect((await call({ reason: 'fraud' })).status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith('target', { ban_duration: '876000h' });

    updateUserById.mockClear();
    const until = new Date(Date.now() + 2 * 3600_000).toISOString();
    expect((await call({ reason: 'fraud', expires_at: until })).status).toBe(200);
    const duration = updateUserById.mock.calls[0][1].ban_duration as string;
    const seconds = Number(duration.replace(/s$/, ''));
    expect(duration).toMatch(/^\d+s$/);
    expect(Math.abs(seconds - 7200)).toBeLessThan(60);
  });

  it('reinstate lifts the ban', async () => {
    sessionUser = { id: 'admin-1', email: 'admin@example.com', email_confirmed_at: CONFIRMED, app_metadata: {} };
    profiles['admin-1'] = { role: 'admin' };
    profiles.target = { is_suspended: true };
    const { POST } = await import('@/app/api/admin/users/[id]/reinstate/route');
    const res = await POST(
      new NextRequest('http://localhost/api/admin/users/target/reinstate', { method: 'POST', body: JSON.stringify({ reason: 'appeal' }) }),
      { params: Promise.resolve({ id: 'target' }) },
    );
    expect(res.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith('target', { ban_duration: 'none' });
  });
});
