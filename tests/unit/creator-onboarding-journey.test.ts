import { describe, it, expect } from 'vitest';
import { resumeStep, onboardingNextPath, ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding/progress';
import { verificationNext } from '@/lib/verification/return-link';
import { cleanBio, templateBio, MAX_BIO_CHARS, type BioWriterInput } from '@/lib/agents/agents/bio-writer';
import { showsCreatorChecklist, isCreatorJobStatus } from '@/lib/creators/dashboard';
import { CREATOR_JOIN, MAIN_NAVIGATION, FOOTER_SECTIONS } from '@/lib/constants';

describe('onboarding resume (saved step is the last one FINISHED)', () => {
  it('starts at step 1 with no progress', () => {
    expect(resumeStep(null)).toBe(1);
    expect(resumeStep({ current_step: 0 })).toBe(1);
    expect(resumeStep({ current_step: null })).toBe(1);
  });

  it('resumes at the step after the one finished (the old table sent 1 and 2 both to 1)', () => {
    expect(resumeStep({ current_step: 1 })).toBe(2);
    expect(resumeStep({ current_step: 2 })).toBe(3);
    expect(resumeStep({ current_step: 3 })).toBe(4);
  });

  it('never goes past the last step', () => {
    expect(resumeStep({ current_step: 4 })).toBe(ONBOARDING_TOTAL_STEPS);
    expect(resumeStep({ current_step: 6 })).toBe(ONBOARDING_TOTAL_STEPS);
  });
});

describe('where onboarding sends a creator next', () => {
  it('to the ID check, marked as coming from onboarding', () => {
    expect(onboardingNextPath({ verificationStatus: 'unverified' })).toBe('/dashboard/verification?from=onboarding');
    expect(onboardingNextPath({ verificationStatus: null })).toBe('/dashboard/verification?from=onboarding');
    expect(onboardingNextPath({ verificationStatus: 'rejected' })).toBe('/dashboard/verification?from=onboarding');
  });

  it('keeps the gear draft count so the ID page can link to them', () => {
    expect(onboardingNextPath({ verificationStatus: 'pending', draftedGear: 2 })).toBe(
      '/dashboard/verification?from=onboarding&drafted=2',
    );
  });

  it('straight to the dashboard once the ID check has passed', () => {
    expect(onboardingNextPath({ verificationStatus: 'verified', draftedGear: 3 })).toBe('/dashboard');
  });
});

describe('ID page next step (no "Back to your booking" without a booking)', () => {
  it('a creator from onboarding gets the creator steps', () => {
    expect(verificationNext({ redirect: '', from: 'onboarding' })).toEqual({ kind: 'creator', draftedGear: 0 });
    expect(verificationNext({ redirect: '', from: 'onboarding', drafted: '2' })).toEqual({ kind: 'creator', draftedGear: 2 });
  });

  it('the old onboarding link (?redirect=/dashboard) is not a booking either', () => {
    expect(verificationNext({ redirect: '/dashboard' })).toEqual({ kind: 'creator', draftedGear: 0 });
  });

  it('a renter from a gear page or the cart goes back to the booking', () => {
    expect(verificationNext({ redirect: '/rentals/sony-a7?start=2026-10-20&end=2026-10-21' })).toEqual({
      kind: 'booking',
      href: '/rentals/sony-a7?start=2026-10-20&end=2026-10-21',
    });
    expect(verificationNext({ redirect: '/dashboard/cart' })).toEqual({ kind: 'booking', href: '/dashboard/cart' });
  });

  it('any other page is "continue", and nothing at all is nothing', () => {
    expect(verificationNext({ redirect: '/dashboard/listings' })).toEqual({ kind: 'continue', href: '/dashboard/listings' });
    expect(verificationNext({ redirect: '' })).toBeNull();
  });

  it('a path that only starts with the same letters is not a booking page', () => {
    expect(verificationNext({ redirect: '/rentalsfake' })?.kind).toBe('continue');
  });
});

describe('bio writer fallback', () => {
  const input: BioWriterInput = {
    displayName: 'Lerato',
    location: 'Soshanguve',
    yearsExperience: 3,
    topSceneTypes: [{ name: 'wedding', percentage: 60 }, { name: 'portrait', percentage: 40 }],
    detectedGear: [],
    topDescriptions: [],
  };

  it('the template bio is never empty and fits the cap', () => {
    const bio = templateBio(input);
    expect(bio.length).toBeGreaterThan(20);
    expect(bio.length).toBeLessThanOrEqual(MAX_BIO_CHARS);
    expect(bio).toContain('Soshanguve');
    expect(bio).toContain('wedding and portrait');
    expect(bio).toContain('3 years');
  });

  it('the template works with nothing known', () => {
    const bio = templateBio({ ...input, location: null, yearsExperience: null, topSceneTypes: [] });
    expect(bio).toContain('South Africa');
    expect(bio).toContain('photo and video work');
  });

  it('cleans model output: quotes, labels, dashes, and the cap', () => {
    expect(cleanBio('"Bio: I shoot weddings."')).toBe('I shoot weddings.');
    expect(cleanBio('I shoot weddings \u2014 and events.')).toBe('I shoot weddings, and events.');
    const long = `${'I shoot weddings in Soweto. '.repeat(20)}`;
    const cut = cleanBio(long);
    expect(cut.length).toBeLessThanOrEqual(MAX_BIO_CHARS);
    expect(cut.endsWith('.')).toBe(true);
  });
});

describe('dashboard home for creators', () => {
  it('shows the bookable checklist to anyone offering services', () => {
    const none = { intent: 'rent', onboardingCompletedAt: null, creatorJobs: 0, availableForHire: false };
    expect(showsCreatorChecklist(none)).toBe(false);
    expect(showsCreatorChecklist({ ...none, intent: 'supply' })).toBe(true);
    expect(showsCreatorChecklist({ ...none, onboardingCompletedAt: '2026-10-12T00:00:00Z' })).toBe(true);
    expect(showsCreatorChecklist({ ...none, creatorJobs: 1 })).toBe(true);
    expect(showsCreatorChecklist({ ...none, availableForHire: true })).toBe(true);
  });

  it('counts paid and later jobs, not unpaid or reassigned bookings', () => {
    expect(isCreatorJobStatus('paid')).toBe(true);
    expect(isCreatorJobStatus('completed')).toBe(true);
    expect(isCreatorJobStatus('cancelled')).toBe(true);
    expect(isCreatorJobStatus('pending')).toBe(false);
    expect(isCreatorJobStatus('pending_reassignment')).toBe(false);
  });
});

describe('a way in for creators', () => {
  it('the main menu and the footer link to creator onboarding', () => {
    expect(MAIN_NAVIGATION.some((i) => i.href === CREATOR_JOIN.href && i.label === CREATOR_JOIN.navLabel)).toBe(true);
    const links = FOOTER_SECTIONS.flatMap((s) => s.links);
    expect(links.some((l) => l.href === CREATOR_JOIN.href && l.label === CREATOR_JOIN.footerLabel)).toBe(true);
  });

  it('the words have no dashes', () => {
    for (const v of Object.values(CREATOR_JOIN)) expect(v).not.toMatch(/[\u2014\u2013]/);
  });
});
