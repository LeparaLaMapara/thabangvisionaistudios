/**
 * "Report a problem", in the customer's words, mapped onto the dispute types
 * POST /api/disputes accepts. Pure, so it is tested.
 *
 * Before Phase 5 the gear booking page sent its own words ("damage",
 * "billing") and the field names `booking_id` / `description`; the API wants
 * `equipment_booking_id`, one of its six types and `reason`. Every report
 * from that page was refused with a 400, so a renter with a broken camera had
 * no way to tell us from the booking.
 */

export type DisputeType =
  | 'gear_damage'
  | 'gear_not_returned'
  | 'creator_no_show'
  | 'client_cancellation'
  | 'quality_dispute'
  | 'payment_dispute';

export type ReportKind = 'gear' | 'service';

export interface IssueOption {
  type: DisputeType;
  label: string;
}

/** What a renter or a client can report, most common first. */
export const ISSUE_OPTIONS: Readonly<Record<ReportKind, readonly IssueOption[]>> = {
  gear: [
    { type: 'gear_damage', label: 'Something is broken, damaged or missing' },
    { type: 'quality_dispute', label: 'The gear does not work as described' },
    { type: 'payment_dispute', label: 'A charge, deposit or refund looks wrong' },
  ],
  service: [
    { type: 'quality_dispute', label: 'The work is not what we agreed' },
    { type: 'creator_no_show', label: 'The creator did not arrive' },
    { type: 'payment_dispute', label: 'A charge or refund looks wrong' },
  ],
};

/** The API's minimum, said in the form so nobody is refused for it. */
export const REPORT_MIN_CHARS = 10;
export const REPORT_MAX_CHARS = 2000;

/** Gear booking states in which a renter can report a problem (the API refuses only cancelled and disputed). */
export const GEAR_REPORTABLE_STATUSES: readonly string[] = ['active', 'overdue', 'return_pending', 'return_reviewed', 'completed'];

export type ReportRequest =
  | { ok: true; body: { dispute_type: DisputeType; reason: string; equipment_booking_id?: string; booking_id?: string } }
  | { ok: false; message: string };

/** Build the POST /api/disputes body, or say what is missing in plain words. */
export function buildReportRequest(kind: ReportKind, bookingId: string, type: string, text: string): ReportRequest {
  const option = ISSUE_OPTIONS[kind].find((o) => o.type === type);
  if (!option) return { ok: false, message: 'Choose what went wrong.' };
  const reason = text.trim().slice(0, REPORT_MAX_CHARS);
  if (reason.length < REPORT_MIN_CHARS) {
    return { ok: false, message: `Tell us a little more: at least ${REPORT_MIN_CHARS} characters.` };
  }
  return {
    ok: true,
    body: kind === 'gear'
      ? { dispute_type: option.type, reason, equipment_booking_id: bookingId }
      : { dispute_type: option.type, reason, booking_id: bookingId },
  };
}

/** Most evidence photos one report may carry. */
export const MAX_EVIDENCE_PHOTOS = 10;

/**
 * Evidence photos as sent by the browser: a list of our own Cloudinary image
 * links, or null when it is anything else. They are shown to staff as links
 * and images, so a link to any other site is refused (stored phishing).
 */
export function evidencePhotoList(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_EVIDENCE_PHOTOS) return null;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string' || v.length > 500) return null;
    let url: URL;
    try {
      url = new URL(v);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.username || url.password || url.port) return null;
    // Our own Cloudinary account only, when it is known (any account's
    // images used to pass).
    const cloud = process.env.CLOUDINARY_CLOUD_NAME;
    if (cloud && !url.pathname.startsWith(`/${cloud}/`)) return null;
    out.push(url.href);
  }
  return out;
}
