// @vitest-environment node
/**
 * The one email signature (lib/email/signature.ts): every template carries it
 * exactly once, and buildGmailMessage adds it to anything that lacks it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SIGNATURE_HTML,
  SIGNATURE_TEXT,
  stripOldTextSignOff,
  withHtmlSignature,
  withTextSignature,
} from '@/lib/email/signature';
import { buildGmailMessage } from '@/lib/email/gmail';
import { contentFromText, nudgeContent, renderEmail, tailoredTemplate } from '@/lib/engagement/templates';
import { welcomeTemplate } from '@/lib/greetings/welcome';
import { answerReminderEmail, newPaidJobEmail } from '@/lib/bookings/creator-job-emails';

const sent: Record<string, unknown>[] = [];

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (m: Record<string, unknown>) => {
        sent.push(m);
        return {};
      },
    }),
  },
}));

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The signature is there once, and no old sign-off survives. */
function expectSignedOnce(text: string, html?: string) {
  expect(count(text, 'The ThabangVision team')).toBe(1);
  expect(text).toContain(SIGNATURE_TEXT);
  expect(text).not.toMatch(/— ThabangVision\s*$/);
  expect(text).not.toMatch(/\nThank you,\nThabangVision/);
  if (html !== undefined) {
    expect(count(html, 'The ThabangVision team')).toBe(1);
    expect(html).toContain('<a href="https://www.thabangvision.com"');
    expect(html).toContain('>www.thabangvision.com</a>');
    expect(html).not.toContain('<p>— ThabangVision</p>');
  }
}

describe('signature', () => {
  it('reads exactly as the owner wrote it', () => {
    expect(SIGNATURE_TEXT).toBe('Warm regards,\nThe ThabangVision team\nwww.thabangvision.com');
    expect(SIGNATURE_HTML).toBe(
      '<p>Warm regards,<br>The ThabangVision team<br><a href="https://www.thabangvision.com">www.thabangvision.com</a></p>',
    );
  });
});

describe('safety net in buildGmailMessage', () => {
  it('adds the signature to a text and html body that lack it', () => {
    const m = buildGmailMessage({ to: 'a@b.co', subject: 's', text: 'Hello.', html: '<p>Hello.</p>' }, 'f@x.co');
    expect(m.text).toBe(`Hello.\n\n${SIGNATURE_TEXT}`);
    expect(m.html).toBe(`<p>Hello.</p>\n${SIGNATURE_HTML}`);
  });

  it('puts the html signature before </body>', () => {
    const html = withHtmlSignature('<html><body><p>Hi</p></body></html>');
    expect(html).toBe(`<html><body><p>Hi</p>${SIGNATURE_HTML}\n</body></html>`);
  });

  it('does not duplicate a signature that is already there', () => {
    const text = `Hi\n\n${SIGNATURE_TEXT}`;
    const html = `<p>Hi</p>${SIGNATURE_HTML}`;
    const m = buildGmailMessage({ to: 'a@b.co', subject: 's', text, html }, 'f@x.co');
    expect(m.text).toBe(text);
    expect(m.html).toBe(html);
    expect(withTextSignature(withTextSignature('x'))).toBe(withTextSignature('x'));
  });

  it('leaves html out when none was given', () => {
    const m = buildGmailMessage({ to: 'a@b.co', subject: 's', text: 't' }, 'f@x.co');
    expect(m).not.toHaveProperty('html');
    expectSignedOnce(m.text as string);
  });

  it.each([
    ['plain name', 'Your gear is back.\n\nThabangVision'],
    ['thank you', 'Your payout was sent.\n\nThank you,\nThabangVision'],
    ['dash', 'Account suspended.\n\n— ThabangVision'],
    ['dash line, then address', 'Request received.\n\n—\nThabangVision\nhttps://www.thabangvision.com'],
    ['name and email', 'A message.\n\nThabangVision\nhello@thabangvision.com'],
    ['first-name sign-off', 'Welcome.\n\nThabang, ThabangVision'],
  ])('replaces an old sign-off (%s) instead of adding a second one', (_label, text) => {
    const out = withTextSignature(text);
    expectSignedOnce(out);
    expect(out.endsWith(SIGNATURE_TEXT)).toBe(true);
    expect(count(out, 'ThabangVision')).toBe(1);
  });

  it('keeps a sentence that only mentions the name', () => {
    const text = 'Thank you for choosing ThabangVision!';
    expect(stripOldTextSignOff(text)).toBe(text);
    expect(withTextSignature(text)).toBe(`${text}\n\n${SIGNATURE_TEXT}`);
  });
});

