/**
 * Equal chance: what an unbooked viewer may see. Pure.
 *
 * Clients choose on the work, the record and the price. Before a confirmed
 * booking a profile shows a neutral label ("Make-up artist, Soweto, MA-1042"),
 * never a face and never a name: names signal gender and ethnicity.
 */

/** Columns of person_roles a browser may read (matches migration 091's grant). */
export const PUBLIC_PERSON_ROLE_COLUMNS =
  'id, role_slug, status, evidence_level, headline, about, area, price_cents, per_km_cents, legal_verified_at, submitted_at, approved_at, is_demo, created_at, updated_at, profile_code, facts, facts_reviewed_at, comes_with, available_days, pricing_unit';

/** Fields that identify a person. Never in a blind payload, never in an embedding. */
export const IDENTITY_FIELDS = ['user_id', 'display_name', 'first_name', 'last_name', 'full_name', 'avatar_url', 'face', 'face_url', 'selfie_with_id_path', 'email', 'phone', 'answers'] as const;

export function blindLabel(roleName: string, area: string | null | undefined, code: string | null | undefined): string {
  return [roleName, area?.trim() || null, code || null].filter(Boolean).join(' · ');
}

/** "Thandi Mokoena" -> "T.M."; empty for nothing. Reviews show initials only. */
export function initials(name: string | null | undefined): string {
  if (!name) return '';
  const parts = name.replace(/\(.*?\)/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, 3);
  return parts.map((p) => `${p.charAt(0).toUpperCase()}.`).join('');
}

/** The first name only, for the reveal after a confirmed booking. */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? '').replace(/\(.*?\)/g, ' ').trim().split(/\s+/)[0];
  return first ? first : null;
}

/** Every identity field found anywhere in a value (for tests and a server-side guard). */
export function findIdentityFields(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  const found: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${k}` : k;
    if ((IDENTITY_FIELDS as readonly string[]).includes(k) && v !== null && v !== undefined) found.push(here);
    found.push(...findIdentityFields(v, here));
  }
  return found;
}

/**
 * Work proof shows the work, not the person. Models are the one exception:
 * their digitals are the work. Used by the review checklist and the profile.
 */
export function selfieIsProof(roleSlug: string): boolean {
  return roleSlug === 'model';
}
