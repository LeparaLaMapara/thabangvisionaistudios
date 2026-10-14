import { describe, it, expect } from 'vitest';
import { ROLES_POLICY } from '@/lib/constants';
import {
  ageOn,
  bestDateOfBirth,
  canSubmit,
  canTakeJob,
  checkAge,
  clampPerKm,
  clampPrice,
  classifySource,
  confirmedJobCount,
  evidenceLevel,
  formatRolePrice,
  isVerified,
  jobSizeLimitCents,
  jobsLine,
  legalQuestions,
  legalQuestionsAnswered,
  legalStatus,
  parseRole,
  proofComplete,
  proofProgress,
  randsToCents,
  reviewLegal,
  type EvidenceFact,
  type LadderFacts,
  type LegalRequirement,
  type ProofStep,
} from '@/lib/roles';

const NOW = new Date('2026-10-14T10:00:00Z');

const base: LadderFacts = {
  identityVerified: true,
  profileApproved: true,
  evidence: [],
  confirmedJobs: 0,
  reviewCount: 0,
  averageRating: 0,
  disputes: 0,
};

const captured = (n: number): EvidenceFact[] =>
  Array.from({ length: n }, () => ({ kind: 'photo', source: 'captured_in_app', verified: false }) as EvidenceFact);

describe('evidence ladder', () => {
  it('starts at new and says what unlocks shown', () => {
    const r = evidenceLevel({ ...base, profileApproved: false });
    expect(r.level).toBe('new');
    expect(r.next?.level).toBe('shown');
    expect(r.next?.missing.join(' ')).toMatch(/taken in the app/);
    expect(r.next?.missing.join(' ')).toMatch(/approved/);
  });

  it('asks for the ID check when identity is not verified', () => {
    const r = evidenceLevel({ ...base, identityVerified: false, evidence: captured(5) });
    expect(r.level).toBe('new');
    expect(r.next?.missing[0]).toMatch(/ID/);
  });

  it('uploads alone never reach shown', () => {
    const uploads: EvidenceFact[] = Array.from({ length: 6 }, () => ({ kind: 'photo', source: 'uploaded', verified: true }));
    expect(evidenceLevel({ ...base, evidence: uploads }).level).toBe('new');
  });

  it('in-app proof plus approval is shown', () => {
    const r = evidenceLevel({ ...base, evidence: captured(ROLES_POLICY.ladder.shownMinCaptured) });
    expect(r.level).toBe('shown');
    expect(r.next?.level).toBe('vouched');
  });

  it('an unconfirmed vouch does not count; a confirmed one does', () => {
    const ev = [...captured(3), { kind: 'vouch', source: 'vouched', verified: false } as EvidenceFact];
    expect(evidenceLevel({ ...base, evidence: ev }).level).toBe('shown');
    ev[3] = { kind: 'vouch', source: 'vouched', verified: true };
    const r = evidenceLevel({ ...base, evidence: ev });
    expect(r.level).toBe('vouched');
    expect(r.next?.missing[0]).toMatch(/3 jobs/);
  });

  it('3 confirmed jobs is proven, even without a vouch', () => {
    const r = evidenceLevel({ ...base, confirmedJobs: 3 });
    expect(r.level).toBe('proven');
    expect(r.next?.level).toBe('trusted');
  });

  it('trusted needs jobs, reviews, rating and no disputes', () => {
    const t = { ...base, confirmedJobs: 12, reviewCount: 6, averageRating: 4.8 };
    expect(evidenceLevel(t).level).toBe('trusted');
    expect(evidenceLevel(t).next).toBeNull();
    expect(evidenceLevel({ ...t, disputes: 1 }).level).toBe('proven');
    expect(evidenceLevel({ ...t, disputes: 1 }).next?.missing).toContain('no disputes');
    expect(evidenceLevel({ ...t, averageRating: 4.2 }).level).toBe('proven');
    expect(evidenceLevel({ ...t, reviewCount: 2 }).level).toBe('proven');
  });

  it('counts confirmed jobs from bookings or verified booking evidence, never unverified', () => {
    const ev: EvidenceFact[] = [
      { kind: 'booking', source: 'booking', verified: true },
      { kind: 'booking', source: 'booking', verified: false },
    ];
    expect(confirmedJobCount(ev)).toBe(1);
    expect(confirmedJobCount(ev, 4)).toBe(4);
    expect(confirmedJobCount([], -2)).toBe(0);
  });
});

