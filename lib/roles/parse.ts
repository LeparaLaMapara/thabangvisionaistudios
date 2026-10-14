import {
  PRICING_UNITS,
  PROOF_FORMATS,
  ROLE_GROUPS,
  ROLE_STATUSES,
  type LegalRequirement,
  type PricingUnit,
  type ProofFormat,
  type ProofStep,
  type Role,
  type RoleGroup,
  type RoleStatus,
  type SuggestedPrice,
} from './types';

/**
 * Reads a `roles` row defensively. jsonb columns are edited by hand in the
 * database, so anything malformed is dropped rather than trusted. Pure.
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const KEY = /^[a-z0-9_-]{1,40}$/;

export function parseLegalRequirements(raw: unknown): LegalRequirement[] {
  if (!Array.isArray(raw)) return [];
  const out: LegalRequirement[] = [];
  for (const r of raw) {
    if (!isObj(r)) continue;
    const code = str(r.code);
    const label = str(r.label);
    if (!code || !KEY.test(code) || !label) continue;
    out.push({
      code,
      label,
      required: r.required !== false,
      basis: r.basis === 'platform' ? 'platform' : 'law',
      ...(str(r.when) ? { when: str(r.when) as string } : {}),
      ...(str(r.ask) ? { ask: str(r.ask) as string } : {}),
      ...(str(r.help) ? { help: str(r.help) as string } : {}),
    });
  }
  return out;
}

export function parseProofTask(raw: unknown): ProofStep[] {
  if (!Array.isArray(raw)) return [];
  const out: ProofStep[] = [];
  for (const s of raw) {
    if (!isObj(s)) continue;
    const key = str(s.key);
    const title = str(s.title);
    const kind = s.kind;
    if (!key || !KEY.test(key) || !title) continue;
    if (kind !== 'photo' && kind !== 'video' && kind !== 'audio' && kind !== 'pair' && kind !== 'text') continue;
    out.push({
      key,
      title,
      help: str(s.help) ?? '',
      kind,
      min: Math.max(0, int(s.min) ?? 1),
      ...(s.capture === 'environment' || s.capture === 'user' ? { capture: s.capture } : {}),
      ...(Array.isArray(s.tips) ? { tips: s.tips.filter((t): t is string => typeof t === 'string').slice(0, 5) } : {}),
    });
  }
  return out;
}

export function parseSuggestedPrice(raw: unknown): SuggestedPrice {
  const r = isObj(raw) ? raw : {};
  const typical = Math.max(0, int(r.typical) ?? 0);
  const low = Math.max(0, int(r.low) ?? typical);
  const high = Math.max(low, int(r.high) ?? typical);
  const perKm = int(r.per_km);
  return { typical: Math.min(Math.max(typical, low), high), low, high, ...(perKm !== null && perKm >= 0 ? { per_km: perKm } : {}) };
}

export function parseRole(row: Record<string, unknown>): Role | null {
  const slug = str(row.slug);
  const name = str(row.name);
  if (!slug || !name) return null;
  const group = (ROLE_GROUPS as readonly string[]).includes(row.role_group as string) ? (row.role_group as RoleGroup) : null;
  const status = (ROLE_STATUSES as readonly string[]).includes(row.status as string) ? (row.status as RoleStatus) : null;
  const unit = (PRICING_UNITS as readonly string[]).includes(row.pricing_unit as string) ? (row.pricing_unit as PricingUnit) : null;
  if (!group || !status || !unit) return null;
  return {
    slug,
    name,
    role_group: group,
    description: str(row.description) ?? '',
    status,
    min_age: int(row.min_age),
    legal_requirements: parseLegalRequirements(row.legal_requirements),
    proof_task: parseProofTask(row.proof_task),
    guidelines: typeof row.guidelines === 'string' ? row.guidelines : '',
    pricing_unit: unit,
    suggested_price_cents: parseSuggestedPrice(row.suggested_price_cents),
    existing_flow_href: str(row.existing_flow_href),
    sort: int(row.sort) ?? 100,
    proof_format: (PROOF_FORMATS as readonly string[]).includes(row.proof_format as string) ? (row.proof_format as ProofFormat) : 'look',
    code_prefix: typeof row.code_prefix === 'string' && /^[A-Z]{2,3}$/.test(row.code_prefix) ? row.code_prefix : null,
  };
}
