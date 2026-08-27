/**
 * Capabilities that switch on when the platform has grown into them.
 *
 * The roadmap problem this solves: a plan in a document is a plan someone has
 * to remember to re-read. Every one of these capabilities is obviously right
 * eventually and obviously wrong now, and the only thing separating those two
 * states is a number nobody is watching.
 *
 * So the condition goes next to the capability, in code, and the platform
 * checks its own numbers on a schedule. Filters on Studio are not "later", they
 * are "at fifteen projects across three types". Team assembly is not "phase
 * two", it is "when eight crew have filled in a specialisation".
 *
 * Shape follows lib/ops: gather touches the database, evaluate is pure. The
 * pure half is where the tests live, and it is the half that must never guess.
 *
 * Two levels of automation, deliberately separate:
 *
 *   autoActivate: true   flip the flag without asking. Only for capabilities
 *                        that add something and cannot break what exists.
 *   autoActivate: false  tell the founder it is time. Anything that changes
 *                        how the platform charges, contracts or presents
 *                        itself is a decision, not a threshold.
 *
 * A checkpoint that has been reached is not re-announced. Crossing a line is an
 * event; being past it is not news.
 */

/** The numbers a checkpoint is allowed to reason about. */
export interface GrowthMetrics {
  /** Published, non-archived rental listings. */
  liveRentals: number;
  /** Published productions. */
  publishedProductions: number;
  /** Distinct project_type values across published productions. */
  productionTypes: number;
  /** Profiles with at least one specialisation filled in. */
  crewWithSpecialisation: number;
  /** Rental listings owned by someone other than the studio. */
  communityOwnedRentals: number;
  /** Equipment bookings that reached confirmed or beyond, all time. */
  completedBookings: number;
  /** Distinct normalised queries recorded as unmet demand in the last 90 days. */
  unmetDemandSignals: number;
  /** Returns inspected with a condition recorded, all time. */
  inspectedReturns: number;
}

export const ZERO_METRICS: GrowthMetrics = {
  liveRentals: 0,
  publishedProductions: 0,
  productionTypes: 0,
  crewWithSpecialisation: 0,
  communityOwnedRentals: 0,
  completedBookings: 0,
  unmetDemandSignals: 0,
  inspectedReturns: 0,
};

export interface Checkpoint {
  /** Stable id. Used to remember that it has already fired. */
  id: string;
  title: string;
  /** Why this is worth doing, once it is worth doing. */
  rationale: string;
  /** The condition in words, for the person reading the alert. */
  condition: string;
  /** The condition in code. Pure: metrics in, boolean out. */
  isReached: (m: GrowthMetrics) => boolean;
  /**
   * Feature flag to switch on when reached, if this capability is gated by
   * one. Null means there is nothing to flip: the checkpoint is telling a human
   * to go and build something.
   */
  flagKey: string | null;
  /** Flip the flag unattended, or only recommend it. */
  autoActivate: boolean;
}

