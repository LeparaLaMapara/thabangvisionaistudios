import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ─── /api/contact tests ─────────────────────────────────────────────────────

// Mock the email module so the route never tries to actually send email
vi.mock('@/lib/email', () => ({
  isEmailConfigured: () => false,
  sendContactNotification: vi.fn(),
}));

// Mock checkRateLimit so contact tests don't hit the in-memory rate limiter
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    checkRateLimit: vi.fn().mockReturnValue(true),
  };
});

async function callContactRoute(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/contact/route');
  const req = new NextRequest('http://localhost:3000/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req);
}

describe('/api/contact', () => {
  it('returns 400 when name is missing', async () => {
    const res = await callContactRoute({
      email: 'a@b.com',
      message: 'hello',
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/required/i);
  });

  it('returns 400 when email is missing', async () => {
    const res = await callContactRoute({
      name: 'Test',
      message: 'hello',
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/required/i);
  });

  it('returns 400 when message is missing', async () => {
    const res = await callContactRoute({
      name: 'Test',
      email: 'a@b.com',
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/required/i);
  });

  it('returns 400 for invalid email format', async () => {
    const res = await callContactRoute({
      name: 'Test',
      email: 'not-an-email',
      message: 'hello',
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid email/i);
  });

  it('returns success for valid payload', async () => {
    const res = await callContactRoute({
      name: 'Test User',
      email: 'test@example.com',
      message: 'Hello from tests',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it('silently accepts honeypot submissions (returns success)', async () => {
    const res = await callContactRoute({
      name: 'Bot',
      email: 'bot@spam.com',
      message: 'spam',
      _hp_company: 'http://spam.com', // honeypot field
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });
});

// ─── /api/gemini tests ──────────────────────────────────────────────────────

// Mock Supabase server client so the gemini route doesn't call cookies()
const mockSupabaseFrom = vi.fn().mockReturnValue({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: null, error: null }),
  insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  update: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
});

const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: null },
  error: null,
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
  }),
}));

// Mock the AI provider
vi.mock('@/lib/ai', () => ({
  ai: {
    isConfigured: vi.fn().mockReturnValue(false),
    name: 'mock-ai',
    sendMessage: vi.fn(),
  },
}));

describe('/api/gemini', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it('returns 400 for empty prompt (guest user)', async () => {
    const mod = await import('@/app/api/gemini/route');
    const req = new NextRequest('http://localhost:3000/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    });
    const res = await mod.POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/prompt/i);
  });

  it('returns 400 for invalid JSON body', async () => {
    const mod = await import('@/app/api/gemini/route');
    const req = new NextRequest('http://localhost:3000/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    const res = await mod.POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 500 when AI provider is not configured', async () => {
    const mod = await import('@/app/api/gemini/route');
    const req = new NextRequest('http://localhost:3000/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    });
    const res = await mod.POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/ai provider/i);
  });
});
