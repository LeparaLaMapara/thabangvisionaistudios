import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { buildSystemPrompt, fetchUserContext, peopleRules, type CachedData } from '@/lib/ubunye/system-prompt';
import { capabilityBlock } from '@/lib/ubunye/capabilities';
import { gearNotice, GEAR_CATEGORY_HELP } from '@/lib/agents/tools/search';
import { RENTAL_CATEGORIES } from '@/lib/constants';

/**
 * Slice B wiring: the prompt knows today's date and what we offer, People
 * requests reach an agent with find_people, short real requests are never
 * sent to the tool-less fast model, and the prompt carries no email or phone.
 */

const h = vi.hoisted(() => ({ agent: '' as string, user: null as null | { id: string } }));
vi.mock('@/lib/agents/runtime', async (orig) => ({
  ...(await orig<typeof import('@/lib/agents/runtime')>()),
  executeAgent: async (agentId: string) => {
    h.agent = agentId;
    return new Response('ok');
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
  createAdminClient: () => ({}),
}));

const EMPTY: CachedData = { rentals: '', productions: null, press: '', careers: '', creators: 'Thandi Mokoena — Profile: /creators/1', listings: '', plans: '', services: '', crew: '' };
const SAT = new Date('2026-10-17T08:00:00Z');
const CATALOGUE = {
  ok: true,
  live: [{ slug: 'photographer-videographer', name: 'Photographer or videographer' }, { slug: 'model', name: 'Model' }],
  offered: [{ slug: 'photographer-videographer', name: 'Photographer or videographer' }],
  comingSoon: [{ slug: 'gaffer', name: 'Gaffer (lighting)' }, { slug: 'editor', name: 'Editor' }],
};

describe('system prompt: today and what we offer', () => {
  it('carries today\'s date, weekday and time in Johannesburg from the server clock', () => {
    const p = buildSystemPrompt(EMPTY, null, { smart_productions: true, roles_v1: true }, SAT);
    expect(p).toContain('===== TODAY =====');
    expect(p).toContain('Today is Saturday 17 October 2026 (2026-10-17), and the time is 10:00 in South Africa (Africa/Johannesburg)');
  });

  it('is rebuilt per request: a later clock gives a later date, even with the same cached platform data', () => {
    const a = buildSystemPrompt(EMPTY, null, { smart_productions: true, roles_v1: true }, SAT);
    const b = buildSystemPrompt(EMPTY, null, { smart_productions: true, roles_v1: true }, new Date('2026-10-18T08:00:00Z'));
    expect(a).toContain('Saturday 17 October 2026');
    expect(b).toContain('Sunday 18 October 2026');
  });

  it('lists live, empty and coming-soon roles, gear categories, the studio, and the rule for anything else', () => {
    const block = capabilityBlock(CATALOGUE, true);
    expect(block).toContain('People you can book now: Photographer or videographer.');
    expect(block).toContain('People roles open but with nobody listed yet: Model.');
    expect(block).toContain('People roles coming soon (not bookable yet): Gaffer (lighting), Editor.');
    for (const c of RENTAL_CATEGORIES.filter((x) => x.value !== 'studios')) expect(block).toContain(`(${c.value})`);
    expect(block).toContain('Studio:');
    expect(block).toMatch(/shares or investing/);
    expect(block).toMatch(/Do not invent a workflow/);
    const p = buildSystemPrompt({ ...EMPTY, capabilities: block }, null, { smart_productions: true, roles_v1: true }, SAT);
    expect(p).toContain(block);
  });

  it('People rules: use find_people, link to the profile, never quote a rate yourself', () => {
    const rules = peopleRules();
    expect(rules).toContain('call find_people');
    expect(rules).toContain('NEVER invent, estimate or quote a rate');
    expect(rules).toContain('reply within 1 working day');
    expect(rules).not.toMatch(/Do not search for, compare or book/);
    expect(rules).not.toMatch(/—/); // no em dashes in the new text
  });

  it('with People on, no creator names reach the prompt (People is blind)', () => {
    expect(buildSystemPrompt(EMPTY, null, { smart_productions: true, roles_v1: true }, SAT)).not.toContain('Thandi Mokoena');
    expect(buildSystemPrompt(EMPTY, null, { smart_productions: true }, SAT)).toContain('Thandi Mokoena');
  });
});

describe('user context: no email or phone in the prompt', () => {
  it('reads only the name and status, never auth email or phone', async () => {
    const selects: string[] = [];
    const getUser = vi.fn(async () => ({ data: { user: { email: 'lerato@example.com' } } }));
    const builder = (rows: unknown) => {
      const b: Record<string, unknown> = {};
      b.select = (cols: string) => { selects.push(cols); return b; };
      for (const m of ['eq', 'order', 'limit', 'is']) b[m] = () => b;
      b.single = async () => ({ data: { display_name: 'Lerato', is_verified: false, phone: '0821234567' } });
      b.then = (r: (v: unknown) => unknown) => r({ data: rows });
      return b;
    };
    const ctx = await fetchUserContext({ auth: { getUser }, from: () => builder([]) }, 'u1');
    expect(ctx).toContain('Name: Lerato');
    expect(ctx).not.toMatch(/Email|Phone|lerato@example\.com|0821234567/);
    expect(getUser).not.toHaveBeenCalled();
    expect(selects[0]).not.toMatch(/phone/);
  });
});

describe('model routing: short real requests keep their tools', () => {
  beforeEach(() => {
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test-key');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('greetings and thanks go to the fast tier; short requests do not', async () => {
    const { routeQuery } = await import('@/lib/ai');
    for (const t of ['hi', 'Hello!', 'howzit', 'thanks', 'ok']) expect(routeQuery(t).tier).toBe('fast');
    for (const t of ['photographer tomorrow jhb', 'can you help me buy shares?', 'makeup artist soweto', 'need a driver sat', 'sony a7 friday']) {
      expect(routeQuery(t).tier).toBe('smart');
    }
  });
});

describe('chat route: People requests reach an agent with find_people', () => {
  const chat = (text: string) =>
    new NextRequest('http://localhost/api/ubunye-chat', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', parts: [{ type: 'text', text }] }] }),
      headers: { 'content-type': 'application/json' },
    });

  beforeEach(() => {
    h.agent = '';
    h.user = null;
  });

  it('the graduation sentence goes to the assistant', async () => {
    const { POST } = await import('@/app/api/ubunye-chat/route');
    await POST(chat('I need a photographer in Johannesburg tomorrow for my graduation'));
    expect(h.agent).toBe('assistant');
  });

  it('portfolio or rate words no longer send a guest to an agent with no tools (and no guest allowance)', async () => {
    const { POST } = await import('@/app/api/ubunye-chat/route');
    await POST(chat('I need a photographer for my portfolio shoot tomorrow'));
    expect(h.agent).toBe('assistant');
    await POST(chat('what should I charge as a make-up artist'));
    expect(h.agent).toBe('assistant');
  });

  it('a signed-in "book a photographer" goes to the booking agent, which also has find_people', async () => {
    h.user = { id: 'u1' };
    const { POST } = await import('@/app/api/ubunye-chat/route');
    await POST(chat('book a photographer for saturday'));
    expect(h.agent).toBe('booking');
  });

  it('find_people is registered for the assistant and the booking agent when People is on, and never commits anything', async () => {
    const { getToolsForAgent } = await import('@/lib/agents/runtime');
    const on = { smart_productions: true, roles_v1: true };
    const assistant = getToolsForAgent('assistant', {}, false, on);
    const booking = getToolsForAgent('booking', {}, true, on, false, 'c1');
    expect(assistant.find_people).toBeDefined();
    expect(booking.find_people).toBeDefined();
    expect(assistant.search_creators).toBeUndefined();
    expect(getToolsForAgent('assistant', {}, false, { smart_productions: true, roles_v1: false }).find_people).toBeUndefined();
    expect(Object.keys(assistant).join(' ')).not.toMatch(/refund|payout|approve|commit|transfer|send_request/);
  });
});

describe('search_gear: real categories and the 48-hour notice', () => {
  it('describes the real rental category slugs', () => {
    for (const c of RENTAL_CATEGORIES) expect(GEAR_CATEGORY_HELP).toContain(c.value);
    expect(GEAR_CATEGORY_HELP).not.toMatch(/grip-support|drones|accessories/);
  });

  it('tomorrow is too soon for gear, with a prefilled WhatsApp link; next week is fine', () => {
    const soon = gearNotice('tomorrow', SAT)!;
    expect(soon).toMatchObject({ start_date: '2026-10-18', too_soon: true });
    expect(soon.message).toMatch(/48 hours' notice/);
    expect(soon.whatsapp_url).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
    expect(gearNotice('2026-10-26', SAT)).toMatchObject({ too_soon: false, message: null });
    expect(gearNotice(undefined, SAT)).toBeNull();
  });
});
