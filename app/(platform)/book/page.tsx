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
    redirect(`/login?redirect=/book?${new URLSearchParams(params as Record<string, string>).toString()}`);
  }

  const category = params.category || '';
  const hours = parseInt(params.hours || '0', 10);
  const deliverables = params.deliverables || '';
  const location = params.location || '';
  const dates = params.dates || '';
  const creatorId = params.creator_id || null;
  const description = params.description || '';

  // Validate minimum required params
  if (!category || !hours || hours < STUDIO.booking.minBookingHours) {
    redirect('/ubunye-ai-studio');
  }

  // Calculate pricing
  const hourlyRate = getHourlyRate(category);
  const subtotal = Math.round(hourlyRate * hours);
  const vat = Math.round(subtotal * (STUDIO.booking.vatRate / 100));
  const total = subtotal + vat;

  // Get creator info if assigned
  let creatorName: string | null = null;
  if (creatorId) {
    const { data: creator } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', creatorId)
      .single();
    creatorName = creator?.display_name ?? null;
  }

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
