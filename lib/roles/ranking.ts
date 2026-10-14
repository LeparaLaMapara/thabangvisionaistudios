import { ROLES_POLICY } from '@/lib/constants';
import type { ProfileRecord } from './document';

/**
 * Ranking for matching. Pure.
 *
 * Score = similarity (what they do fits the request) blended with the
 * reliability record and an area fit. Competence only: no name, face or
 * demographics ever reach this function. Fair "new" slots: some places in
 * the top list always go to people with no jobs yet, so newcomers get seen.
 */

export interface MatchCandidate {
  id: string;
  similarity: number;
  record: ProfileRecord;
  area: string | null;
  available: boolean;
}

export interface RankedMatch extends MatchCandidate {
  score: number;
  reliability: number;
  isNew: boolean;
}

/** 0..1 from the record. A newcomer scores a neutral 0.5, never 0. */
export function reliabilityScore(r: ProfileRecord): number {
  if (r.jobs === 0 && r.reviewCount === 0) return 0.5 + Math.min(0.1, r.vouches * 0.05);
  const onTime = r.jobs ? r.onTime / r.jobs : 0.5;
  const rating = r.reviewCount ? r.averageRating / 5 : 0.6;
  const volume = Math.min(1, r.jobs / 10);
  const rebook = r.jobs ? Math.min(1, r.rebooked / Math.max(1, r.jobs / 2)) : 0;
  return Math.max(0, Math.min(1, 0.35 * onTime + 0.3 * rating + 0.2 * volume + 0.1 * rebook + 0.05 * Math.min(1, r.vouches / 2)));
}

function areaFit(area: string | null, wanted: string[]): number {
  if (!wanted.length || !area) return 0;
  const a = area.toLowerCase();
  return wanted.some((w) => a.includes(w)) ? 1 : 0;
}

export function rankMatches(
  candidates: readonly MatchCandidate[],
  opts: { areaWords?: string[]; limit?: number; newSlots?: number } = {},
): RankedMatch[] {
  const w = ROLES_POLICY.matching;
  const limit = opts.limit ?? w.defaultLimit;
  const newSlots = Math.min(opts.newSlots ?? w.newSlots, limit);
  const words = (opts.areaWords ?? []).map((x) => x.toLowerCase()).filter((x) => x.length >= 3);

  const scored: RankedMatch[] = candidates
    .filter((c) => c.available)
    .map((c) => {
      const reliability = reliabilityScore(c.record);
      const score = w.similarityWeight * c.similarity + w.reliabilityWeight * reliability + w.areaWeight * areaFit(c.area, words);
      return { ...c, score, reliability, isNew: c.record.jobs === 0 };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored.slice(0, limit);
  const newInTop = top.filter((m) => m.isNew).length;
  if (newInTop >= newSlots) return top;
  // Give the fair new slots to the best newcomers outside the list, taking the
  // last places of experienced people (never another newcomer's place).
  const waiting = scored.slice(limit).filter((m) => m.isNew).slice(0, newSlots - newInTop);
  const out = [...top];
  for (const n of waiting) {
    let i = out.length - 1;
    while (i >= 0 && out[i].isNew) i--;
    if (i < 0) break;
    out[i] = n;
  }
  return out.sort((a, b) => b.score - a.score);
}
