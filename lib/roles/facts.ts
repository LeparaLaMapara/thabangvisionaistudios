/**
 * Profile facts: what a CV, a voice note or a few typed lines say about a
 * person's work, in one strict shape. Pure.
 *
 * Privacy rules (docs/processes/roles-and-proof.md "CV, private"):
 *   - the CV itself is never shown to anyone and is deleted after
 *     ROLES_POLICY.cvRetentionDays;
 *   - ID numbers, addresses, phone numbers, emails, dates of birth and
 *     references' contact details never reach the facts or the embeddings
 *     (stripPII runs on every string, whatever the model returned);
 *   - the person reviews and edits the facts before they are saved.
 */

export interface Credit {
  project: string;
  role: string | null;
  year: number | null;
}

export interface ProfileFacts {
  roles: string[];
  skills: string[];
  years_experience: number | null;
  job_kinds: string[];
  areas: string[];
  languages: string[];
  equipment: string[];
  vehicles: string[];
  credits: Credit[];
  certifications: string[];
}

export const EMPTY_FACTS: ProfileFacts = Object.freeze({
  roles: [],
  skills: [],
  years_experience: null,
  job_kinds: [],
  areas: [],
  languages: [],
  equipment: [],
  vehicles: [],
  credits: [],
  certifications: [],
}) as ProfileFacts;

export const FACT_LIST_KEYS = ['roles', 'skills', 'job_kinds', 'areas', 'languages', 'equipment', 'vehicles', 'certifications'] as const;
type ListKey = (typeof FACT_LIST_KEYS)[number];

const MAX_ITEMS = 12;
const MAX_ITEM = 80;
const MAX_CREDITS = 15;

const PII_PATTERNS: RegExp[] = [
  /\b\d{13}\b/g, // SA ID number
  /\b\d{2}[01]\d[0-3]\d\s?\d{4}\s?\d{2}\s?\d\b/g, // spaced ID number
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, // email
  /https?:\/\/\S+/gi, // links
  /(\+27|0)[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g, // SA phone numbers
  /\b\d[\d\s-]{8,}\d\b/g, // any other long number
  /\b(19|20)\d{2}[/-](0[1-9]|1[0-2])[/-](0[1-9]|[12]\d|3[01])\b/g, // ISO-ish dates (birth dates)
  /\b(0?[1-9]|[12]\d|3[01])[/.-](0?[1-9]|1[0-2])[/.-](19|20)\d{2}\b/g, // day/month/year
  /\b\d{1,5}\s+[A-Za-z]+(\s[A-Za-z]+)?\s(street|st|road|rd|avenue|ave|drive|dr|lane|crescent|close|way)\b\.?/gi, // street addresses
  /\b(date of birth|dob|born on|id number|id no|passport no)\b[:\s]*/gi,
];

/** Remove contact details, ID numbers, dates and street addresses from one piece of text. */
export function stripPII(text: string): string {
  let t = text;
  for (const re of PII_PATTERNS) t = t.replace(re, ' ');
  return t.replace(/[<>{}`]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Words that describe a person, not their work. Kept out of facts and embeddings (equal chance). */
const IDENTITY_WORDS = /\b(he|she|him|her|his|hers|they|them|mr|mrs|ms|miss|male|female|man|woman|boy|girl|black|white|coloured|indian|asian|african|christian|muslim|jewish|married|single|years? old|aged?)\b/gi;

export function stripIdentityWords(text: string): string {
  return text.replace(IDENTITY_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

function cleanItem(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = stripIdentityWords(stripPII(v)).slice(0, MAX_ITEM).trim();
  return t.length >= 2 ? t : null;
}

function cleanList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const t = cleanItem(item);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/**
 * Validate anything (a model's answer, a browser's edit) into ProfileFacts:
 * unknown keys dropped, every string PII-stripped and capped, numbers bounded.
 */
export function sanitizeFacts(raw: unknown): ProfileFacts {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const lists = Object.fromEntries(FACT_LIST_KEYS.map((k) => [k, cleanList(r[k])])) as Record<ListKey, string[]>;
  const yearsRaw = Number(r.years_experience);
  const credits: Credit[] = [];
  if (Array.isArray(r.credits)) {
    for (const c of r.credits) {
      if (!c || typeof c !== 'object') continue;
      const cc = c as Record<string, unknown>;
      const project = cleanItem(cc.project);
      if (!project) continue;
      const year = Number(cc.year);
      credits.push({
        project,
        role: cleanItem(cc.role),
        year: Number.isInteger(year) && year >= 1970 && year <= 2100 ? year : null,
      });
      if (credits.length >= MAX_CREDITS) break;
    }
  }
  return {
    ...lists,
    years_experience: Number.isFinite(yearsRaw) && yearsRaw >= 0 && yearsRaw <= 60 ? Math.round(yearsRaw) : null,
    credits,
  };
}

export function factsAreEmpty(f: ProfileFacts): boolean {
  return FACT_LIST_KEYS.every((k) => f[k].length === 0) && f.credits.length === 0 && f.years_experience === null;
}

/** The extraction prompt. The model returns JSON in the facts shape and nothing personal. */
export function buildExtractPrompt(kind: 'cv' | 'voice' | 'text', text?: string): string {
  const source =
    kind === 'cv' ? 'The attached file is a CV (curriculum vitae).' : kind === 'voice' ? 'The attached audio is a voice note in which a person describes their work. Listen and use what they say.' : `They wrote: """${(text ?? '').slice(0, 2000)}"""`;
  return [
    'You turn a description of a person\'s work for film and photo shoots in South Africa into facts about the WORK only.',
    source,
    'Return ONLY JSON with exactly these keys:',
    '{"roles":[],"skills":[],"years_experience":null,"job_kinds":[],"areas":[],"languages":[],"equipment":[],"vehicles":[],"credits":[{"project":"","role":"","year":null}],"certifications":[]}',
    'Rules: short phrases; areas are towns or suburbs worked in, never a street address;',
    'NEVER include names of people, ID numbers, phone numbers, emails, street addresses, dates of birth, age, gender, race, religion, marital status, or references and their contact details.',
    'Use empty lists and null when unknown. No other text.',
  ].join('\n');
}

/** Facts as a few plain lines for the review screen and the profile (no personal data by construction). */
export function factsSummary(f: ProfileFacts): string[] {
  const lines: string[] = [];
  if (f.years_experience !== null) lines.push(`${f.years_experience} year${f.years_experience === 1 ? '' : 's'} of experience`);
  if (f.skills.length) lines.push(`Skills: ${f.skills.join(', ')}`);
  if (f.job_kinds.length) lines.push(`Jobs: ${f.job_kinds.join(', ')}`);
  if (f.areas.length) lines.push(`Areas: ${f.areas.join(', ')}`);
  if (f.languages.length) lines.push(`Languages: ${f.languages.join(', ')}`);
  if (f.equipment.length) lines.push(`Equipment: ${f.equipment.join(', ')}`);
  if (f.vehicles.length) lines.push(`Vehicles: ${f.vehicles.join(', ')}`);
  if (f.certifications.length) lines.push(`Certificates: ${f.certifications.join(', ')}`);
  if (f.credits.length) lines.push(`Credits: ${f.credits.map((c) => [c.project, c.role, c.year].filter(Boolean).join(', ')).join('; ')}`);
  return lines;
}
