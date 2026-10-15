import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ownUploadPublicId } from '@/lib/roles/own-upload';
import { scrubPublicWork, PRIVATE_EVIDENCE_FIELDS } from '@/lib/roles/blind';
import { isPayFastWebhookOpen } from '@/lib/payments/payfast-gate';
import { evidencePhotoList } from '@/lib/disputes/report';

// Fixes for the security re-check of 2026-10-15 (the repo went public).
// Migration 094 has the database side.

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), 'utf8');
const ME = '11111111-2222-4333-8444-555555555555';
const VICTIM = '99999999-8888-4777-8666-555555555555';
const CLOUD = 'tvcloud';
const ROOT = 'thabangvision_usecase/users';

describe('M3: an own upload is judged from the URL path, never the client public_id', () => {
  it('accepts the person\'s own Cloudinary upload and derives the public id', () => {
    expect(ownUploadPublicId(`https://res.cloudinary.com/${CLOUD}/image/upload/v1712345678/${ROOT}/${ME}/roles/abc123.jpg`, ME, CLOUD))
      .toBe(`${ROOT}/${ME}/roles/abc123`);
    expect(ownUploadPublicId(`https://res.cloudinary.com/${CLOUD}/video/upload/${ROOT}/${ME}/roles/listen/x.mp4`, ME, CLOUD))
      .toBe(`${ROOT}/${ME}/roles/listen/x`);
  });

  it('refuses a victim\'s photo with my folder smuggled into the query or fragment', () => {
    const victim = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${ROOT}/${VICTIM}/roles/face.jpg`;
    expect(ownUploadPublicId(`${victim}?x=${ROOT}/${ME}/y`, ME, CLOUD)).toBeNull();
    expect(ownUploadPublicId(`${victim}#${ROOT}/${ME}/y`, ME, CLOUD)).toBeNull();
    expect(ownUploadPublicId(victim, ME, CLOUD)).toBeNull();
  });

  it('refuses other clouds, hosts, transformations, traversal and the id only as the file name', () => {
    expect(ownUploadPublicId(`https://res.cloudinary.com/othercloud/image/upload/v1/${ROOT}/${ME}/a.jpg`, ME, CLOUD)).toBeNull();
    expect(ownUploadPublicId(`https://evil.example/${CLOUD}/image/upload/v1/${ROOT}/${ME}/a.jpg`, ME, CLOUD)).toBeNull();
    expect(ownUploadPublicId(`http://res.cloudinary.com/${CLOUD}/image/upload/v1/${ROOT}/${ME}/a.jpg`, ME, CLOUD)).toBeNull();
    expect(ownUploadPublicId(`https://res.cloudinary.com/${CLOUD}/image/upload/c_fill,w_10/${ROOT}/${ME}/a.jpg`, ME, CLOUD)).toBeNull();
    expect(ownUploadPublicId(`https://res.cloudinary.com/${CLOUD}/image/upload/v1/${ROOT}/${ME}/../${VICTIM}/a.jpg`, ME, CLOUD)).toBeNull();
    expect(ownUploadPublicId(`https://res.cloudinary.com/${CLOUD}/image/upload/v1/${ROOT}/${VICTIM}/${ME}.jpg`, ME, CLOUD)).toBeNull();
    expect(ownUploadPublicId(`https://res.cloudinary.com/${CLOUD}/image/upload/v1/${ROOT}/${ME}/a.jpg`, ME, undefined)).toBeNull();
    expect(ownUploadPublicId(42, ME, CLOUD)).toBeNull();
  });

  it('both proof routes use it and write with the service role (094 revokes the browser insert)', () => {
    for (const route of ['app/api/roles/[slug]/evidence/route.ts', 'app/api/roles/offer/route.ts']) {
      const src = read(route);
      expect(src).toContain('ownUploadPublicId(');
      expect(src).not.toMatch(/url\.includes\(publicId\)/);
      expect(src).not.toMatch(/supabase\.from\('role_evidence'\)\.insert/);
    }
  });
});

