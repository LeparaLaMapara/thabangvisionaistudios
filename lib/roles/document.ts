import { stripIdentityWords, stripPII, type ProfileFacts } from './facts';

/**
 * The profile document: what gets embedded for matching. Pure.
 *
 * Competence only (equal chance): the role, the reviewed facts, what the
 * offer comes with, the area and the record. Never a name, a face, a gender,
 * an age, a race, or the raw CV. Languages stay as a skill. It grows as the
 * record grows, so the vector improves with every job, review and vouch.
 */

export interface ProfileRecord {
  jobs: number;
  onTime: number;
  rebooked: number;
  reviewCount: number;
  averageRating: number;
  vouches: number;
  /** Credits from real ThabangVision bookings (project names only). */
  bookedCredits: string[];
}

export interface ProfileDocumentInput {
  roleName: string;
  headline: string | null;
  about: string | null;
  area: string | null;
  facts: ProfileFacts;
  comesWith: string | null;
  record: ProfileRecord;
}

const clean = (s: string | null | undefined): string => stripIdentityWords(stripPII(s ?? ''));

export function buildProfileDocument(input: ProfileDocumentInput): string {
  const f = input.facts;
  const r = input.record;
  const lines = [
    `Role: ${input.roleName}`,
    input.headline ? `Does: ${clean(input.headline)}` : '',
    input.about ? `About the work: ${clean(input.about)}` : '',
    input.area ? `Works in: ${clean(input.area)}` : '',
    f.skills.length ? `Skills: ${f.skills.join(', ')}` : '',
    f.roles.length ? `Also does: ${f.roles.join(', ')}` : '',
    f.years_experience !== null ? `Experience: ${f.years_experience} years` : '',
    f.job_kinds.length ? `Kinds of jobs: ${f.job_kinds.join(', ')}` : '',
    f.areas.length ? `Areas worked: ${f.areas.join(', ')}` : '',
    f.languages.length ? `Languages spoken: ${f.languages.join(', ')}` : '',
    f.equipment.length ? `Equipment: ${f.equipment.join(', ')}` : '',
    f.vehicles.length ? `Vehicles: ${f.vehicles.join(', ')}` : '',
    input.comesWith ? `Comes with: ${clean(input.comesWith)}` : '',
    f.certifications.length ? `Certificates: ${f.certifications.join(', ')}` : '',
    f.credits.length ? `Credits: ${f.credits.map((c) => c.project).join(', ')}` : '',
    `Record: ${r.jobs} jobs done, ${r.onTime} on time, ${r.rebooked} rebooked, ${r.reviewCount} reviews${r.reviewCount ? ` averaging ${r.averageRating.toFixed(1)}` : ''}, ${r.vouches} vouches`,
    r.bookedCredits.length ? `Booked on ThabangVision for: ${r.bookedCredits.map(clean).join(', ')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/** A short, stable hash of the document (unchanged document: no new embedding). */
export function documentHash(doc: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < doc.length; i++) {
    const c = doc.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}${doc.length.toString(16)}`;
}
