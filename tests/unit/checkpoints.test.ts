import { describe, it, expect } from 'vitest';
import {
  CHECKPOINTS,
  ZERO_METRICS,
  evaluateCheckpoints,
  autoActivatable,
  describeCheckpoint,
  type GrowthMetrics,
} from '@/lib/growth/checkpoints';

const metrics = (over: Partial<GrowthMetrics> = {}): GrowthMetrics => ({
  ...ZERO_METRICS,
  ...over,
});

describe('CHECKPOINTS definitions', () => {
  it('has unique ids, since ids are how a fired checkpoint is remembered', () => {
    const ids = CHECKPOINTS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only auto-activates capabilities that have a flag to flip', () => {
    // autoActivate with no flagKey would silently do nothing while reporting
    // that it had switched something on.
    for (const c of CHECKPOINTS) {
      if (c.autoActivate) expect(c.flagKey, c.id).not.toBeNull();
    }
  });

  it('every checkpoint explains itself', () => {
    for (const c of CHECKPOINTS) {
      expect(c.title.length, c.id).toBeGreaterThan(0);
      expect(c.rationale.length, c.id).toBeGreaterThan(20);
      expect(c.condition.length, c.id).toBeGreaterThan(0);
    }
  });
});

describe('evaluateCheckpoints', () => {
  it('fires nothing on an empty platform', () => {
    // The whole point: today's numbers must light nothing up. If this ever
    // fails, a threshold has been set below where the platform already is.
    expect(evaluateCheckpoints(ZERO_METRICS)).toEqual([]);
  });

  it('fires nothing at the real numbers as of 2026-08-27', () => {
    const today = metrics({
      liveRentals: 25,
      publishedProductions: 3,
      productionTypes: 1,
      crewWithSpecialisation: 0,
      communityOwnedRentals: 0,
      completedBookings: 0,
      unmetDemandSignals: 0,
      inspectedReturns: 0,
    });
    expect(evaluateCheckpoints(today)).toEqual([]);
  });

  it('fires studio filters at 15 projects across 3 types, not before', () => {
    expect(evaluateCheckpoints(metrics({ publishedProductions: 15, productionTypes: 2 })))
      .toEqual([]);
    expect(evaluateCheckpoints(metrics({ publishedProductions: 14, productionTypes: 3 })))
      .toEqual([]);

    const reached = evaluateCheckpoints(metrics({ publishedProductions: 15, productionTypes: 3 }));
    expect(reached.map(r => r.checkpoint.id)).toContain('studio-filters');
  });

  it('fires search on either catalogue size or unmet demand', () => {
    expect(evaluateCheckpoints(metrics({ liveRentals: 40 })).map(r => r.checkpoint.id))
      .toContain('global-search');
    expect(evaluateCheckpoints(metrics({ unmetDemandSignals: 25 })).map(r => r.checkpoint.id))
      .toContain('global-search');
    expect(evaluateCheckpoints(metrics({ liveRentals: 39, unmetDemandSignals: 24 })))
      .toEqual([]);
  });

  it('fires on the very first community-owned listing', () => {
    const reached = evaluateCheckpoints(metrics({ communityOwnedRentals: 1 }));
    expect(reached.map(r => r.checkpoint.id)).toContain('first-community-listing');
  });

  it('does not re-announce a checkpoint that already fired', () => {
    const m = metrics({ communityOwnedRentals: 5 });
    const fired = new Set(['first-community-listing']);
    expect(evaluateCheckpoints(m, fired).map(r => r.checkpoint.id))
      .not.toContain('first-community-listing');
  });

  it('can fire several at once without them interfering', () => {
    const m = metrics({
      publishedProductions: 20,
      productionTypes: 4,
      liveRentals: 50,
      communityOwnedRentals: 3,
    });
    const ids = evaluateCheckpoints(m).map(r => r.checkpoint.id);
    expect(ids).toEqual(expect.arrayContaining([
      'studio-filters', 'global-search', 'first-community-listing',
    ]));
  });

  it('carries the metrics that triggered it, so an alert can show its working', () => {
    const m = metrics({ communityOwnedRentals: 2 });
    expect(evaluateCheckpoints(m)[0].metrics).toEqual(m);
  });
});

describe('autoActivatable', () => {
  // Nothing in CHECKPOINTS auto-activates today, and that is the honest answer
  // rather than an oversight: flipping a flag unattended is only defensible for
  // a capability that is purely additive, and every gated one here changes how
  // the platform presents or charges. These tests exercise the mechanism with
  // hand-built checkpoints so they keep testing the filter, not the catalogue.
  const base = {
    rationale: 'x'.repeat(30),
    condition: 'always',
    isReached: () => true,
    metrics: ZERO_METRICS,
  };

  const reached = [
    { checkpoint: { ...base, id: 'auto', title: 'Auto', flagKey: 'studio_crews', autoActivate: true } },
    { checkpoint: { ...base, id: 'manual', title: 'Manual', flagKey: 'studio_crews', autoActivate: false } },
    { checkpoint: { ...base, id: 'noflag', title: 'No flag', flagKey: null, autoActivate: true } },
  ].map(r => ({ checkpoint: r.checkpoint, metrics: ZERO_METRICS }));

  it('keeps only what is both automatic and has a flag to flip', () => {
    expect(autoActivatable(reached).map(r => r.checkpoint.id)).toEqual(['auto']);
  });

  it('is empty for the real catalogue as it stands', () => {
    const everything = evaluateCheckpoints(metrics({
      publishedProductions: 100, productionTypes: 9, liveRentals: 100,
      crewWithSpecialisation: 50, communityOwnedRentals: 20,
      completedBookings: 500, unmetDemandSignals: 200, inspectedReturns: 300,
    }));
    expect(everything.length).toBe(CHECKPOINTS.length);
    expect(autoActivatable(everything)).toEqual([]);
  });
});

describe('describeCheckpoint', () => {
  it('says it is ready to build when a person has to act', () => {
    const r = evaluateCheckpoints(metrics({ completedBookings: 30 }))
      .find(x => x.checkpoint.id === 'utilisation-reporting')!;
    expect(describeCheckpoint(r)).toMatch(/Ready to build/);
    expect(describeCheckpoint(r)).toContain('30+ completed bookings');
  });

  it('names the flag when one would be flipped automatically', () => {
    const r = {
      checkpoint: {
        id: 'auto', title: 'Auto', rationale: 'x'.repeat(30), condition: 'always',
        isReached: () => true, flagKey: 'studio_crews', autoActivate: true,
      },
      metrics: ZERO_METRICS,
    };
    expect(describeCheckpoint(r)).toMatch(/Enabled automatically \(flag: studio_crews\)/);
  });
});
