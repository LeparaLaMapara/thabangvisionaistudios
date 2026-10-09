import { STUDIO, ADMIN_EMAILS } from '@/lib/constants';

/**
 * Welcoming new people (TASK-065). Pure: no database, no AI, no email, so the
 * rules are tested directly. lib/greetings/process.ts does the I/O.
 *
 * Privacy rule: the only personal data that goes into a draft, or to an AI
 * provider, is the person's first name and what they have done on the site.
 * Never their email, surname, phone, ID or anything they typed.
 */

export type SignupMethod = 'google' | 'email';

/** What a new person has done since signing up. Counts, not content. */
export interface SignupActivity {
  intent: 'rent' | 'hire' | 'list' | 'supply' | 'browse' | null;
  emailConfirmed: boolean;
  verification: 'none' | 'pending' | 'verified' | 'rejected';
  cartItems: number;
  gearBookings: number;
  serviceBookings: number;
  ubunyeChats: number;
}

/** Everything a welcome may be written from. */
export interface WelcomeContext {
  firstName: string | null;
  method: SignupMethod;
  activity: SignupActivity;
}

export interface WelcomeDraft {
  subject: string;
  body: string;
}

/** The owner's own and test accounts are never welcomed. */
export function isInternalAccount(email: string | null | undefined): boolean {
  if (!email) return true;
  const e = email.toLowerCase();
  if (ADMIN_EMAILS.some((a) => a.toLowerCase() === e)) return true;
  const [local, domain] = e.split('@');
  if (domain === 'thabangvision.com') return true;
  // Gmail plus-aliases of the owner's inbox, and obvious test accounts.
  const base = ADMIN_EMAILS.map((a) => a.toLowerCase().split('@'));
  if (base.some(([l, d]) => d === domain && local.split('+')[0] === l)) return true;
  return /(^|[._+-])test([._+-]|\d|$)/.test(local);
}

/** A first name fit to put in a greeting, or null. Never an email address. */
export function firstNameFrom(candidates: (string | null | undefined)[]): string | null {
  for (const raw of candidates) {
    const word = (raw ?? '').trim().split(/\s+/)[0] ?? '';
    if (!word || word.includes('@') || /\d/.test(word) || word.length > 30) continue;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return null;
}

/** One line per thing done, for the owner's note. */
export function describeActivity(a: SignupActivity): string[] {
  const done: string[] = [];
  if (a.intent) {
    done.push(
      {
        rent: 'Said they want to rent gear',
        hire: 'Said they want to book a photographer or videographer',
        list: 'Said they want to list their gear',
        supply: 'Said they want to offer their services',
        browse: 'Said they are just looking around',
      }[a.intent],
    );
  }
  if (!a.emailConfirmed) done.push('Has not confirmed their email yet');
  if (a.verification === 'pending') done.push('Submitted the ID check (waiting for review)');
  if (a.verification === 'verified') done.push('ID check passed');
  if (a.verification === 'rejected') done.push('ID check was rejected');
  if (a.cartItems > 0) done.push(`Has ${a.cartItems} item(s) in the cart`);
  if (a.gearBookings > 0) done.push(`Started ${a.gearBookings} gear booking(s)`);
  if (a.serviceBookings > 0) done.push(`Started ${a.serviceBookings} creator booking(s)`);
  if (a.ubunyeChats > 0) done.push(`Chatted with Ubunye (${a.ubunyeChats} conversation(s))`);
  return done.length > 0 ? done : ['Nothing yet beyond signing up'];
}

/** The one next step that suits what they came for. */
export function nextStepFor(a: SignupActivity): string {
  if (a.intent === 'list') {
    return `To list your gear, add a photo at ${STUDIO.meta.url}/dashboard/listings and check the details we suggest. We check your ID once before anything goes live.`;
  }
  if (a.intent === 'supply') {
    return `To offer your services, finish the short setup at ${STUDIO.meta.url}/onboarding. We check your ID once before anything goes live.`;
  }
  if (a.intent === 'hire') {
    return `To book a photographer or videographer, pick a package at ${STUDIO.meta.url}/studio. You see the full price before you pay.`;
  }
  if (a.verification === 'verified') {
    return `Your ID check has passed, so you can book gear straight away at ${STUDIO.meta.url}/rentals.`;
  }
  if (a.verification === 'pending') {
    return `Your ID check is with us. A person checks it ${STUDIO.verification.reviewTime}, and then you can book gear.`;
  }
  return `To rent gear, do the one-time ID check at ${STUDIO.meta.url}/dashboard/verification (a photo of your ID and a selfie). A person checks it ${STUDIO.verification.reviewTime}.`;
}

/** Instructions for the AI. Carries only the first name and site activity. */
export function welcomePrompt(ctx: WelcomeContext): { system: string; prompt: string } {
  const system = [
    `You write short welcome emails for ${STUDIO.name}, a Johannesburg company where people rent camera gear and book photographers and videographers.`,
    'Write like a friendly person, not a company. Plain words a first-time online buyer understands. No dashes, no emojis, no exclamation marks in a row, no marketing claims, no discounts or offers.',
    'At most 120 words. Start with "Hi <first name>," or "Hi," if there is no name. Say who we are in one sentence, give the one next step exactly as provided, and end by inviting them to reply to this email with any question.',
    `Sign off as "${STUDIO.legal.informationOfficer.name.split(' ')[0] || 'The team'}, ${STUDIO.name}".`,
    'Reply with the email body only, no subject line.',
  ].join('\n');

  const prompt = [
    `First name: ${ctx.firstName ?? '(unknown)'}`,
    `What they have done so far: ${describeActivity(ctx.activity).join('; ')}.`,
    `The one next step: ${nextStepFor(ctx.activity)}`,
  ].join('\n');

  return { system, prompt };
}

export function welcomeSubject(ctx: WelcomeContext): string {
  return ctx.firstName ? `Welcome to ${STUDIO.name}, ${ctx.firstName}` : `Welcome to ${STUDIO.name}`;
}

/** Used when no AI provider is available. Same facts, same rules. */
export function welcomeTemplate(ctx: WelcomeContext): WelcomeDraft {
  const who = STUDIO.legal.informationOfficer.name.split(' ')[0] || 'The team';
  const body = [
    ctx.firstName ? `Hi ${ctx.firstName},` : 'Hi,',
    '',
    `Thank you for joining ${STUDIO.name}. We rent out camera gear and connect you with photographers and videographers in Gauteng.`,
    '',
    nextStepFor(ctx.activity),
    '',
    'If anything is unclear, just reply to this email and a person will answer.',
    '',
    `${who}, ${STUDIO.name}`,
  ].join('\n');
  return { subject: welcomeSubject(ctx), body };
}

/** Rejects AI output that leaked data it was never meant to have, or is unusable. */
export function isSafeDraft(body: string): boolean {
  if (body.trim().length < 40 || body.length > 1500) return false;
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(body.replace(/\S+@thabangvision\.com/g, ''))) return false;
  if (/\b\d{13}\b/.test(body)) return false; // an SA ID number
  return true;
}