describe('M1: blind profiles send only the picture of the work to the browser', () => {
  it('nulls the storage path, device, dates, notes and links back to a person', () => {
    const item = {
      id: 'e1', url: 'https://res.cloudinary.com/x/image/upload/a.jpg', kind: 'photo', album: 'Portraits',
      storage_ref: `${ROOT}/${ME}/a`, device_summary: { device: 'Phone' }, captured_at: '2026-10-01', note: 'Thandi 082',
      booking_id: 'b1', verified_at: '2026-10-02', source_production_id: 'p1', legal_code: null, on_time: true,
    };
    const out = scrubPublicWork(item);
    for (const k of PRIVATE_EVIDENCE_FIELDS) expect(out[k]).toBeNull();
    expect(out).toMatchObject({ id: 'e1', url: item.url, kind: 'photo', album: 'Portraits' });
    expect(item.storage_ref).toBe(`${ROOT}/${ME}/a`); // the input is not changed
  });

  it('buildBlind and the preview scrub their work lists', () => {
    const src = read('lib/supabase/queries/roles.ts');
    expect(src.match(/\.map\(scrubPublicWork\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('H1: the PayFast webhook is closed unless PayFast is the active provider', () => {
  it('opens only for PAYMENT_PROVIDER=payfast', () => {
    expect(isPayFastWebhookOpen({ PAYMENT_PROVIDER: 'payfast' })).toBe(true);
    expect(isPayFastWebhookOpen({ PAYMENT_PROVIDER: ' PayFast ' })).toBe(true);
    expect(isPayFastWebhookOpen({ PAYMENT_PROVIDER: 'paystack' })).toBe(false);
    expect(isPayFastWebhookOpen({ PAYMENT_PROVIDER: 'yoco' })).toBe(false);
    expect(isPayFastWebhookOpen({})).toBe(false);
  });

  it('the route checks the gate before anything else', () => {
    const src = read('app/api/webhooks/payfast/route.ts');
    const post = src.slice(src.indexOf('export async function POST'));
    expect(post.indexOf('isPayFastWebhookOpen()')).toBeGreaterThan(-1);
    expect(post.indexOf('isPayFastWebhookOpen()')).toBeLessThan(post.indexOf('validateWebhook'));
  });
});

describe('H1: PayFast notices fail closed without a passphrase or for another merchant', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock('@/lib/payfast');
  });

  async function provider() {
    vi.doMock('@/lib/payfast', () => ({
      isPayFastConfigured: () => true,
      buildPaymentData: () => ({}),
      getPayFastUrl: () => '',
      isPayFastIP: () => true,
      validateSignature: () => true,
      validateITN: async () => true,
    }));
    return (await import('@/lib/payments/payfast')).payfast;
  }

  it('refuses every notice while PAYFAST_PASSPHRASE is empty', async () => {
    vi.stubEnv('PAYFAST_PASSPHRASE', '');
    vi.stubEnv('PAYFAST_MERCHANT_ID', '10000100');
    const pf = await provider();
    const res = await pf.validateWebhook({ ip: '197.97.145.144', body: 'merchant_id=10000100&payment_status=COMPLETE&m_payment_id=x&amount_gross=1.00', headers: {} });
    expect(res.valid).toBe(false);
  });

  it('refuses a notice for another merchant account, accepts our own', async () => {
    vi.stubEnv('PAYFAST_PASSPHRASE', 'secret-pass');
    vi.stubEnv('PAYFAST_MERCHANT_ID', '10000100');
    const pf = await provider();
    const other = await pf.validateWebhook({ ip: '197.97.145.144', body: 'merchant_id=99999999&payment_status=COMPLETE&m_payment_id=x&amount_gross=1.00', headers: {} });
    expect(other.valid).toBe(false);
    const ours = await pf.validateWebhook({ ip: '197.97.145.144', body: 'merchant_id=10000100&payment_status=COMPLETE&m_payment_id=x&amount_gross=1.00', headers: {} });
    expect(ours.valid).toBe(true);
  });
});

describe('M9: the Twilio WhatsApp webhook fails closed', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('refuses a signed-looking request when the webhook URL or token is missing', async () => {
    vi.stubEnv('TWILIO_WEBHOOK_URL', '');
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'tok');
    const mod = await import('@/lib/whatsapp/twilio');
    const gw = Object.values(mod).find((v) => v && typeof v === 'object' && 'validateWebhook' in (v as object)) as
      | { validateWebhook(h: Record<string, string>, b: string): boolean }
      | undefined;
    expect(gw).toBeDefined();
    expect(gw!.validateWebhook({ 'x-twilio-signature': 'anything' }, 'From=whatsapp%3A%2B27820000000&Body=hi')).toBe(false);
  });
});

describe('M6: dispute comments carry our own photos only, with limits', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('when the cloud is known, another Cloudinary account is refused', () => {
    vi.stubEnv('CLOUDINARY_CLOUD_NAME', CLOUD);
    expect(evidencePhotoList([`https://res.cloudinary.com/${CLOUD}/image/upload/v1/a.jpg`])).toHaveLength(1);
    expect(evidencePhotoList(['https://res.cloudinary.com/someoneelse/image/upload/v1/a.jpg'])).toBeNull();
  });

  it('the comment route checks attachments, length, rate, suspension and an open dispute', () => {
    const src = read('app/api/disputes/[id]/comment/route.ts');
    expect(src).toContain('evidencePhotoList(attachments)');
    expect(src).toContain('REPORT_MAX_CHARS');
    expect(src).toContain('checkRateLimit(');
    expect(src).toContain('checkNotSuspended(');
    expect(src).toContain('LIVE_DISPUTE_STATUSES');
    expect(src).not.toContain('attachments: attachments ?? []');
  });
});

describe('other route fixes', () => {
  it('H2: the booking-requests admin page checks admin itself (it reads with the service role)', () => {
    const src = read('app/(admin)/admin/creator-requests/page.tsx');
    expect(src.indexOf('requireAdmin()')).toBeGreaterThan(-1);
    expect(src.indexOf('requireAdmin()')).toBeLessThan(src.indexOf('await getAllCrewRequests()'));
  });

  it('M7: quote PDFs are staff only, rate limited and capped', () => {
    const src = read('app/api/quotes/route.ts');
    expect(src).toContain('requireAdmin()');
    expect(src).toContain('checkRateLimit(');
    expect(src).toContain('MAX_QUOTE_ITEMS');
  });

  it('nobody books their own People profile', () => {
    const src = read('app/api/roles/requests/route.ts');
    expect(src).toContain('getMyPersonRoles(user.id)');
  });

  it('M4: the retired equipment_booking payment type never confirms', () => {
    const src = read('lib/payments/fulfil.ts');
    const branch = src.slice(src.indexOf("paymentType === 'equipment_booking'"), src.indexOf("paymentType === 'service_booking'"));
    expect(branch).not.toMatch(/status:\s*'confirmed'/);
    expect(branch).toContain('return;');
  });
});

describe('094 is in the repo with its test and rollback', () => {
  it('closes the evidence read and insert and guards orders', () => {
    const sql = read('lib/migrations/094-security-recheck.sql');
    expect(sql).toMatch(/for select to anon using/);
    expect(sql).toContain('revoke insert on public.role_evidence from anon, authenticated');
    expect(sql).toContain('orders_guard_client_update');
    expect(read('lib/migrations/094-security-recheck.test.sql')).toContain('rollback;');
    expect(read('scripts/db/rollback/094-security-recheck.sql')).toContain('commit;');
  });
});