describe('job size limits', () => {
  it('rise with each level', () => {
    const levels = ['new', 'shown', 'vouched', 'proven', 'trusted'] as const;
    for (let i = 1; i < levels.length; i++) {
      expect(jobSizeLimitCents(levels[i])).toBeGreaterThan(jobSizeLimitCents(levels[i - 1]));
    }
  });

  it('a job over the limit explains, never blocks the person', () => {
    const limit = jobSizeLimitCents('new');
    expect(canTakeJob('new', limit).ok).toBe(true);
    const r = canTakeJob('new', limit + 100, { level: 'shown', missing: ['3 photos taken in the app'] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/up to R/);
      expect(r.message).toMatch(/3 photos taken in the app/);
    }
  });
});

const DRIVER: LegalRequirement[] = [
  { code: 'drivers_licence', label: 'Driving licence', required: true, basis: 'law' },
  { code: 'prdp', label: 'PrDP', required: true, basis: 'law', when: 'carries_passengers', ask: 'Will you drive people?' },
  { code: 'commercial_insurance', label: 'Insurance', required: true, basis: 'platform' },
];

describe('legal requirements', () => {
  it('PrDP applies only to someone who carries people', () => {
    const gearOnly = legalStatus(DRIVER, { carries_passengers: false }, []);
    expect(gearOnly.applicable.map((r) => r.code)).toEqual(['drivers_licence', 'commercial_insurance']);
    const people = legalStatus(DRIVER, { carries_passengers: true }, []);
    expect(people.missing.map((r) => r.code)).toContain('prdp');
  });

  it('is met only when every applicable document is checked', () => {
    const held = [
      { legal_code: 'drivers_licence', verified: true },
      { legal_code: 'commercial_insurance', verified: false },
    ];
    const s = legalStatus(DRIVER, { carries_passengers: false }, held);
    expect(s.met).toBe(false);
    expect(s.pending.map((r) => r.code)).toEqual(['commercial_insurance']);
    held[1].verified = true;
    expect(legalStatus(DRIVER, { carries_passengers: false }, held).met).toBe(true);
  });

  it('a role with no legal requirements is met', () => {
    expect(legalStatus([], {}, []).met).toBe(true);
  });

  it('age requirements are met by the age check, not a document', () => {
    const model: LegalRequirement[] = [{ code: 'age_18', label: '18 or older', required: true, basis: 'law' }];
    expect(legalStatus(model, {}, [], { ageOk: true }).met).toBe(true);
    expect(legalStatus(model, {}, [], { ageOk: false }).pending).toHaveLength(1);
  });

  it('lists each question once and knows when they are answered', () => {
    expect(legalQuestions(DRIVER)).toEqual([{ key: 'carries_passengers', ask: 'Will you drive people?' }]);
    expect(legalQuestionsAnswered(DRIVER, {})).toBe(false);
    expect(legalQuestionsAnswered(DRIVER, { carries_passengers: false })).toBe(true);
  });
});

describe('age check', () => {
  it('counts whole years and the birthday itself', () => {
    expect(ageOn('2008-10-14', NOW)).toBe(18);
    expect(ageOn('2008-10-15', NOW)).toBe(17);
    expect(ageOn('2030-01-01', NOW)).toBeNull();
    expect(ageOn('2001-02-30', NOW)).toBeNull();
    expect(ageOn('nonsense', NOW)).toBeNull();
  });

  it('model is 18+; unknown never passes', () => {
    expect(checkAge(18, '2008-10-14', NOW)).toBe('ok');
    expect(checkAge(18, '2008-10-15', NOW)).toBe('too_young');
    expect(checkAge(18, null, NOW)).toBe('unknown');
    expect(checkAge(null, null, NOW)).toBe('not_required');
  });

  it('prefers the ID check date over a typed one', () => {
    expect(bestDateOfBirth('1999-05-01', '2000-01-01')).toBe('1999-05-01');
    expect(bestDateOfBirth(null, '2000-01-01')).toBe('2000-01-01');
    expect(bestDateOfBirth(null, 5)).toBeNull();
  });
});

