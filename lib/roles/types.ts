/**
 * Types for the role catalogue and a person's proof (migration 090).
 * The shapes of the jsonb columns are checked when read (parseRole), so a
 * hand-edited row cannot crash a page.
 */

export const ROLE_GROUPS = ['on_camera', 'hair_makeup', 'crew', 'camera', 'post', 'transport', 'places'] as const;
export type RoleGroup = (typeof ROLE_GROUPS)[number];

export const ROLE_STATUSES = ['live', 'coming_soon'] as const;
export type RoleStatus = (typeof ROLE_STATUSES)[number];

export const PRICING_UNITS = ['hour', 'half_day', 'day', 'look', 'day_plus_km', 'project'] as const;
export type PricingUnit = (typeof PRICING_UNITS)[number];

/** How a role shows proof on its profile (migration 091). */
export const PROOF_FORMATS = ['look', 'listen', 'thing', 'trust'] as const;
export type ProofFormat = (typeof PROOF_FORMATS)[number];

export const PERSON_ROLE_STATUSES = ['draft', 'submitted', 'approved', 'changes_requested'] as const;
export type PersonRoleStatus = (typeof PERSON_ROLE_STATUSES)[number];

export const EVIDENCE_LEVELS = ['new', 'shown', 'vouched', 'proven', 'trusted'] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const EVIDENCE_KINDS = ['photo', 'video', 'document', 'vouch', 'link', 'booking'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_SOURCES = ['captured_in_app', 'uploaded', 'vouched', 'assessed', 'booking'] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export interface LegalRequirement {
  code: string;
  label: string;
  required: boolean;
  /** Who asks for it. 'platform' rules are labelled as ours, never as the law. */
  basis: 'law' | 'platform';
  /** Applies only when answers[when] is true (for example carries_passengers). */
  when?: string;
  /** The yes/no question that sets answers[when]. */
  ask?: string;
  help?: string;
}

export type ProofStepKind = 'photo' | 'video' | 'audio' | 'pair' | 'text';

export interface ProofStep {
  key: string;
  title: string;
  help: string;
  kind: ProofStepKind;
  /** How many items finish the step (a pair counts as one). 0 = optional. */
  min: number;
  /** Open the camera straight away: 'environment' (back) or 'user' (selfie). */
  capture?: 'environment' | 'user';
  tips?: string[];
}

export interface SuggestedPrice {
  typical: number;
  low: number;
  high: number;
  /** day_plus_km only. */
  per_km?: number;
}

export interface Role {
  slug: string;
  name: string;
  role_group: RoleGroup;
  description: string;
  status: RoleStatus;
  min_age: number | null;
  legal_requirements: LegalRequirement[];
  proof_task: ProofStep[];
  guidelines: string;
  pricing_unit: PricingUnit;
  suggested_price_cents: SuggestedPrice;
  existing_flow_href: string | null;
  sort: number;
  proof_format: ProofFormat;
  /** Prefix of the neutral profile code (MA-1042). */
  code_prefix: string | null;
}

export interface PersonRole {
  id: string;
  user_id: string;
  role_slug: string;
  status: PersonRoleStatus;
  evidence_level: EvidenceLevel;
  headline: string | null;
  about: string | null;
  area: string | null;
  price_cents: number | null;
  per_km_cents: number | null;
  answers: Record<string, unknown>;
  reviewer_note: string | null;
  reviewed_at: string | null;
  legal_verified_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  profile_code: string | null;
  facts: Record<string, unknown>;
  facts_source: 'cv' | 'voice' | 'text' | 'manual' | null;
  facts_reviewed_at: string | null;
  comes_with: Record<string, unknown>;
  available_days: string[];
  /** The person's own unit (per day) over the role's default (092). */
  pricing_unit: PricingUnit | null;
}

export interface RoleEvidence {
  id: string;
  person_role_id: string;
  step_key: string | null;
  kind: EvidenceKind;
  source: EvidenceSource;
  legal_code: string | null;
  storage_provider: 'cloudinary' | 'supabase' | 'local' | null;
  storage_ref: string | null;
  url: string | null;
  is_public: boolean;
  pair_group: string | null;
  pair_side: 'before' | 'after' | null;
  captured_at: string | null;
  device_summary: Record<string, unknown> | null;
  note: string | null;
  booking_id: string | null;
  verified_at: string | null;
  is_demo: boolean;
  created_at: string;
  media_kind: 'image' | 'video' | 'audio' | null;
  on_time: boolean | null;
  /** Album label within one portfolio (092). */
  album: string | null;
  /** The smart_productions package this work was copied from (092). */
  source_production_id: string | null;
}