describe('gmail templates', () => {
  beforeEach(() => {
    sent.length = 0;
    vi.stubEnv('GMAIL_USER', 'studio@example.com');
    vi.stubEnv('GMAIL_APP_PASSWORD', 'abcd efgh ijkl mnop');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('each one ends with the signature once, in text and html', async () => {
    vi.resetModules();
    const { gmail } = await import('@/lib/email/gmail');
    await gmail.sendContactNotification({ name: 'A', email: 'a@b.co', subject: 'S', message: 'M' });
    await gmail.sendVerificationApproved({ email: 'a@b.co', displayName: 'A' });
    await gmail.sendVerificationRejected({ email: 'a@b.co', displayName: 'A', reason: 'Blurry' });
    await gmail.sendBookingConfirmation({ email: 'a@b.co', rentalTitle: 'Camera', startDate: '1', endDate: '2', total: 10, currency: 'ZAR' });
    await gmail.sendAccountSuspended({ email: 'a@b.co', displayName: 'A', reason: 'R', supportEmail: 'support@thabangvision.com' });
    await gmail.sendAccountReinstated({ email: 'a@b.co', displayName: 'A' });
    await gmail.sendDisputeFiled({ email: 'a@b.co', displayName: 'A', disputeType: 'damage', disputeId: 'abcdef123456', role: 'filer' });
    await gmail.sendDisputeResolved({ email: 'a@b.co', displayName: 'A', disputeType: 'damage', resolution: 'refund' });
    expect(sent).toHaveLength(8);
    for (const m of sent) expectSignedOnce(m.text as string, m.html as string);
  });
});

describe('lifecycle emails (renderEmail)', () => {
  const opts = { baseUrl: 'https://www.thabangvision.com', unsubscribeUrl: 'https://www.thabangvision.com/u/x', why: 'service' as const };

  it('nudge, tailored and welcome all carry the signature once, above the footer', () => {
    const contents = [
      nudgeContent({ reason: 'cart', nudge: 1, firstName: 'Naledi', intent: 'rent', cartItems: 2 }),
      tailoredTemplate({
        userId: 'u', firstName: 'Naledi', role: 'renter', intent: 'rent', area: null, skills: [], specializations: [],
        yearsExperience: null, bio: null, portfolioItems: 0, hasAvatar: false, publishedListings: 0, draftListings: 0,
        listingTitles: [], bookingsAsClient: 0, gigs: 0, categories: [],
      } as never),
      contentFromText('Welcome', welcomeTemplate({ firstName: 'Naledi', method: 'email', activity: {
        intent: 'rent', emailConfirmed: true, verification: 'none', cartItems: 0, gearBookings: 0, serviceBookings: 0, ubunyeChats: 0,
      } }).body),
    ];
    for (const c of contents) {
      const r = renderEmail(c, opts);
      expectSignedOnce(r.text, r.html);
      expect(r.text.indexOf('The ThabangVision team')).toBeLessThan(r.text.indexOf('Stop these emails'));
      expect(r.html.indexOf('The ThabangVision team')).toBeLessThan(r.html.indexOf('Stop these emails'));
      // The old first-name sign-off is gone.
      expect(r.text).not.toMatch(/\n\S+, ThabangVision\n/);
    }
  });

  it('an old welcome draft signed "Thabang, ThabangVision" is sent with only the signature', () => {
    const c = contentFromText('Welcome', 'Hi,\n\nThank you for joining.\n\nThabang, ThabangVision');
    expect(c.paragraphs).toEqual(['Hi,', 'Thank you for joining.']);
    const r = renderEmail(c, opts);
    expectSignedOnce(r.text, r.html);
    expect(r.text).not.toContain('Thabang, ThabangVision');
  });

  it('the plain-text welcome (no unsubscribe secret) is signed once through the safety net', () => {
    const body = welcomeTemplate({ firstName: null, method: 'google', activity: {
      intent: null, emailConfirmed: true, verification: 'none', cartItems: 0, gearBookings: 0, serviceBookings: 0, ubunyeChats: 0,
    } }).body;
    const m = buildGmailMessage({ to: 'a@b.co', subject: 's', text: body }, 'f@x.co');
    expectSignedOnce(m.text as string);
  });
});

describe('creator job emails', () => {
  const job = { reference: 'SB-1', project_category: 'Wedding', creator_amount: 2550, paid_at: '2026-10-14T08:00:00Z', created_at: '2026-10-14T08:00:00Z' };
  it('new paid job and reminder are signed once', () => {
    for (const e of [newPaidJobEmail(job as never, 'https://x'), answerReminderEmail(job as never, 'https://x')]) {
      expectSignedOnce(e.text);
      expect(e.text.endsWith(SIGNATURE_TEXT)).toBe(true);
      expectSignedOnce(buildGmailMessage({ to: 'a@b.co', subject: e.subject, text: e.text }, 'f@x.co').text as string);
    }
  });
});