const STEPS: ProofStep[] = [
  { key: 'before_after', title: 'Before and after', help: '', kind: 'pair', min: 1 },
  { key: 'angles', title: 'Three angles', help: '', kind: 'photo', min: 3 },
  { key: 'past', title: 'Past shoots', help: '', kind: 'photo', min: 0 },
];

const ev = (step_key: string, extra: Partial<{ kind: 'photo' | 'video'; pair_group: string; pair_side: 'before' | 'after' }> = {}) => ({
  step_key,
  kind: extra.kind ?? ('photo' as const),
  pair_group: extra.pair_group ?? null,
  pair_side: extra.pair_side ?? null,
});

describe('proof steps', () => {
  it('a pair needs both sides', () => {
    const half = [ev('before_after', { pair_group: 'p1', pair_side: 'before' })];
    expect(proofProgress(STEPS, half)[0].complete).toBe(false);
    const full = [...half, ev('before_after', { pair_group: 'p1', pair_side: 'after' })];
    expect(proofProgress(STEPS, full)[0]).toMatchObject({ done: 1, complete: true });
  });

  it('optional steps are complete with nothing', () => {
    expect(proofProgress(STEPS, [])[2].complete).toBe(true);
  });

  it('complete when every step is', () => {
    const all = [
      ev('before_after', { pair_group: 'p1', pair_side: 'before' }),
      ev('before_after', { pair_group: 'p1', pair_side: 'after' }),
      ev('angles'), ev('angles'), ev('angles'),
    ];
    expect(proofComplete(STEPS, all)).toBe(true);
    expect(proofComplete(STEPS, all.slice(0, 4))).toBe(false);
  });

  it('labels a file captured only when it came from the camera and is fresh', () => {
    const now = NOW.getTime();
    const fresh = new Date(now - 60_000).toISOString();
    const old = new Date(now - 3 * 86_400_000).toISOString();
    expect(classifySource({ fromCameraButton: true, exifDate: fresh, fileLastModified: null, now })).toBe('captured_in_app');
    expect(classifySource({ fromCameraButton: true, exifDate: old, fileLastModified: now, now })).toBe('uploaded');
    expect(classifySource({ fromCameraButton: false, exifDate: fresh, fileLastModified: now, now })).toBe('uploaded');
    expect(classifySource({ fromCameraButton: true, exifDate: null, fileLastModified: now - 1000, now })).toBe('captured_in_app');
    expect(classifySource({ fromCameraButton: true, exifDate: null, fileLastModified: null, now })).toBe('uploaded');
  });
});

describe('pricing', () => {
  const band = { typical: 65000, low: 35000, high: 150000 };
  it('keeps the price inside the band', () => {
    expect(clampPrice(10, band)).toBe(35000);
    expect(clampPrice(999999, band)).toBe(150000);
    expect(clampPrice(70000, band)).toBe(70000);
    expect(clampPrice(Number.NaN, band)).toBe(65000);
  });

  it('per km only for roles that have it', () => {
    expect(clampPerKm(100, band)).toBeNull();
    expect(clampPerKm(10, { ...band, per_km: 600 })).toBe(300);
    expect(clampPerKm(5000, { ...band, per_km: 600 })).toBe(1200);
  });

  it('formats a clear price with its unit', () => {
    expect(formatRolePrice('look', 65000)).toBe('R650 per look');
    expect(formatRolePrice('day_plus_km', 180000, 600)).toMatch(/^R1.800 per day \+ R6 per km$/);
  });

  it('reads rands typed by a person', () => {
    expect(randsToCents('650')).toBe(65000);
    expect(randsToCents('R1 800')).toBe(180000);
    expect(randsToCents('12.5')).toBe(1250);
    expect(randsToCents('abc')).toBeNull();
  });
});

describe('what clients see', () => {
  it('verified means ID plus the role legal checks', () => {
    expect(isVerified({ identityVerified: true, legalVerified: false, roleHasLegal: false })).toBe(true);
    expect(isVerified({ identityVerified: true, legalVerified: false, roleHasLegal: true })).toBe(false);
    expect(isVerified({ identityVerified: false, legalVerified: true, roleHasLegal: true })).toBe(false);
  });

  it('a real job count, never a fake one', () => {
    expect(jobsLine(0)).toMatch(/^New on /);
    expect(jobsLine(1)).toMatch(/^1 job done on /);
    expect(jobsLine(7)).toMatch(/^7 jobs done on /);
    expect(jobsLine(-3)).toMatch(/^New on /);
  });
});

