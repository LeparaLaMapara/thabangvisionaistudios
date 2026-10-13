import { STUDIO, RENTAL_CATEGORIES } from '@/lib/constants';
import type { Intent, NudgeReason } from './types';

/**
 * Lifecycle email content and the branded layout. Pure, so tested directly.
 *
 * House rules for every word here: plain words a first-time online buyer
 * understands, no dashes (em or en), no hype, no invented offers, one clear
 * next step with a link.
 */

export interface Link {
  label: string;
  /** A path on this site ("/cart") or a full URL. */
  href: string;
}

export interface EmailContent {
  subject: string;
  /** Short line some inboxes show after the subject. */
  preheader: string;
  paragraphs: string[];
  cta?: Link;
  /** Extra links shown as a short list (tailored steps). */
  links?: Link[];
  /** Paragraphs after the links and button, before the sign-off. */
  closing?: string[];
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Who signs our emails: the first name of the information officer. */
export function signer(): string {
  return `${STUDIO.legal.informationOfficer.name.split(' ')[0] || 'The team'}, ${STUDIO.name}`;
}

/** Any em or en dash, the house style bans them in what people read. */
export function hasDash(text: string): boolean {
  return /[\u2013\u2014]/.test(text);
}

/** Replaces dashes a model may still write with plain punctuation. */
export function stripDashes(text: string): string {
  return text.replace(/\s*[\u2013\u2014]\s*/g, ', ').replace(/,\s*,/g, ',');
}

function hi(firstName: string | null): string {
  return firstName ? `Hi ${firstName},` : 'Hi,';
}

// ─── Nudges: tailored to where they stopped ──────────────────────────────────

export const ONBOARDING_STEP_NAMES: Record<1 | 2 | 3 | 4, { name: string; todo: string }> = {
  1: { name: 'Portfolio', todo: 'add a few photos or videos of your best work' },
  2: { name: 'Skills', todo: 'choose the kinds of shoots you do' },
  3: { name: 'Bio and review', todo: 'check the short bio we suggest and save it' },
  4: { name: 'Gear', todo: 'add any gear you own, or skip this step' },
};

const INTENT_WORDS: Record<Exclude<Intent, null | 'browse'>, { want: string; cta: Link; how: string }> = {
  rent: {
    want: 'rent camera gear',
    cta: { label: 'Find gear', href: '/rentals' },
    how: `Pick what you need, choose your dates and you see the full price before you pay. You collect in ${STUDIO.location.city}.`,
  },
  hire: {
    want: 'book a photographer or videographer',
    cta: { label: 'See the packages', href: '/studio' },
    how: 'Pick a package and you see the full price before you pay.',
  },
  list: {
    want: 'list your gear for hire',
    cta: { label: 'List your gear', href: '/dashboard/listings' },
    how: 'Add a photo and we suggest the title, details and a fair daily rate. You check them and send it to us.',
  },
  supply: {
    want: 'offer your services',
    cta: { label: 'Start your setup', href: '/onboarding' },
    how: 'The setup has four short steps: your work, your skills, a short bio and any gear you own.',
  },
};

export function nudgeContent(params: {
  reason: NudgeReason;
  nudge: number;
  firstName: string | null;
  intent: Intent;
  cartItems: number;
}): EmailContent {
  const { reason, nudge, firstName, intent, cartItems } = params;
  const last = nudge >= 2 ? 'This is the last reminder we send about this.' : '';
  const reply = 'If something is not working, reply to this email and a person will help.';
  const wrap = (c: Omit<EmailContent, 'paragraphs'> & { body: string[] }): EmailContent => ({
    subject: c.subject,
    preheader: c.preheader,
    cta: c.cta,
    paragraphs: [hi(firstName), ...c.body, signer()],
    closing: [reply, ...(last ? [last] : [])],
  });

  if (reason === 'cart') {
    const items = cartItems === 1 ? '1 item' : `${cartItems} items`;
    return wrap({
      subject: nudge >= 2 ? 'Your cart is still waiting' : 'You left gear in your cart',
      preheader: `You have ${items} in your cart.`,
      body: [
        `You have ${items} in your cart. Gear is booked first come, first served, so the dates you picked may not stay open.`,
        'Open your cart to check the dates and book. You see the full price before you pay.',
      ],
      cta: { label: 'Open my cart', href: '/cart' },
    });
  }

  if (reason === 'listing_draft') {
    return wrap({
      subject: 'Your gear listing is not sent yet',
      preheader: 'One step left before we can check it.',
      body: [
        'You started listing your gear but did not send it to us yet.',
        'Open your listing, check the details and send it. We look at every listing before it goes live, and we tell you when it is up.',
      ],
      cta: { label: 'Finish my listing', href: '/dashboard/listings' },
    });
  }

  if (reason.startsWith('onboarding_step_')) {
    const step = Number(reason.slice(-1)) as 1 | 2 | 3 | 4;
    const s = ONBOARDING_STEP_NAMES[step];
    return wrap({
      subject: `Step ${step} of 4: finish setting up your creator profile`,
      preheader: `Next: ${s.name}.`,
      body: [
        `You stopped at step ${step} of 4 (${s.name}). Next, ${s.todo}.`,
        'Your work is saved, so you carry on where you left off. Once your profile is done, people can find you and book you.',
      ],
      cta: { label: `Continue with step ${step}`, href: '/onboarding' },
    });
  }

  if (reason === 'id_rejected') {
    return wrap({
      subject: 'Your ID check needs another try',
      preheader: 'New photos usually fix it.',
      body: [
        'We could not accept the photos from your ID check. This happens often, and new photos usually fix it.',
        `Take the photos in good light, with all four corners of your ID showing and nothing covering your face. A person checks it ${STUDIO.verification.reviewTime}.`,
      ],
      cta: { label: 'Try the ID check again', href: '/dashboard/verification' },
    });
  }

  if (reason === 'id_not_started') {
    const what = intent === 'list' ? 'your gear can go live' : intent === 'rent' || intent === 'hire' ? 'you can book gear' : 'people can book you';
    return wrap({
      subject: 'One step left: your ID check',
      preheader: 'About two minutes: a photo of your ID and a selfie.',
      body: [
        `Before ${what}, we check your ID once. It takes about two minutes: a photo of your ID and a selfie.`,
        `A person checks it ${STUDIO.verification.reviewTime}. We keep your documents safe and use them only for this check.`,
      ],
      cta: { label: 'Do my ID check', href: '/dashboard/verification' },
    });
  }

  // intent_only
  const words = intent && intent !== 'browse' ? INTENT_WORDS[intent] : INTENT_WORDS.rent;
  return wrap({
    subject: `Ready to ${words.want}?`,
    preheader: words.how,
    body: [`When you joined you said you want to ${words.want}. It is quick to start.`, words.how],
    cta: words.cta,
  });
}

// ─── Tailored suggestions: the facts and the fallback ────────────────────────

/** What the tailored note may be written from. Never ID, documents, banking, fraud flags, phone, email or address. */
export interface TailoredProfile {
  userId: string;
  firstName: string | null;
  intent: Intent;
  role: 'creator' | 'renter' | 'lister';
  /** Free text the person typed: untrusted, sanitised before any prompt. */
  skills: string[];
  specializations: string[];
  /** City or province only. */
  area: string | null;
  bio: string | null;
  yearsExperience: number | null;
  hasAvatar: boolean;
  hasRate: boolean;
  availableForHire: boolean;
  portfolioItems: number;
  verified: boolean;
  listingTitles: string[];
  publishedListings: number;
  draftListings: number;
  bookingsAsClient: number;
  gigs: number;
  /** Rental categories they looked at (cart) or booked. */
  categories: string[];
}

export function roleOf(p: { intent: Intent; onboardingCompleted: boolean; publishedListings: number; draftListings?: number }): TailoredProfile['role'] {
  if (p.onboardingCompleted || p.intent === 'supply') return 'creator';
  if (p.intent === 'list' || p.publishedListings > 0 || (p.draftListings ?? 0) > 0) return 'lister';
  return 'renter';
}

function categoryLabel(slug: string): string | null {
  return RENTAL_CATEGORIES.find((c) => c.value === slug)?.label.replace(/&/g, 'and') ?? null;
}

/** The concrete next steps, worked out in code (the AI explains them, it never invents them). At most 3. */
export function tailoredSteps(p: TailoredProfile): Link[] {
  const steps: Link[] = [];
  if (p.role === 'creator') {
    if (p.portfolioItems < 3) steps.push({ label: `Add ${p.portfolioItems === 0 ? 'three' : 'more'} projects to your portfolio (people book from what they can see)`, href: '/dashboard/portfolio' });
    if (!p.hasAvatar) steps.push({ label: 'Add a clear profile photo', href: '/dashboard/profile' });
    if (!p.bio) steps.push({ label: 'Write two lines about the work you do', href: '/dashboard/profile' });
    if (!p.hasRate) steps.push({ label: 'Set your rates so people see a price', href: '/dashboard/pricing' });
    if (!p.availableForHire) steps.push({ label: 'Switch on "available for hire"', href: '/dashboard/profile' });
    if (!p.verified) steps.push({ label: 'Finish your ID check so you can take bookings', href: '/dashboard/verification' });
    if (steps.length === 0) steps.push({ label: 'Share your public profile with past clients', href: `/creators/${p.userId}` });
  } else if (p.role === 'lister') {
    if (p.draftListings > 0) steps.push({ label: 'Send your draft listing for review', href: '/dashboard/listings' });
    if (!p.verified) steps.push({ label: 'Finish your ID check so your gear can go live', href: '/dashboard/verification' });
    steps.push({ label: 'List another piece of gear', href: '/dashboard/listings' });
  } else {
    for (const slug of p.categories.slice(0, 2)) {
      const label = categoryLabel(slug);
      if (label) steps.push({ label: `See ${label} you can rent`, href: `/rentals/${slug}` });
    }
    if (steps.length === 0) steps.push({ label: 'See all the gear you can rent', href: '/rentals' });
    if (!p.verified) steps.push({ label: 'Do the one-time ID check so you can book', href: '/dashboard/verification' });
    if (p.intent === 'hire') steps.push({ label: 'Book a photographer or videographer', href: '/studio' });
  }
  return steps.slice(0, 3);
}

export function tailoredSubject(p: TailoredProfile): string {
  if (p.role === 'creator') return p.firstName ? `${p.firstName}, a few ways to get your first booking` : 'A few ways to get your first booking';
  if (p.role === 'lister') return 'Getting your gear booked';
  return p.firstName ? `${p.firstName}, gear picked for you` : 'Gear picked for you';
}

/** The plain template, used when no AI provider answers or its draft fails the checks. */
export function tailoredTemplate(p: TailoredProfile): EmailContent {
  const steps = tailoredSteps(p);
  const intro =
    p.role === 'creator'
      ? 'Your profile is set up. Here is what helps most to get your first booking:'
      : p.role === 'lister'
        ? 'Thank you for listing with us. Here is what helps your gear get booked:'
        : `Your account is ready. Here is what we suggest next. You collect gear in ${STUDIO.location.city}.`;
  return {
    subject: tailoredSubject(p),
    preheader: steps[0]?.label ?? 'Your next steps',
    paragraphs: [hi(p.firstName), intro, signer()],
    links: steps,
    closing: ['If you have a question, reply to this email and a person will answer.'],
  };
}

// ─── The layout ──────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function absolute(href: string, base: string): string {
  return /^https?:\/\//.test(href) ? href : `${base}${href.startsWith('/') ? '' : '/'}${href}`;
}

