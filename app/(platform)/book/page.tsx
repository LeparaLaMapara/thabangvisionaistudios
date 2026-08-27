export const dynamic = 'force-dynamic';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';
import { getHourlyRate } from '@/lib/supabase/queries/service-bookings';
import BookConfirmation from './BookConfirmation';

interface BookPageProps {
  searchParams: Promise<{
    category?: string;
    hours?: string;
    deliverables?: string;
    location?: string;
    dates?: string;
    creator_id?: string;
    description?: string;
  }>;
}

export default async function BookPage({ searchParams }: BookPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // The whole target has to be encoded, not just appended. Unencoded, the
    // first `&` ended the redirect value as far as /login's searchParams.get
    // was concerned, so a quote carrying category, hours, dates and location
    // arrived back as category alone. Someone who told Ubunye everything, then
    // logged in, lost all of it but the first field.
    const query = new URLSearchParams(params as Record<string, string>).toString();
    const target = query ? `/book?${query}` : '/book';
    redirect(`/login?redirect=${encodeURIComponent(target)}`);
  }

  const category = params.category || '';
  const hours = parseInt(params.hours || '0', 10);
  const deliverables = params.deliverables || '';
  const location = params.location || '';
  const dates = params.dates || '';
  const creatorId = params.creator_id || null;
  const description = params.description || '';

  // Get creator info if assigned
  let creatorName: string | null = null;
  let creatorRate: number | null = null;
  let creatorSpecializations: string[] = [];
  if (creatorId) {
    const { data: creator } = await supabase
      .from('profiles')
      .select('display_name, hourly_rate, specializations')
      .eq('id', creatorId)
      .single();
    creatorName = creator?.display_name ?? null;
    creatorRate = (creator?.hourly_rate as number) ?? null;
    creatorSpecializations = (creator?.specializations as string[]) ?? [];
  }

  // If missing required booking details → show the booking form
  const hasAllDetails = category && hours >= STUDIO.booking.minBookingHours && dates;
  if (!hasAllDetails) {
    const { BookingForm } = await import('./BookingForm');
    const hourlyRate = category ? getHourlyRate(category) : (creatorRate ?? 0);
    return (
      <BookingForm
        creatorId={creatorId}
        creatorName={creatorName}
        creatorRate={creatorRate}
        creatorSpecializations={creatorSpecializations}
        initialCategory={category}
        initialHours={hours || STUDIO.booking.minBookingHours}
        initialLocation={location}
        initialDates={dates}
        hourlyRate={hourlyRate}
        vatRate={STUDIO.booking.vatRate}
        minHours={STUDIO.booking.minBookingHours}
        maxHours={STUDIO.booking.maxBookingHours}
      />
    );
  }

  // Calculate pricing
  const hourlyRate = getHourlyRate(category);
  const subtotal = Math.round(hourlyRate * hours);
  const vat = Math.round(subtotal * (STUDIO.booking.vatRate / 100));
  const total = subtotal + vat;

  return (
    <BookConfirmation
      category={category}
      hours={hours}
      deliverables={deliverables}
      location={location}
      dates={dates}
      description={description}
      creatorId={creatorId}
      creatorName={creatorName}
      hourlyRate={hourlyRate}
      subtotal={subtotal}
      vat={vat}
      total={total}
      vatRate={STUDIO.booking.vatRate}
      cancellationPolicy={STUDIO.booking.cancellationPolicy}
    />
  );
}
