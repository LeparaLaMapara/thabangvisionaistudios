import { describe, it, expect } from 'vitest';
import {
  describeActivity,
  firstNameFrom,
  isInternalAccount,
  isSafeDraft,
  nextStepFor,
  welcomePrompt,
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

describe('what goes to the AI', () => {
  it('carries only the first name and site activity', () => {
    const { prompt } = welcomePrompt(ctx({ intent: 'rent', cartItems: 2 }));
    expect(prompt).toContain('Lerato');
    expect(prompt).toContain('2 item(s) in the cart');
    expect(prompt).not.toMatch(/@/);
  });
  it('rejects a draft that contains an email address or an ID number', () => {
    const ok = 'Hi Lerato, thank you for joining. Reply to this email with any question you have.';
    expect(isSafeDraft(ok)).toBe(true);
    expect(isSafeDraft(`${ok} lerato@gmail.com`)).toBe(false);
    expect(isSafeDraft(`${ok} 9001015800087`)).toBe(false);
    expect(isSafeDraft(`${ok} Write to hello@thabangvision.com`)).toBe(true);
  });
});

describe('the next step', () => {
  it('fits what they came for', () => {
    expect(nextStepFor({ ...nothing, intent: 'supply' })).toMatch(/onboarding/);
    expect(nextStepFor({ ...nothing, intent: 'hire' })).toMatch(/studio/);
    expect(nextStepFor({ ...nothing, verification: 'pending' })).toMatch(/with us/);
    expect(nextStepFor(nothing)).toMatch(/ID check/);
  });
  it('the template works without a name', () => {
    const t = welcomeTemplate(ctx({}, null));
    expect(t.body.startsWith('Hi,')).toBe(true);
    expect(isSafeDraft(t.body)).toBe(true);
  });
  it('says so when someone has done nothing yet', () => {
    expect(describeActivity(nothing)).toEqual(['Nothing yet beyond signing up']);
  });
});
