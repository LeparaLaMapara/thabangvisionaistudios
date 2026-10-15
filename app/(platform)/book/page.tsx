export const dynamic = 'force-dynamic';

export const metadata = { title: 'Request a Shoot', robots: { index: false, follow: true } };

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { STUDIO } from '@/lib/constants';
import { getHourlyRate } from '@/lib/supabase/queries/service-bookings';
import BookConfirmation from './BookConfirmation';
import { getBookablePackage } from '@/lib/bookings/packages';
import { quoteHourly, quotePackage, packageUnitWords } from '@/lib/bookings/pricing';
import { onlinePaymentsOpen } from '@/lib/payments/status';
import { getFlag } from '@/lib/features';

interface BookPageProps {
  searchParams: Promise<{
    category?: string;
    hours?: string;
    deliverables?: string;
    location?: string;
    dates?: string;
    creator_id?: string;
    description?: string;
    production?: string;
  }>;
}

export default async function BookPage({ searchParams }: BookPageProps) {
  // With People on, a person is booked on /people at the price on their
  // profile. This older hourly and package flow (and its creator names
  // before payment) is not reachable then.
  if (await getFlag('roles_v1')) redirect('/people');
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
    redirect(`/login?redirect=${encodeURIComponent(target)}&reason=book`);
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
    // The public card: a client's session cannot read another person's
    // profiles row, so this came back empty and the page said "we confirm
    // who will shoot it" to someone who had just chosen their creator.
    const { data: creator } = await supabase
      .from('public_profiles')
      .select('display_name, hourly_rate, specializations')
      .eq('id', creatorId)
      .maybeSingle();
    creatorName = creator?.display_name ?? null;
    creatorRate = (creator?.hourly_rate as number) ?? null;
    creatorSpecializations = (creator?.specializations as string[]) ?? [];
  }

  // A studio package ("Family Birthday"): booked at its own price, read here
  // on the server, so the price on the studio page is the price charged.
  const pkg = params.production ? await getBookablePackage(supabase, params.production) : null;
  const pkgInfo = pkg
    ? { id: pkg.id, title: pkg.title, price: pkg.price, unit: pkg.priceUnit, unitWords: packageUnitWords(pkg.priceUnit) }
    : null;
  if (pkg && !creatorId && pkg.creatorId) {
    const { data: creator } = await supabase.from('public_profiles').select('display_name').eq('id', pkg.creatorId).maybeSingle();
    creatorName = creator?.display_name ?? null;
  }

  // If missing required booking details → show the booking form
  const hasAllDetails = pkg
    ? !!dates && (pkg.priceUnit !== 'hour' || hours >= STUDIO.booking.minBookingHours)
    : category && hours >= STUDIO.booking.minBookingHours && dates;
  if (!hasAllDetails) {
    const { BookingForm } = await import('./BookingForm');
    // The rate charged is the shoot type's (POST /api/service-bookings), never the profile's.
    const hourlyRate = category ? getHourlyRate(category) : 0;
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
        minHours={STUDIO.booking.minBookingHours}
        maxHours={STUDIO.booking.maxBookingHours}
        pkg={pkgInfo}
        paymentsOpen={onlinePaymentsOpen()}
      />
    );
  }

  // Calculate pricing: the package's own price, or the hourly rate.
  const bookedHours = pkg && pkg.priceUnit !== 'hour' ? (pkg.hours ?? STUDIO.booking.minBookingHours) : hours;
  const hourlyRate = pkg ? 0 : getHourlyRate(category);
  const quote = pkg
    ? quotePackage(pkg.price, pkg.priceUnit, bookedHours)
    : quoteHourly(hourlyRate, hours);
  const { total } = quote;

  return (
    <BookConfirmation
      category={pkg ? pkg.title : category}
      hours={bookedHours}
      pkg={pkgInfo}
      rateLine={quote.line}
      deliverables={deliverables}
      location={location}
      dates={dates}
      description={description}
      creatorId={creatorId}
      creatorName={creatorName}
      hourlyRate={hourlyRate}
      total={total}
      cancellationPolicy={STUDIO.booking.cancellationPolicy}
      paymentsOpen={onlinePaymentsOpen()}
    />
  );
}
