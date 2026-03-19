import { createClient } from '@/lib/supabase/server';
import type { Booking } from '@/types/booking-system';

const CREATOR_JOIN = 'creator:profiles!creator_id(id, display_name, avatar_url, crew_slug)';

export async function getClientBookings(clientId: string): Promise<(Booking & { creator: { id: string; display_name: string; avatar_url: string | null; crew_slug: string | null } | null })[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bookings')
    .select(`*, ${CREATOR_JOIN}`)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[service-bookings] getClientBookings error:', error.message);
    return [];
  }
  return data ?? [];
}

export async function getCreatorBookings(creatorId: string) {
  const supabase = await createClient();
  // Creator does NOT see client email/phone for privacy
  const { data, error } = await supabase
    .from('bookings')
    .select('id, reference, booking_type, project_category, project_description, deliverables, duration_hours, location, preferred_dates, creator_amount, payment_status, payout_status, status, client_rating, client_review, created_at, updated_at, accepted_at, completed_at')
    .eq('creator_id', creatorId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[service-bookings] getCreatorBookings error:', error.message);
    return [];
  }
  return data ?? [];
}

export async function getBookingByReference(reference: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bookings')
    .select(`*, ${CREATOR_JOIN}`)
    .eq('reference', reference)
    .single();

  if (error) return null;
  return data;
}

export async function getBookingById(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bookings')
    .select(`*, ${CREATOR_JOIN}`)
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

export async function getAllBookings() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('bookings')
    .select(`*, ${CREATOR_JOIN}`)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[service-bookings] getAllBookings error:', error.message);
    return [];
  }
  return data ?? [];
}

/** Lazy auto-complete: bookings accepted > 30 days ago where client never marked complete */
export async function autoCompleteStaleBookings() {
  const supabase = await createClient();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('bookings')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'accepted')
    .lt('accepted_at', cutoff)
    .select('id, reference, client_email, creator_id, project_category, creator_amount');

  return data ?? [];
}

/** Get hourly rate based on project category */
export function getHourlyRate(category: string): number {
  const cat = category.toLowerCase();

  // Photography categories
  if (cat.includes('portrait') || cat.includes('product') || cat.includes('real estate') || cat.includes('corporate photo')) {
    return 1500;
  }
  // Cinematography categories
  if (cat.includes('cinematography') || cat.includes('music video') || cat.includes('corporate video') || cat.includes('documentary') || cat.includes('short film')) {
    return 2850;
  }
  // Event/wedding - use photography rate as base
  if (cat.includes('wedding photo') || cat.includes('event')) {
    return 1500;
  }
  if (cat.includes('wedding cinematography')) {
    return 2850;
  }
  // Content creation - mid-range
  if (cat.includes('content')) {
    return 1500;
  }
  // Default to photography rate
  return 1500;
}
