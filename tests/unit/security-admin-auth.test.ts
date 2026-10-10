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
const rpc = vi.fn<(name: string, args?: unknown) => Promise<{ data: unknown; error: null }>>(
  async (name) => ({ data: name === 'rate_limit_hit' ? true : 1, error: null }),
);
const updates: Array<{ table: string; values: unknown }> = [];

function builder(table: string) {
  const b = {
    select: () => b,
    eq: () => b,
    insert: async () => ({ error: null }),
    update: (values: unknown) => { updates.push({ table, values }); return b; },
    single: async () => {
      if (profileThrows) throw new Error('db down');
      if (table === 'profiles') return { data: { id: 'target', role: profileRole, display_name: 'T', is_suspended: false }, error: null };
      return { data: null, error: null };
    },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
  };
  return b;
}

const client = {
  auth: {
    getUser: async () => ({ data: { user: sessionUser } }),
    admin: { updateUserById: async () => ({ error: null }) },
  },
  from: (t: string) => builder(t),
  rpc,
};

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client, createAdminClient: () => client }));
vi.mock('@/lib/email', () => ({ sendAccountSuspended: async () => undefined }));
vi.mock('@/lib/supabase/profile-email', () => ({ profileWithEmail: async () => null }));

const { supabaseAuth, isBreakGlassAdmin } = await import('@/lib/auth/supabase');

describe('ADMIN_EMAILS break-glass needs a confirmed address (AUTH-1)', () => {
  beforeEach(() => {
    profileRole = 'user';
    profileThrows = false;
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

  it('a CONFIRMED owner address keeps the break-glass (no lockout on a DB fault)', async () => {
    sessionUser = { id: 'u1', email: OWNER.toUpperCase(), email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {} };
    profileThrows = true;
    expect(await supabaseAuth.isAdmin('u1', OWNER)).toBe(true);
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
