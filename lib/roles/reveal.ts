/**
 * Reveal on a confirmed booking (equal chance). Pure.
 *
 * Before a booking is confirmed and paid (payment held) nobody sees a face or
 * a name. At that moment the client sees who is coming (face, first name,
 * role, Verified, record) and the booked person sees the client's first name
 * and the job: where (the address) and when. Payment for roles is not built
 * yet, so 'confirmed' on role_booking_requests is the stand-in on DEV.
 */

export type RequestStatus = 'requested' | 'confirmed' | 'withdrawn' | 'declined' | 'completed';

export interface BookingForReveal {
  status: RequestStatus;
  client_id: string;
  /** The booked person's user id (server-side only). */
  person_user_id: string;
}

export interface RevealDecision {
  /** Who is asking. */
  viewer: 'client' | 'person' | 'other';
  /** The person's face photo and first name. */
  personIdentity: boolean;
  /** The client's first name, for the person. */
  clientFirstName: boolean;
  /** The exact address, for the person. */
  address: boolean;
}

const LIVE: readonly RequestStatus[] = ['confirmed', 'completed'];

export function reveal(booking: BookingForReveal, viewerId: string | null): RevealDecision {
  const viewer = viewerId && viewerId === booking.client_id ? 'client' : viewerId && viewerId === booking.person_user_id ? 'person' : 'other';
  const live = LIVE.includes(booking.status);
  return {
    viewer,
    personIdentity: live && viewer === 'client',
    clientFirstName: live && viewer === 'person',
    address: live && viewer === 'person',
  };
}

/** Who, where, when: the one card shape every booking of a person uses. */
export interface WhosComing {
  who: {
    label: string;
    roleName: string;
    verified: boolean;
    record: string;
    /** Only after reveal. */
    firstName: string | null;
    faceUrl: string | null;
  };
  where: { area: string; address: string | null; addressNote: string };
  when: { date: string; arrival: string; duration: string };
  status: RequestStatus;
}

export function durationLabel(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '';
  const whole = Math.floor(hours);
  const half = hours - whole >= 0.5;
  const h = half ? `${whole}.5` : `${whole}`;
  return `${h} hour${hours === 1 ? '' : 's'}`;
}

export function arrivalLabel(time: string): string {
  const m = /^(\d{2}):(\d{2})/.exec(time);
  return m ? `${m[1]}:${m[2]}` : time;
}