/**
 * Wraps content in the brand layout (dark, gold accent) with a plain-text
 * twin. `why` is the footer line saying why they get this email.
 */
export function renderEmail(c: EmailContent, opts: { baseUrl: string; unsubscribeUrl: string; why: 'service' | 'marketing' }): RenderedEmail {
  const why =
    opts.why === 'marketing'
      ? `You get this because you said yes to tips and news from ${STUDIO.name}.`
      : `You get this because you have an account with ${STUDIO.name}.`;
  const cta = c.cta ? { label: c.cta.label, url: absolute(c.cta.href, opts.baseUrl) } : null;
  const links = (c.links ?? []).map((l) => ({ label: l.label, url: absolute(l.href, opts.baseUrl) }));

  // The last paragraph is the sign-off and goes under the links; a one-paragraph
  // body (a hand-written welcome) has none.
  const body = c.paragraphs.length > 1 ? c.paragraphs.slice(0, -1) : c.paragraphs;
  const signoff = c.paragraphs.length > 1 ? c.paragraphs[c.paragraphs.length - 1] : null;

  const text = [
    ...body.flatMap((p) => [p, '']),
    ...(links.length ? [...links.map((l, i) => `${i + 1}. ${l.label}: ${l.url}`), ''] : []),
    ...(cta ? [`${cta.label}: ${cta.url}`, ''] : []),
    ...(c.closing ?? []).flatMap((p) => [p, '']),
    ...(signoff ? [signoff, ''] : []),
    '',
    why,
    `Stop these emails: ${opts.unsubscribeUrl}`,
  ].join('\n');

  const para = (p: string) => `<p style="margin:0 0 16px 0;font-size:16px;line-height:1.6;color:#E5E5E5;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`;
  const bodyParas = body.map(para).join('');
  const sign = (c.closing ?? []).map(para).join('') + (signoff ? para(signoff) : '');
  const linkList = links.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;width:100%;">${links
        .map(
          (l, i) =>
            `<tr><td style="padding:10px 0;border-top:1px solid #262626;font-size:15px;line-height:1.5;"><span style="color:#D4A843;font-family:monospace;">${i + 1}.</span> <a href="${escapeHtml(l.url)}" style="color:#E5E5E5;text-decoration:underline;">${escapeHtml(l.label)}</a></td></tr>`,
        )
        .join('')}</table>`
    : '';
  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px 0;"><tr><td style="background:#D4A843;border-radius:6px;"><a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:14px 22px;min-height:44px;box-sizing:border-box;font-size:16px;font-weight:bold;color:#050505;text-decoration:none;">${escapeHtml(cta.label)}</a></td></tr></table>`
    : '';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${escapeHtml(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#050505;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505;"><tr><td align="center" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0E0E0E;border:1px solid #262626;border-radius:10px;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="padding:24px 28px 8px 28px;font-family:monospace;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#D4A843;">${escapeHtml(STUDIO.name)}</td></tr>
<tr><td style="padding:16px 28px 8px 28px;">${bodyParas}${linkList}${button}${sign}</td></tr>
<tr><td style="padding:16px 28px 24px 28px;border-top:1px solid #262626;font-size:12px;line-height:1.6;color:#8A8A8A;">${escapeHtml(why)}<br><a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#8A8A8A;text-decoration:underline;">Stop these emails</a></td></tr>
</table></td></tr></table></body></html>`;

  return { subject: c.subject, text, html };
}

/** A plain-text body (a welcome the owner wrote or edited) as email content. */
export function contentFromText(subject: string, body: string): EmailContent {
  const parts = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return { subject, preheader: parts[1]?.slice(0, 120) ?? '', paragraphs: parts.length ? parts : [body] };
}
