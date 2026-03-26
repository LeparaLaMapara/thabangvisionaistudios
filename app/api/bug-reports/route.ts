export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, isSafeUrl } from '@/lib/auth';
import { email as emailProvider, isEmailConfigured } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { logEvent } from '@/lib/data/events';

const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

// ─── POST — Submit a bug report ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Must be logged in to report a bug' }, { status: 401 });
  }

  if (!checkRateLimit(`bug-report:${user.id}`, 5, 3_600_000)) {
    return NextResponse.json(
      { error: 'Too many reports. Please wait before submitting another.' },
      { status: 429 },
    );
  }

  const body = await request.json();
  const {
    title,
    description,
    steps_to_reproduce,
    expected_behaviour,
    actual_behaviour,
    page_url,
    severity,
  } = body;

  // Validate required fields
  if (!title || typeof title !== 'string' || title.trim().length < 3) {
    return NextResponse.json({ error: 'Title is required (min 3 characters)' }, { status: 400 });
  }

  if (!description || typeof description !== 'string' || description.trim().length < 10) {
    return NextResponse.json({ error: 'Description is required (min 10 characters)' }, { status: 400 });
  }

  if (title.trim().length > 200) {
    return NextResponse.json({ error: 'Title too long (max 200 characters)' }, { status: 400 });
  }

  if (description.trim().length > 5000) {
    return NextResponse.json({ error: 'Description too long (max 5000 characters)' }, { status: 400 });
  }

  if (page_url && typeof page_url === 'string' && !isSafeUrl(page_url.trim())) {
    return NextResponse.json({ error: 'Invalid page URL' }, { status: 400 });
  }

  const reportSeverity = VALID_SEVERITIES.includes(severity) ? severity : 'medium';

  // Extract device info from user-agent
  const userAgent = request.headers.get('user-agent') || 'Unknown';
  const deviceInfo = extractDeviceInfo(userAgent);

  const { data: report, error } = await supabase
    .from('bug_reports')
    .insert({
      user_id: user.id,
      user_email: user.email,
      title: title.trim(),
      description: description.trim(),
      steps_to_reproduce: steps_to_reproduce?.trim()?.slice(0, 5000) || null,
      expected_behaviour: expected_behaviour?.trim()?.slice(0, 5000) || null,
      actual_behaviour: actual_behaviour?.trim()?.slice(0, 5000) || null,
      page_url: page_url?.trim() || null,
      device_info: deviceInfo,
      browser_info: userAgent,
      severity: reportSeverity,
      status: 'open',
    })
    .select('id')
    .single();

  if (error || !report) {
    console.error('[bug-reports] Insert error:', error?.message);
    return NextResponse.json({ error: 'Failed to submit bug report' }, { status: 500 });
  }

  logEvent({
    eventType: 'bug_report_created',
    eventCategory: 'support',
    userId: user.id,
    metadata: { reportId: report.id, severity: reportSeverity, title: title.trim() },
  });

  // Notify admin
  if (isEmailConfigured()) {
    try {
      await emailProvider.sendEmail({
        to: STUDIO.supportEmail,
        subject: `Bug Report [${reportSeverity.toUpperCase()}]: ${title.trim()}`,
        text: `New bug report submitted.\n\nTitle: ${title.trim()}\nSeverity: ${reportSeverity}\nReported by: ${user.email}\nPage: ${page_url || 'Not specified'}\n\nDescription:\n${description.trim()}\n\nSteps to reproduce:\n${steps_to_reproduce || 'Not provided'}\n\nExpected:\n${expected_behaviour || 'Not provided'}\n\nActual:\n${actual_behaviour || 'Not provided'}\n\nDevice: ${deviceInfo}`,
      });
    } catch { /* don't block */ }
  }

  return NextResponse.json({ success: true, reportId: report.id });
}

// ─── GET — List own bug reports ─────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('bug_reports')
    .select('id, title, severity, status, page_url, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[bug-reports] GET error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
  }

  return NextResponse.json({ reports: data ?? [] });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractDeviceInfo(ua: string): string {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}
