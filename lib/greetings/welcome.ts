import { STUDIO, ADMIN_EMAILS } from '@/lib/constants';
import { SIGNATURE_TEXT } from '@/lib/email/signature';

/**
 * Welcoming new people (TASK-065). Pure: no database, no email, so the
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
    // Letters, apostrophes and hyphens only: the name goes into an email
    // subject and an AI prompt, so "Visit-pay.example.com" is not a name.
    if (!word || word.length > 30 || !/^\p{L}[\p{L}\p{M}'’-]*$/u.test(word)) continue;
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

export function welcomeSubject(ctx: WelcomeContext): string {
  return ctx.firstName ? `Welcome to ${STUDIO.name}, ${ctx.firstName}` : `Welcome to ${STUDIO.name}`;
}

/**
 * The welcome email: one fixed text for everyone, in the owner's words
 * (2026-10-14). Only the name changes, and "Hi," is used when no name is known.
 * No AI, no per-person next step: every new person reads the same message.
 */
export function welcomeTemplate(ctx: WelcomeContext): WelcomeDraft {
  const body = [
    ctx.firstName ? `Hi ${ctx.firstName},` : 'Hi,',
    '',
    `Thank you for joining ${STUDIO.name}. We rent out cameras and connect you with photographers and videographers in Gauteng.`,
    '',
    `To rent gear, do the one-time ID check at ${STUDIO.meta.url}/dashboard/verification (a photo of your ID and a selfie). A person checks it ${STUDIO.verification.reviewTime}.`,
    '',
    'If anything is unclear, just reply to this email and a person will reply.',
    '',
    SIGNATURE_TEXT,
  ].join('\n');
  return { subject: welcomeSubject(ctx), body };
}

/** Rejects AI output that leaked data it was never meant to have, or is unusable. */
export function isSafeDraft(body: string): boolean {
  if (body.trim().length < 40 || body.length > 1500) return false;
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(body.replace(/\S+@thabangvision\.com/g, ''))) return false;
  if (/\b\d{13}\b/.test(body)) return false; // an SA ID number
  // No web address but ours, written out or spelled ("site dot co dot za"):
  // a profile can carry an injected instruction to send people elsewhere.
  const others = body.replace(/(?:[\w-]+\.)*thabangvision\.com\b/gi, '');
  if (/\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/i.test(others)) return false;
  if (/\bdot\s+(?:com|co|za|net|org|io|app|me|info|xyz)\b/i.test(others)) return false;
  return true;
}