describe('submit check', () => {
  const role = {
    status: 'live' as const,
    min_age: 18,
    legal_requirements: DRIVER,
    proof_task: [{ key: 'outside', title: 'Your vehicle outside', help: '', kind: 'photo' as const, min: 1 }],
  };
  const photo = { step_key: 'outside', kind: 'photo' as const, pair_group: null, pair_side: null, legal_code: null, verified_at: null };
  const doc = (code: string) => ({ step_key: null, kind: 'document' as const, pair_group: null, pair_side: null, legal_code: code, verified_at: null });

  it('lists what is left in plain words', () => {
    const r = canSubmit({ role, answers: {}, evidence: [], priceCents: null, dateOfBirth: null, now: NOW });
    expect(r.ok).toBe(false);
    expect(r.todo).toEqual(expect.arrayContaining(['add your date of birth', 'answer the questions about your work', 'set your price']));
  });

  it('passes when everything is in', () => {
    const r = canSubmit({
      role,
      answers: { carries_passengers: false },
      evidence: [photo, doc('drivers_licence'), doc('commercial_insurance')],
      priceCents: 180000,
      dateOfBirth: '1990-01-01',
      now: NOW,
    });
    expect(r).toMatchObject({ ok: true, todo: [], age: 'ok' });
  });

  it('refuses someone under the minimum age, kindly', () => {
    const r = canSubmit({ role, answers: { carries_passengers: false }, evidence: [photo, doc('drivers_licence'), doc('commercial_insurance')], priceCents: 1, dateOfBirth: '2010-01-01', now: NOW });
    expect(r.ok).toBe(false);
    expect(r.age).toBe('too_young');
  });

  it('a coming-soon role cannot be submitted', () => {
    const r = canSubmit({ role: { ...role, status: 'coming_soon', min_age: null, legal_requirements: [] }, answers: {}, evidence: [photo], priceCents: 1, dateOfBirth: null, now: NOW });
    expect(r.ok).toBe(false);
  });

  it('the reviewer sees the legal picture with age', () => {
    const r = reviewLegal(role, { carries_passengers: true }, [{ kind: 'document', legal_code: 'drivers_licence', verified_at: '2026-10-01' }], '1990-01-01', NOW);
    expect(r.age).toBe('ok');
    expect(r.missing.map((x) => x.code)).toEqual(['prdp', 'commercial_insurance']);
  });
});

describe('parseRole', () => {
  it('drops malformed jsonb instead of trusting it', () => {
    const role = parseRole({
      slug: 'model',
      name: 'Model',
      role_group: 'on_camera',
      description: 'x',
      status: 'live',
      min_age: 18,
      legal_requirements: [{ code: 'age_18', label: '18+' }, { label: 'no code' }, 'junk'],
      proof_task: [{ key: 'digitals', title: 'Digitals', kind: 'photo', min: 4 }, { key: 'x', title: 'bad kind', kind: 'smell' }],
      guidelines: 'g',
      pricing_unit: 'hour',
      suggested_price_cents: { typical: 45000, low: 25000, high: 120000 },
      existing_flow_href: null,
      sort: 30,
    });
    expect(role?.legal_requirements).toHaveLength(1);
    expect(role?.legal_requirements[0]).toMatchObject({ required: true, basis: 'law' });
    expect(role?.proof_task.map((s) => s.key)).toEqual(['digitals']);
    expect(parseRole({ slug: 'x', name: 'X', role_group: 'nope', status: 'live', pricing_unit: 'hour' })).toBeNull();
  });

  it('keeps the typical price inside its band', () => {
    const role = parseRole({ slug: 'a', name: 'A', role_group: 'crew', status: 'live', pricing_unit: 'day', suggested_price_cents: { typical: 10, low: 100, high: 200 } });
    expect(role?.suggested_price_cents).toEqual({ typical: 100, low: 100, high: 200 });
  });
});
