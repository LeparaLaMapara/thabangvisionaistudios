/**
 * Pre-filling a community listing from a photo (spec §9.3: photo → review
 * suggested details and pricing → submit). Pure: no Supabase, Next.js or
 * provider imports. The routes call the AI; these functions decide what
 * goes on the draft and which values count as AI-suggested.
 *
 * The rule from Phase 2 stands: every value the platform guessed (vision,
 * the listing describer, or the rate heuristic below) is recorded in
 * listing_private.ai_fields as `suggested`, and a listing with an
 * unconfirmed suggestion cannot be submitted. A value the owner typed is
 * the owner's own and is not marked. No replacement value is ever guessed:
 * there is no reliable source for one, so it stays empty and the owner must
 * enter it before submitting.
 */

import { LISTING_SUGGESTED_RATES, type RentalCategorySlug } from '@/lib/constants';
import { clampIncludes, looksLikeCoordinates, resolveCategory } from './input';
import { AI_SUGGESTIBLE_FIELDS, type AiSuggestibleField } from './review';

// ── Condition vocabulary ────────────────────────────────────────────────────

/** Conditions a rentable listing may have, as stored in smart_rentals.sub_category. */
export const LISTING_CONDITIONS = ['new', 'like-new', 'good', 'fair'] as const;
export type ListingCondition = (typeof LISTING_CONDITIONS)[number];

/**
 * A condition in the listing vocabulary, or null. Vision answers `like_new`
 * and `for_parts`; the dashboard stores `like-new`. Gear "for parts" is not
 * something to rent out, so it maps to null and the owner chooses.
 */
export function normaliseCondition(raw: unknown): ListingCondition | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (v === 'likenew') return 'like-new';
  return (LISTING_CONDITIONS as readonly string[]).includes(v) ? (v as ListingCondition) : null;
}

// ── Rate heuristic ──────────────────────────────────────────────────────────

/**
 * A starting day rate (rands) from the category and condition. Only a
 * suggestion: the owner confirms or changes it.
 */
export function estimateDailyRate(category: string | null | undefined, condition: unknown): number {
  const rates = LISTING_SUGGESTED_RATES;
  const base = (category && rates.dayRateByCategory[category]) || rates.defaultDayRate;
  const cond = normaliseCondition(condition);
  const mult = (cond && rates.conditionMultiplier[cond]) || rates.defaultConditionMultiplier;
  return Math.round(base * mult);
}

/** A week rate (rands) from a day rate: a week is billed as a set number of days. */
export function estimateWeeklyRate(dayRate: number): number {
  return Math.round(dayRate * LISTING_SUGGESTED_RATES.weekBilledAsDays);
}

// ── Location from the profile ───────────────────────────────────────────────

const LOCATION_MAX = 120;

/**
 * "City, Province" from the owner's profile, or the legacy location text.
 * Never coordinates. The owner can change it; the declaration "the location
 * is where the gear is kept" is theirs to give.
 */
export function profileLocation(p: { city?: string | null; province?: string | null; location?: string | null } | null): string | null {
  if (!p) return null;
  const city = p.city?.trim();
  const province = p.province?.trim();
  let out: string | null = null;
  if (city && province) out = `${city}, ${province}`;
  else if (city) out = city;
  else if (p.location?.trim()) out = p.location.trim();
  if (!out || looksLikeCoordinates(out)) return null;
  return out.slice(0, LOCATION_MAX);
}

// ── The suggestion ──────────────────────────────────────────────────────────

/** What vision recognised in the photo. Confidence 0..1. */
export interface GearFacts {
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  condition?: string | null;
  equipmentType?: string | null;
  confidence?: number | null;
}

/** What the listing describer wrote. */
export interface DescribedGear {
  title?: string | null;
  description?: string | null;
  rentalIncludes?: string[] | null;
}

/** Values the owner typed themselves (e.g. edited in onboarding). Never marked as AI. */
export interface OwnerValues {
  title?: string | null;
  category?: string | null;
  condition?: string | null;
  price_per_day?: number | null;
}

export interface SuggestedValues {
  title: string;
  description: string | null;
  category: RentalCategorySlug | null;
  brand: string | null;
  model: string | null;
  condition: ListingCondition | null;
  price_per_day: number | null;
  price_per_week: number | null;
  /** Always null: never guessed. */
  replacement_value: null;
  rental_includes: string[];
  location: string | null;
}

export interface ListingSuggestion {
  values: SuggestedValues;
  /** Every field whose value came from the platform, not the owner. */
  aiSuggested: AiSuggestibleField[];
  /** Vision was not sure what this is: every detail needs a careful check. */
  lowConfidence: boolean;
}

/** Used when nothing gives a title; marked suggested so the owner must change or confirm it. */
export const PLACEHOLDER_TITLE = 'Untitled gear';

