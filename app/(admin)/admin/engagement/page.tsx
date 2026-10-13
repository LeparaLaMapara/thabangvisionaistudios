import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth';
import { STUDIO } from '@/lib/constants';
import { createAdminClient } from '@/lib/supabase/server';
import { loadEngagementLog } from '@/lib/engagement/admin';
import { isDryRun } from '@/lib/engagement/send';
import { isUnsubscribeConfigured } from '@/lib/engagement/unsubscribe';
import { isPushConfigured } from '@/lib/push';

export const metadata: Metadata = { title: 'Customer emails (Admin)' };
export const dynamic = 'force-dynamic';

const STATUS_STYLE: Record<string, string> = {
  sent: 'border-emerald-500/40 text-emerald-300',
  pending: 'border-[#D4A843]/40 text-[#D4A843]',
  sending: 'border-[#D4A843]/40 text-[#D4A843]',
  failed: 'border-red-500/40 text-red-300',
  dead: 'border-red-500/40 text-red-300',
  skipped: 'border-neutral-700 text-neutral-400',
};

const STATUS_WORDS: Record<string, string> = {
  sent: 'Sent',
  pending: 'Queued',
  sending: 'Sending',
  failed: 'Failed, will retry',
  dead: 'Gave up',
  skipped: 'Not sent',
};

function when(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' }).format(new Date(iso));
}

/**
 * Every lifecycle email and push: welcome, "finish your signup" reminders,
 * tailored next steps, and pushes of bell items. Read only.
 */
export default async function EngagementPage() {
  const auth = await requireAdmin();
  if (auth.error) redirect('/');

  const log = await loadEngagementLog(createAdminClient());
  const setup = [
    { label: 'Unsubscribe links', ok: isUnsubscribeConfigured(), fix: 'Set ENGAGEMENT_SIGNING_SECRET. Until then no lifecycle email is sent.' },
    { label: 'Push notifications', ok: isPushConfigured(), fix: 'Set VAPID_PUBLIC_KEY, NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.' },
    { label: 'Live sending', ok: !isDryRun(), fix: 'ENGAGEMENT_DRY_RUN is true: the daily run only logs what it would send.' },
  ];

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-10">
      <header className="mb-8">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-1">Admin</p>
        <h1 className="text-2xl md:text-3xl font-display text-white tracking-tight">Customer emails</h1>
        <p className="text-sm text-neutral-400 mt-2 max-w-2xl">
          What {STUDIO.name} sends people by itself: the welcome, a reminder on day {STUDIO.engagement.nudgeAfterDays.join(' and day ')} when
          someone stops before finishing, and tailored next steps once a profile is complete (only to people who said yes to tips).
          At most {STUDIO.engagement.maxEmailsPerDay} a day and {STUDIO.engagement.maxEmailsPerWeek} a week per person. The daily job
          queues and sends them. Welcomes can still be edited at{' '}
          <Link href="/admin/welcomes" className="text-[#D4A843] underline">Welcome messages</Link>.
        </p>
      </header>

      <section className="mb-8 grid gap-3 sm:grid-cols-3" aria-label="Set up">
        {setup.map((s) => (
          <div key={s.label} className={`border p-4 text-sm ${s.ok ? 'border-neutral-800' : 'border-[#D4A843]/40'}`}>
            <p className="font-mono text-xs uppercase tracking-widest text-neutral-400">{s.label}</p>
            <p className={s.ok ? 'text-emerald-300 mt-1' : 'text-[#D4A843] mt-1'}>{s.ok ? 'Ready' : 'Not ready'}</p>
            {!s.ok && <p className="text-neutral-400 mt-1 text-xs">{s.fix}</p>}
          </div>
        ))}
      </section>

      {log === null ? (
        <p className="text-sm text-[#D4A843]">This database does not have the customer emails update yet (migration 087).</p>
      ) : (
        <>
          <section className="mb-8 grid grid-cols-3 gap-3" aria-label="Summary">
            {[
              { label: 'Sent, last 24 hours', value: log.summary.sentToday },
              { label: 'Waiting to send', value: log.summary.waiting },
              { label: 'Failed', value: log.summary.failed },
            ].map((t) => (
              <div key={t.label} className="border border-neutral-800 p-4">
                <p className="text-2xl font-display text-white">{t.value}</p>
                <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mt-1">{t.label}</p>
              </div>
            ))}
          </section>

          {log.rows.length === 0 ? (
            <p className="text-sm text-neutral-400">Nothing sent yet. The daily job runs at 02:00.</p>
          ) : (
            <ul className="space-y-3">
              {log.rows.map((r) => (
                <li key={r.id} className="border border-neutral-800 p-4">
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <p className="text-white text-sm">
                      {r.person} <span className="text-neutral-400">· {r.what}</span>
                    </p>
                    <span className={`text-xs font-mono uppercase tracking-widest border rounded px-2 py-1 ${STATUS_STYLE[r.status] ?? 'border-neutral-700 text-neutral-400'}`}>
                      {STATUS_WORDS[r.status] ?? r.status}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-neutral-400 mt-2">
                    {r.channel === 'push' ? 'Push' : 'Email'} · queued {when(r.createdAt)}
                    {r.sentAt ? ` · sent ${when(r.sentAt)}` : ''}
                    {r.attempts > 1 ? ` · ${r.attempts} tries` : ''}
                  </p>
                  {r.subject && <p className="text-sm text-neutral-300 mt-1">{r.subject}</p>}
                  {r.error && r.status !== 'sent' && <p className="text-xs text-neutral-400 mt-1">Why: {r.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
