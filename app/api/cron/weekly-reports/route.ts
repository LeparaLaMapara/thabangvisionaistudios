export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { validateCronAuth } from '@/lib/cron/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';

/**
 * Weekly Reports — runs Monday 8am SAST (06:00 UTC)
 *
 * 1. Financial summary: revenue, commission, payouts, refunds
 * 2. User growth: new signups, new creators
 * 3. Booking funnel: paid → accepted → delivered → completed
 * 4. Email report to admin
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = validateCronAuth(request);
  if (authError) return authError;

  const supabase = createAdminClient();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const report: Record<string, unknown> = {};

  // ─── 1. Financial summary ─────────────────────────────────────────────────
  try {
    // Bookings completed this week
    const { data: completed } = await supabase
      .from('bookings')
      .select('total, platform_amount, creator_amount')
      .eq('status', 'completed')
      .gte('completed_at', weekAgo);

    const { data: paidOut } = await supabase
      .from('bookings')
      .select('creator_amount')
      .eq('payout_status', 'paid')
      .gte('paid_out_at', weekAgo);

    const { data: newBookings } = await supabase
      .from('bookings')
      .select('total')
      .eq('payment_status', 'paid')
      .gte('created_at', weekAgo);

    const totalRevenue = newBookings?.reduce((sum, b) => sum + (b.total || 0), 0) ?? 0;
    const totalCommission = completed?.reduce((sum, b) => sum + (b.platform_amount || 0), 0) ?? 0;
    const totalPayouts = paidOut?.reduce((sum, b) => sum + (b.creator_amount || 0), 0) ?? 0;

    report.financial = {
      newBookingsCount: newBookings?.length ?? 0,
      totalRevenue,
      totalCommission,
      totalPayouts,
      completedCount: completed?.length ?? 0,
    };
  } catch (err) {
    report.financialError = String(err);
  }

  // ─── 2. User growth ──────────────────────────────────────────────────────
  try {
    const { count: newUsers } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', weekAgo);

    const { count: totalUsers } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true });

    const { count: verifiedCreators } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_verified', true);

    report.users = {
      newThisWeek: newUsers ?? 0,
      total: totalUsers ?? 0,
      verifiedCreators: verifiedCreators ?? 0,
    };
  } catch (err) {
    report.usersError = String(err);
  }

  // ─── 3. Booking funnel ────────────────────────────────────────────────────
  try {
    const statuses = ['pending', 'paid', 'accepted', 'delivered', 'completed', 'paid_out', 'cancelled'];
    const funnel: Record<string, number> = {};

    for (const status of statuses) {
      const { count } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      funnel[status] = count ?? 0;
    }

    report.bookingFunnel = funnel;
  } catch (err) {
    report.bookingFunnelError = String(err);
  }

  // ─── 4. Equipment rentals this week ───────────────────────────────────────
  try {
    const { data: rentals } = await supabase
      .from('equipment_bookings')
      .select('total_price')
      .gte('created_at', weekAgo);

    report.equipmentRentals = {
      count: rentals?.length ?? 0,
      total: rentals?.reduce((sum, r) => sum + (r.total_price || 0), 0) ?? 0,
    };
  } catch (err) {
    report.equipmentRentalsError = String(err);
  }

  // ─── 5. Email report to admin ─────────────────────────────────────────────
  try {
    const fin = report.financial as { newBookingsCount: number; totalRevenue: number; totalCommission: number; totalPayouts: number; completedCount: number } | undefined;
    const users = report.users as { newThisWeek: number; total: number; verifiedCreators: number } | undefined;
    const funnel = report.bookingFunnel as Record<string, number> | undefined;
    const rentals = report.equipmentRentals as { count: number; total: number } | undefined;

    const reportText = [
      `Weekly Report — ${STUDIO.name}`,
      `Period: ${new Date(weekAgo).toLocaleDateString('en-ZA')} to ${now.toLocaleDateString('en-ZA')}`,
      '',
      '═══ FINANCIAL ═══',
      `New paid bookings: ${fin?.newBookingsCount ?? 0}`,
      `Total revenue: R${(fin?.totalRevenue ?? 0).toLocaleString()}`,
      `Platform commission: R${(fin?.totalCommission ?? 0).toLocaleString()}`,
      `Creator payouts: R${(fin?.totalPayouts ?? 0).toLocaleString()}`,
      `Bookings completed: ${fin?.completedCount ?? 0}`,
      '',
      '═══ USERS ═══',
      `New signups: ${users?.newThisWeek ?? 0}`,
      `Total users: ${users?.total ?? 0}`,
      `Verified creators: ${users?.verifiedCreators ?? 0}`,
      '',
      '═══ BOOKING PIPELINE ═══',
      ...(funnel ? Object.entries(funnel).map(([s, c]) => `${s}: ${c}`) : ['N/A']),
      '',
      '═══ EQUIPMENT RENTALS ═══',
      `Bookings this week: ${rentals?.count ?? 0}`,
      `Total value: R${(rentals?.total ?? 0).toLocaleString()}`,
    ].join('\n');

    await emailProvider.sendEmail({
      to: STUDIO.bookingEmail,
      subject: `Weekly Report — ${STUDIO.name} — ${now.toLocaleDateString('en-ZA')}`,
      text: reportText,
    });
  } catch { /* don't fail the cron */ }

  console.log('[weekly-reports]', JSON.stringify(report));

  return NextResponse.json({
    success: true,
    timestamp: now.toISOString(),
    report,
  });
}