/** Below this, a recognition is treated as a guess (the describer is not asked). */
export const MIN_CONFIDENCE = 0.7;

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max).trim() : null;
}

function positiveNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export function isLowConfidence(facts: GearFacts | null | undefined): boolean {
  const c = facts?.confidence;
  return typeof c === 'number' && Number.isFinite(c) && c < MIN_CONFIDENCE;
}

/**
 * The draft's values and which of them are AI-suggested. Owner values win
 * and are never marked; everything else that is filled in is marked.
 */
export function suggestListing(input: {
  facts: GearFacts | null;
  described: DescribedGear | null;
  owner?: OwnerValues | null;
  location: string | null;
}): ListingSuggestion {
  const { facts, described } = input;
  const owner = input.owner ?? {};
  const ai = new Set<AiSuggestibleField>();
  const fromAi = <T>(field: AiSuggestibleField, value: T | null): T | null => {
    if (value !== null) ai.add(field);
    return value;
  };

  const brand = fromAi('brand', text(facts?.brand, 80));
  const model = fromAi('model', text(facts?.model, 80));

  const ownerCategory = resolveCategory(owner.category);
  const category = ownerCategory ?? fromAi('category', resolveCategory(facts?.category));

  const ownerCondition = normaliseCondition(owner.condition);
  const condition = ownerCondition ?? fromAi('condition', normaliseCondition(facts?.condition));

  const ownerTitle = text(owner.title, 140);
  let title: string;
  if (ownerTitle) {
    title = ownerTitle;
  } else {
    title = text(described?.title, 140) ?? text([brand, model].filter(Boolean).join(' '), 140) ?? PLACEHOLDER_TITLE;
    ai.add('title');
  }

  const description = fromAi('description', text(described?.description, 4000));
  const includes = clampIncludes(described?.rentalIncludes ?? []);
  if (includes.length > 0) ai.add('rental_includes');

  const ownerDay = positiveNumber(owner.price_per_day);
  let day: number | null = ownerDay;
  if (day === null && (facts || category)) day = fromAi('price_per_day', estimateDailyRate(category, condition));
  const week = day !== null ? fromAi('price_per_week', estimateWeeklyRate(day)) : null;

  return {
    values: {
      title,
      description,
      category,
      brand,
      model,
      condition,
      price_per_day: day,
      price_per_week: week,
      replacement_value: null,
      rental_includes: includes,
      location: input.location,
    },
    aiSuggested: AI_SUGGESTIBLE_FIELDS.filter((f) => ai.has(f)),
    lowConfidence: isLowConfidence(facts),
  };
}

// ── Onboarding items ────────────────────────────────────────────────────────

/** One gear photo from the onboarding step, as the server reads it. */
export interface OnboardingItem {
  facts: GearFacts | null;
  owner: OwnerValues;
  photoUrl: string | null;
}

/**
 * Reads one item of POST /api/onboarding/create-rentals. Accepts the old
 * shape ({ brand, model, category, condition, confidence, thumbnailUrl })
 * and the new one, which adds what the owner typed: `title` (the name
 * field), `category`, `condition` and `dailyRate`, each counted as the
 * owner's own only when `ownerEdited` says they changed it (otherwise the
 * value is the AI's and stays suggested). Returns null when the item has
 * nothing to make a draft from.
 */
export function parseOnboardingItem(raw: unknown): OnboardingItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const edited = r.ownerEdited && typeof r.ownerEdited === 'object' ? (r.ownerEdited as Record<string, unknown>) : {};

  const brand = text(r.brand, 80);
  const model = text(r.model, 80);
  const confidence = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? r.confidence : null;
  const recognised = Boolean(brand || model);
  const facts: GearFacts | null = recognised
    ? {
        brand,
        model,
        category: typeof r.category === 'string' ? r.category : null,
        condition: typeof r.condition === 'string' ? r.condition : null,
        equipmentType: text(r.equipmentType, 80),
        confidence,
      }
    : null;

  // Without recognition, whatever is on the item was typed by the owner.
  const owns = (key: string): boolean => !recognised || edited[key] === true;
  const owner: OwnerValues = {
    title: owns('title') ? text(r.title, 140) : null,
    category: owns('category') && typeof r.category === 'string' ? r.category : null,
    condition: owns('condition') && typeof r.condition === 'string' ? r.condition : null,
    // A day rate is only ever typed by the owner on this step.
    price_per_day: positiveNumber(r.dailyRate),
  };

  if (!facts && !owner.title) return null;
  const photoUrl = typeof r.thumbnailUrl === 'string' && r.thumbnailUrl ? r.thumbnailUrl : null;
  return { facts, owner, photoUrl };
}

/** Key used to drop duplicate onboarding items (same name, brand and model). */
export function onboardingItemKey(item: OnboardingItem, title: string): string {
  return [title, item.facts?.brand ?? '', item.facts?.model ?? ''].map((s) => s.trim().toLowerCase()).join('|');
}
