'use client';

import { useCallback, useEffect, useState } from 'react';
import { describeActivity, type SignupActivity } from '@/lib/greetings/welcome';
import { useAdminUI } from '@/components/admin/shell/AdminUI';

interface Welcome {
  user_id: string;
  email: string | null;
  first_name: string | null;
  signup_method: string | null;
  activity: SignupActivity;
  subject: string;
  body: string;
  drafted_by: string;
  status: 'draft' | 'sending' | 'sent' | 'discarded';
  sent_at: string | null;
  created_at: string;
}

const STATUS_STYLE: Record<Welcome['status'], string> = {
  draft: 'text-[#D4A843] border-[#D4A843]/40',
  sending: 'text-neutral-300 border-neutral-600',
  sent: 'text-emerald-400 border-emerald-400/40',
  discarded: 'text-neutral-400 border-neutral-700',
};

export function WelcomeQueue() {
  const ui = useAdminUI();
  const [welcomes, setWelcomes] = useState<Welcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'draft' | 'sent' | 'all'>('draft');

  const fetchQueue = useCallback(
    () =>
      fetch('/api/admin/welcomes').then(async (res) => {
        const json = await res.json();
        return res.ok ? { welcomes: json.welcomes as Welcome[] } : { error: (json.error as string) ?? 'Could not load the queue.' };
      }),
    [],
  );

  const load = useCallback(async () => {
    const out = await fetchQueue();
    if (out.error !== undefined) setError(out.error);
    else setWelcomes(out.welcomes ?? []);
  }, [fetchQueue]);

  useEffect(() => {
    let alive = true;
    fetchQueue().then((out) => {
      if (!alive) return;
      if (out.error !== undefined) setError(out.error);
      else setWelcomes(out.welcomes ?? []);
    });
    return () => {
      alive = false;
    };
  }, [fetchQueue]);

  const backfill = async () => {
    const ok = await ui.confirm({
      title: 'Draft a welcome for everyone not yet welcomed?',
      body: 'Ubunye writes a draft for every account that has none, including people who joined long ago. Nothing is sent: each draft waits here for you.',
      action: 'Draft welcomes',
    });
    if (!ok) return;
    setBusy('backfill');
    setError(null);
    const res = await fetch('/api/admin/welcomes', { method: 'POST' });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? 'Could not draft welcomes.');
    setBusy(null);
    await load();
  };

  const act = async (userId: string, action: 'save' | 'send' | 'discard', edit?: { subject: string; body: string }) => {
    if (action === 'send') {
      const w = (welcomes ?? []).find((x) => x.user_id === userId);
      const ok = await ui.confirm({
        title: `Send the welcome to ${w?.first_name ?? 'this person'}?`,
        body: w?.email ? `It is emailed to ${w.email} now.` : 'It is emailed now.',
        action: 'Send welcome',
      });
      if (!ok) return;
    }
    setBusy(userId);
    setError(null);
    const res = await fetch(`/api/admin/welcomes/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...edit }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) setError(json.error ?? 'That did not work.');
    setBusy(null);
    await load();
  };

  const shown = (welcomes ?? []).filter((w) => filter === 'all' || w.status === filter);
  const sentCount = (welcomes ?? []).filter((w) => w.status === 'sent').length;
  const drafts = (welcomes ?? []).filter((w) => w.status === 'draft').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={backfill}
          disabled={busy !== null}
          className="min-h-[44px] px-4 rounded border border-[#D4A843] text-[#D4A843] text-xs font-mono uppercase tracking-widest disabled:opacity-50"
        >
          {busy === 'backfill' ? 'Drafting…' : 'Draft for everyone not yet welcomed'}
        </button>
        <div className="flex gap-2 text-xs font-mono">
          {(['draft', 'sent', 'all'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`min-h-[44px] px-3 rounded border ${filter === f ? 'border-white text-white' : 'border-neutral-700 text-neutral-400'}`}
            >
              {f === 'draft' ? `To send (${drafts})` : f === 'sent' ? `Sent (${sentCount})` : `All (${welcomes?.length ?? 0})`}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {welcomes === null && !error && <p className="text-sm text-neutral-400">Loading…</p>}
      {welcomes !== null && shown.length === 0 && (
        <p className="text-sm text-neutral-400">{filter === 'sent' ? 'Nothing sent yet.' : 'Nothing to send. New signups appear here within a minute.'}</p>
      )}

      {shown.map((w) => (
        <WelcomeCard key={w.user_id} welcome={w} busy={busy === w.user_id} onAct={act} />
      ))}
    </div>
  );
}

function WelcomeCard({
  welcome: w,
  busy,
  onAct,
}: {
  welcome: Welcome;
  busy: boolean;
  onAct: (userId: string, action: 'save' | 'send' | 'discard', edit?: { subject: string; body: string }) => Promise<void>;
}) {
  const [subject, setSubject] = useState(w.subject);
  const [body, setBody] = useState(w.body);
  const edited = subject !== w.subject || body !== w.body;
  const isDraft = w.status === 'draft';

  return (
    <article className="border border-white/10 rounded p-4 md:p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-white text-sm">
            {w.first_name ?? 'No name'} <span className="text-neutral-400">· {w.email}</span>
          </p>
          <p className="text-xs font-mono text-neutral-400 mt-1">
            Joined {new Date(w.created_at).toLocaleString('en-ZA')} with {w.signup_method === 'google' ? 'Google' : 'email'} ·
            drafted by {w.drafted_by}
          </p>
        </div>
        <span className={`text-xs font-mono uppercase tracking-widest border rounded px-2 py-1 ${STATUS_STYLE[w.status]}`}>
          {w.status}
          {w.sent_at ? ` ${new Date(w.sent_at).toLocaleDateString('en-ZA')}` : ''}
        </span>
      </div>

      <ul className="text-xs text-neutral-400 list-disc pl-5">
        {describeActivity(w.activity).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        disabled={!isDraft || busy}
        aria-label="Subject"
        className="w-full bg-transparent border border-white/10 rounded px-3 py-2 text-sm text-white disabled:opacity-60"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={!isDraft || busy}
        aria-label="Message"
        rows={9}
        className="w-full bg-transparent border border-white/10 rounded px-3 py-2 text-sm text-neutral-200 font-sans leading-relaxed disabled:opacity-60"
      />

      {isDraft && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={async () => {
              if (edited) await onAct(w.user_id, 'save', { subject, body });
              await onAct(w.user_id, 'send');
            }}
            disabled={busy}
            className="min-h-[44px] px-4 rounded bg-[#D4A843] text-[#050505] text-xs font-mono uppercase tracking-widest disabled:opacity-50"
          >
            {busy ? 'Working…' : edited ? 'Save and send' : 'Send'}
          </button>
          {edited && (
            <button
              onClick={() => onAct(w.user_id, 'save', { subject, body })}
              disabled={busy}
              className="min-h-[44px] px-4 rounded border border-white/20 text-white text-xs font-mono uppercase tracking-widest"
            >
              Save draft
            </button>
          )}
          <button
            onClick={() => onAct(w.user_id, 'discard')}
            disabled={busy}
            className="min-h-[44px] px-4 rounded border border-neutral-700 text-neutral-400 text-xs font-mono uppercase tracking-widest"
          >
            Don&rsquo;t send
          </button>
        </div>
      )}
    </article>
  );
}
