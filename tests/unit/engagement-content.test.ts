import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  hasDash,
  nudgeContent,
  renderEmail,
  stripDashes,
  tailoredSteps,
  tailoredTemplate,
  type TailoredProfile,
} from '@/lib/engagement/templates';
import {
  signUnsubscribe,
  unsubscribeHeaders,
  unsubscribePageUrl,
  verifyUnsubscribe,
} from '@/lib/engagement/unsubscribe';
import { buildGmailMessage } from '@/lib/email/gmail';
import type { NudgeReason } from '@/lib/engagement/types';

const UID = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const SECRET = 'k'.repeat(48);

const REASONS: NudgeReason[] = [
  'cart', 'listing_draft', 'onboarding_step_1', 'onboarding_step_2', 'onboarding_step_3', 'onboarding_step_4',
  'id_rejected', 'id_not_started', 'intent_only',
];

describe('nudge emails', () => {
  it('every one has a subject, a link to the exact next step, and no dashes', () => {
    for (const reason of REASONS) {
      for (const nudge of [1, 2]) {
        const c = nudgeContent({ reason, nudge, firstName: 'Sipho', intent: 'rent', cartItems: 2 });
        expect(c.subject.length).toBeGreaterThan(5);
        expect(c.cta?.href.startsWith('/')).toBe(true);
        const all = [c.subject, c.preheader, ...c.paragraphs, ...(c.closing ?? []), c.cta?.label ?? ''].join(' ');
        expect(hasDash(all), `${reason} ${nudge}`).toBe(false);
        expect(c.paragraphs[0]).toBe('Hi Sipho,');
      }
    }
  });
  it('creator setup names the step and links to it', () => {
    const c = nudgeContent({ reason: 'onboarding_step_3', nudge: 1, firstName: null, intent: 'supply', cartItems: 0 });
    expect(c.subject).toContain('Step 3 of 4');
    expect(c.paragraphs.join(' ')).toContain('Bio and review');
    expect(c.cta).toEqual({ label: 'Continue with step 3', href: '/onboarding' });
  });
  it('the second nudge says it is the last', () => {
    const one = nudgeContent({ reason: 'cart', nudge: 1, firstName: null, intent: null, cartItems: 1 });
    const two = nudgeContent({ reason: 'cart', nudge: 2, firstName: null, intent: null, cartItems: 1 });
    expect((one.closing ?? []).join(' ')).not.toContain('last reminder');
    expect((two.closing ?? []).join(' ')).toContain('last reminder');
  });
  it('intent only: tailored to what they came for', () => {
    expect(nudgeContent({ reason: 'intent_only', nudge: 1, firstName: null, intent: 'hire', cartItems: 0 }).cta?.href).toBe('/studio');
    expect(nudgeContent({ reason: 'intent_only', nudge: 1, firstName: null, intent: 'list', cartItems: 0 }).cta?.href).toBe('/dashboard/listings');
  });
});

describe('the layout', () => {
  const c = nudgeContent({ reason: 'cart', nudge: 1, firstName: '<b>Zola</b>', intent: 'rent', cartItems: 1 });
  const r = renderEmail(c, { baseUrl: 'https://site.example', unsubscribeUrl: 'https://site.example/email-preferences?u=x&t=y', why: 'service' });
  it('dark, gold accent, absolute links, unsubscribe in both parts', () => {
    expect(r.html).toContain('#050505');
    expect(r.html).toContain('#D4A843');
    expect(r.html).toContain('href="https://site.example/cart"');
    expect(r.html).toContain('Stop these emails');
    expect(r.text).toContain('Stop these emails: https://site.example/email-preferences?u=x&t=y');
    expect(r.text).toContain('Open my cart: https://site.example/cart');
  });
  it('escapes what people typed', () => {
    expect(r.html).not.toContain('<b>Zola</b>');
    expect(r.html).toContain('&lt;b&gt;Zola&lt;/b&gt;');
  });
  it('says why they get it: service or marketing', () => {
    const m = renderEmail(c, { baseUrl: 'https://s', unsubscribeUrl: 'https://s/u', why: 'marketing' });
    expect(m.text).toContain('said yes to tips');
    expect(r.text).toContain('have an account');
  });
  it('stripDashes turns dashes into commas', () => {
    expect(stripDashes('Hi — there – friend')).toBe('Hi, there, friend');
  });
});

