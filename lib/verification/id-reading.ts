import { validateSAID } from '@/lib/metadata/sa-id-validation';

/**
 * What the vision model read from the ID photo, cleaned, and what we store.
 *
 * The model only reads. Every judgement that can be made with arithmetic is
 * made here: the ID number's check digit, the birth date inside the number,
 * the expiry date. A person still makes the decision; these become flags.
 */

export const ID_DOCUMENT_TYPES = [
  'smart_id_card',
  'green_id_book',
  'passport',
  'drivers_licence',
  'other_id',
  'not_an_id',
] as const;
export type IdDocumentType = (typeof ID_DOCUMENT_TYPES)[number];

/** Raw reading, as the model returned it (after cleaning). */
export interface IdReading {
  document_type: IdDocumentType;
  readable: boolean;
  id_number: string | null;
  surname: string | null;
  names: string | null;
  date_of_birth: string | null;
  expiry_date: string | null;
  confidence: number;
}

/** What goes into verification_metadata.id_document. No full ID number. */
export interface IdDocumentSummary {
  document_type: IdDocumentType;
  readable: boolean;
  confidence: number;
  surname: string | null;
  names: string | null;
  date_of_birth: string | null;
  expiry_date: string | null;
  id_number_masked: string | null;
  id_number_valid: boolean | null;
  dob_matches_id_number: boolean | null;
  expired: boolean | null;
  checked_at: string;
}

function text(v: unknown, max = 80): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

function isoDate(v: unknown): string | null {
  const t = text(v, 20);
  if (!t || !/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return Number.isNaN(Date.parse(t)) ? null : t;
}

export function parseIdReading(raw: unknown): IdReading {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const type = (ID_DOCUMENT_TYPES as readonly string[]).includes(r.document_type as string)
    ? (r.document_type as IdDocumentType)
    : 'other_id';
  const digits = typeof r.id_number === 'string' ? r.id_number.replace(/\D/g, '') : '';
  const confidence = typeof r.confidence === 'number' && Number.isFinite(r.confidence)
    ? Math.min(1, Math.max(0, r.confidence))
    : 0;
  return {
    document_type: type,
    readable: r.readable === true,
    id_number: digits.length >= 6 && digits.length <= 20 ? digits : null,
    surname: text(r.surname),
    names: text(r.names),
    date_of_birth: isoDate(r.date_of_birth),
    expiry_date: isoDate(r.expiry_date),
    confidence,
  };
}

/** 9403275344080 -> 940327****080: enough for a person to compare at handover. */
export function maskIdNumber(id: string): string {
  if (id.length <= 7) return '*'.repeat(id.length);
  return id.slice(0, 6) + '*'.repeat(id.length - 9) + id.slice(-3);
}

/** A valid 13-digit SA ID number from the reading, else null. */
export function validSaIdNumber(reading: IdReading): string | null {
  if (!reading.id_number || reading.id_number.length !== 13) return null;
  return validateSAID(reading.id_number).valid ? reading.id_number : null;
}

export function summariseIdReading(reading: IdReading, now: Date): IdDocumentSummary {
  const said = reading.id_number?.length === 13 ? validateSAID(reading.id_number) : null;
  return {
    document_type: reading.document_type,
    readable: reading.readable,
    confidence: reading.confidence,
    surname: reading.surname,
    names: reading.names,
    date_of_birth: reading.date_of_birth,
    expiry_date: reading.expiry_date,
    id_number_masked: reading.id_number ? maskIdNumber(reading.id_number) : null,
    id_number_valid: reading.id_number ? Boolean(said?.valid) : null,
    dob_matches_id_number:
      said?.valid && said.dateOfBirth && reading.date_of_birth
        ? said.dateOfBirth === reading.date_of_birth
        : null,
    expired: reading.expiry_date ? Date.parse(reading.expiry_date) < now.getTime() : null,
    checked_at: now.toISOString(),
  };
}