export const CHECKPOINTS: Checkpoint[] = [
  {
    id: 'studio-filters',
    title: 'Filter the Studio page by type of work',
    rationale:
      'A filter with one option in it is furniture. It becomes a real answer to a '
      + 'real question once a bride does not want to scroll past product photography.',
    condition: '15+ published projects across 3+ types',
    isReached: (m) => m.publishedProductions >= 15 && m.productionTypes >= 3,
    flagKey: null,
    autoActivate: false,
  },
  {
    id: 'global-search',
    title: 'Wire up the global search component',
    rationale:
      'Already built and never connected, along with its API. Search beats filters '
      + 'because someone wanting a gimbal types "gimbal" instead of guessing which '
      + 'shelf you filed it under. Worth switching on once the catalogue is past '
      + 'the size a person can scan in one screen.',
    condition: '40+ live listings, or 25+ distinct unmet-demand searches',
    isReached: (m) => m.liveRentals >= 40 || m.unmetDemandSignals >= 25,
    flagKey: null,
    autoActivate: false,
  },
  {
    id: 'crew-credits',
    title: 'Credits, role taxonomy and non-visual portfolios',
    rationale:
      'A portfolio is photos and a video with no field for what you did, so a gaffer '
      + 'or a sound engineer has nothing to show. Building it before real crew arrive '
      + 'is three weeks of guessing at a schema; building it after they arrive is '
      + 'copying down what they already sent you.',
    condition: '5+ crew profiles with a specialisation filled in',
    isReached: (m) => m.crewWithSpecialisation >= 5,
    flagKey: null,
    autoActivate: false,
  },
  {
    id: 'team-assembly',
    title: 'Crew calls: book a team rather than a person',
    rationale:
      'Nobody wakes up wanting to buy a gaffer. A production says what it is making '
      + 'and gets back a bookable team. Needs enough people on the platform that a '
      + 'returned team is not embarrassing.',
    condition: '8+ crew with a specialisation, across 3+ disciplines',
    isReached: (m) => m.crewWithSpecialisation >= 8,
    flagKey: 'studio_crews',
    autoActivate: false,
  },
  {
    id: 'first-community-listing',
    title: 'The owner joins have gone live',
    rationale:
      'Owner attribution needs no flag: it renders whenever a listing is community '
      + 'owned, so it activates on data alone. This is not a capability to switch on, '
      + 'it is the moment code that has been dormant since it was written starts '
      + 'showing to the public, and is worth one look to confirm it reads well.',
    condition: 'any community-owned listing exists',
    isReached: (m) => m.communityOwnedRentals >= 1,
    flagKey: null,
    autoActivate: false,
  },
  {
    id: 'utilisation-reporting',
    title: 'Per-item utilisation reporting',
    rationale:
      'What fraction of days each item earns. Tells you what to buy more of, what to '
      + 'sell, and what is mispriced. Meaningless before there are enough bookings '
      + 'for a rate to mean anything.',
    condition: '30+ completed bookings',
    isReached: (m) => m.completedBookings >= 30,
    flagKey: null,
    autoActivate: false,
  },
  {
    id: 'reliability-database',
    title: 'Treat return inspections as engineering data',
    rationale:
      'What breaks, how often, under dust, heat, transport and load-shedding. Already '
      + 'collected as deposit evidence and currently thrown away as such. It is the '
      + 'honest answer to why this company could build hardware one day.',
    condition: '50+ inspected returns',
    isReached: (m) => m.inspectedReturns >= 50,
    flagKey: null,
    autoActivate: false,
  },
];

export interface ReachedCheckpoint {
  checkpoint: Checkpoint;
  metrics: GrowthMetrics;
}

/**
 * Which checkpoints have just been crossed.
 *
 * `alreadyFired` is the set of ids that have been reported before. Being past a
 * line is not news; crossing it is.
 */
export function evaluateCheckpoints(
  metrics: GrowthMetrics,
  alreadyFired: ReadonlySet<string> = new Set(),
): ReachedCheckpoint[] {
  return CHECKPOINTS
    .filter((c) => !alreadyFired.has(c.id))
    .filter((c) => c.isReached(metrics))
    .map((checkpoint) => ({ checkpoint, metrics }));
}

/** The subset safe to switch on without a human, and gated by a flag. */
export function autoActivatable(reached: ReachedCheckpoint[]): ReachedCheckpoint[] {
  return reached.filter((r) => r.checkpoint.autoActivate && r.checkpoint.flagKey !== null);
}

/** One line a person can act on. */
export function describeCheckpoint(reached: ReachedCheckpoint): string {
  const { checkpoint: c } = reached;
  const action = c.autoActivate && c.flagKey
    ? `Enabled automatically (flag: ${c.flagKey}).`
    : 'Ready to build.';
  return `${c.title} — reached ${c.condition}. ${action} ${c.rationale}`;
}