describe('tailored steps are worked out in code', () => {
  const base: TailoredProfile = {
    userId: UID, firstName: 'Ayanda', intent: 'supply', role: 'creator', skills: [], specializations: [], area: 'Soweto',
    bio: null, yearsExperience: null, hasAvatar: false, hasRate: false, availableForHire: false, portfolioItems: 0,
    verified: false, listingTitles: [], publishedListings: 0, draftListings: 0, bookingsAsClient: 0, gigs: 0, categories: [],
  };
  it('creator: what is missing, at most three, with links', () => {
    const s = tailoredSteps(base);
    expect(s).toHaveLength(3);
    expect(s[0].href).toBe('/dashboard/portfolio');
    expect(s.every((x) => x.href.startsWith('/'))).toBe(true);
  });
  it('creator with everything: share the profile', () => {
    const s = tailoredSteps({ ...base, bio: 'x', hasAvatar: true, hasRate: true, availableForHire: true, portfolioItems: 5, verified: true });
    expect(s).toEqual([{ label: expect.any(String), href: `/creators/${UID}` }]);
  });
  it('renter: the gear types they looked at', () => {
    const s = tailoredSteps({ ...base, role: 'renter', intent: 'rent', categories: ['lighting-power'], verified: true });
    expect(s[0].href).toBe('/rentals/lighting-power');
  });
  it('the template has no dashes', () => {
    const t = tailoredTemplate(base);
    expect(hasDash([t.subject, ...t.paragraphs, ...(t.links ?? []).map((l) => l.label)].join(' '))).toBe(false);
  });
});

describe('signed unsubscribe', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.ENGAGEMENT_SIGNING_SECRET;
    process.env.ENGAGEMENT_SIGNING_SECRET = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.ENGAGEMENT_SIGNING_SECRET;
    else process.env.ENGAGEMENT_SIGNING_SECRET = saved;
  });

  it('a token verifies for its own user only', () => {
    const t = signUnsubscribe(UID);
    expect(verifyUnsubscribe(UID, t)).toBe(true);
    expect(verifyUnsubscribe(OTHER, t)).toBe(false);
  });
  it('rejects tampering, wrong secrets and junk', () => {
    const t = signUnsubscribe(UID);
    expect(verifyUnsubscribe(UID, t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'))).toBe(false);
    expect(verifyUnsubscribe(UID, signUnsubscribe(UID, 'z'.repeat(48)))).toBe(false);
    expect(verifyUnsubscribe(UID, '')).toBe(false);
    expect(verifyUnsubscribe('not-a-uuid', t)).toBe(false);
    expect(verifyUnsubscribe(UID, null)).toBe(false);
  });
  it('without a secret (or a short one) nothing verifies', () => {
    const t = signUnsubscribe(UID);
    process.env.ENGAGEMENT_SIGNING_SECRET = 'short';
    expect(verifyUnsubscribe(UID, t)).toBe(false);
    delete process.env.ENGAGEMENT_SIGNING_SECRET;
    expect(verifyUnsubscribe(UID, t)).toBe(false);
    expect(() => signUnsubscribe(UID)).toThrow();
  });
  it('page link and one-click headers carry the signature', () => {
    const t = signUnsubscribe(UID);
    expect(unsubscribePageUrl(UID)).toContain(`/email-preferences?u=${UID}&t=${t}`);
    const h = unsubscribeHeaders(UID);
    expect(h['List-Unsubscribe']).toMatch(new RegExp(`^<https?://.+/api/engagement/unsubscribe\\?u=${UID}&t=${t}>$`));
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});

describe('email headers through the provider', () => {
  it('passes List-Unsubscribe headers on', () => {
    const msg = buildGmailMessage({ to: 'a@b.co', subject: 's', text: 't', headers: { 'List-Unsubscribe': '<https://x/y>' } }, 'from@x.co');
    expect(msg.headers).toEqual({ 'List-Unsubscribe': '<https://x/y>' });
  });
  it('refuses header injection and reserved names', () => {
    expect(() => buildGmailMessage({ to: 'a@b.co', subject: 's', text: 't', headers: { 'X-A': 'one\r\nBcc: evil@x.co' } }, 'f@x.co')).toThrow();
    expect(() => buildGmailMessage({ to: 'a@b.co', subject: 's', text: 't', headers: { Bcc: 'evil@x.co' } }, 'f@x.co')).toThrow();
    expect(() => buildGmailMessage({ to: 'a@b.co', subject: 's', text: 't', headers: { 'Bad Name': 'x' } }, 'f@x.co')).toThrow();
  });
  it('no headers key when none are given', () => {
    expect(Object.keys(buildGmailMessage({ to: 'a@b.co', subject: 's', text: 't' }, 'f@x.co'))).not.toContain('headers');
  });
});
