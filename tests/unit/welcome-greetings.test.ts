import { describe, it, expect } from 'vitest';
import {
  describeActivity,
  firstNameFrom,
  isInternalAccount,
  isSafeDraft,
  welcomeTemplate,
  type SignupActivity,
  type WelcomeContext,
} from '@/lib/greetings/welcome';

const nothing: SignupActivity = {
  intent: null, emailConfirmed: true, verification: 'none',
  cartItems: 0, gearBookings: 0, serviceBookings: 0, ubunyeChats: 0,
};
const ctx = (over: Partial<SignupActivity> = {}, firstName: string | null = 'Lerato'): WelcomeContext => ({
  firstName, method: 'email', activity: { ...nothing, ...over },
});

describe('who is welcomed', () => {
  it('skips the owner, plus-aliases, company addresses and test accounts', () => {
    expect(isInternalAccount('thabangvisionstudios@gmail.com')).toBe(true);
    expect(isInternalAccount('thabangvisionstudios+test2@gmail.com')).toBe(true);
    expect(isInternalAccount('hello@thabangvision.com')).toBe(true);
    expect(isInternalAccount('test123@gmail.com')).toBe(true);
    expect(isInternalAccount(null)).toBe(true);
  });
  it('welcomes real people', () => {
    expect(isInternalAccount('lerato.m@gmail.com')).toBe(false);
    expect(isInternalAccount('contestant@yahoo.com')).toBe(false);
  });
});

describe('first name', () => {
  it('takes the first word, never an email or a handle with digits', () => {
    expect(firstNameFrom([null, 'lerato mokoena'])).toBe('Lerato');
    expect(firstNameFrom(['me@x.com', 'user123', 'Sipho'])).toBe('Sipho');
    expect(firstNameFrom([undefined, ''])).toBeNull();
  });
});

describe('the safety check', () => {
  it('rejects a draft that contains an email address or an ID number', () => {
    const ok = 'Hi Lerato, thank you for joining. Reply to this email with any question you have.';
    expect(isSafeDraft(ok)).toBe(true);
    expect(isSafeDraft(`${ok} lerato@gmail.com`)).toBe(false);
    expect(isSafeDraft(`${ok} 9001015800087`)).toBe(false);
    expect(isSafeDraft(`${ok} Write to hello@thabangvision.com`)).toBe(true);
  });
});

// Owner, 2026-10-14: one fixed welcome for everyone; only the name changes.
describe('the welcome text', () => {
  it("is the owner's exact message, with the name", () => {
    const t = welcomeTemplate(ctx({}));
    expect(t.body).toBe([
      'Hi Lerato,',
      '',
      'Thank you for joining ThabangVision. We rent out cameras and connect you with photographers and videographers in Gauteng.',
      '',
      'To rent gear, do the one-time ID check at https://www.thabangvision.com/dashboard/verification (a photo of your ID and a selfie). A person checks it usually within one working day.',
      '',
      'If anything is unclear, just reply to this email and a person will reply.',
      '',
      'Warm regards,',
      'The ThabangVision team',
      'www.thabangvision.com',
    ].join('\n'));
  });
  it('says just "Hi," when there is no name', () => {
    const t = welcomeTemplate(ctx({}, null));
    expect(t.body.startsWith('Hi,\n')).toBe(true);
    expect(isSafeDraft(t.body)).toBe(true);
  });
  it('is the same for everyone, whatever they did or picked', () => {
    const base = welcomeTemplate(ctx({})).body;
    for (const over of [{ intent: 'supply' as const }, { intent: 'hire' as const }, { intent: 'list' as const }, { verification: 'pending' as const }, { verification: 'verified' as const }, { cartItems: 3 }]) {
      expect(welcomeTemplate(ctx(over)).body).toBe(base);
    }
  });
  it('says so when someone has done nothing yet', () => {
    expect(describeActivity(nothing)).toEqual(['Nothing yet beyond signing up']);
  });
});
