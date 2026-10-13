'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { Flag } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ISSUE_OPTIONS, REPORT_MAX_CHARS, REPORT_MIN_CHARS, buildReportRequest, type ReportKind } from '@/lib/disputes/report';

/**
 * Report a problem with a gear hire or a shoot. One question (what went
 * wrong), one box (what happened), then a plain answer: a person looks at it,
 * and where to follow it (comments on the dispute page; an email on resolution). The server decides what the report holds (a
 * deposit settlement, a payout); this form promises nothing more.
 */
export function ReportProblemDialog({
  kind,
  bookingId,
  isOpen,
  onClose,
  onFiled,
}: {
  kind: ReportKind;
  bookingId: string;
  isOpen: boolean;
  onClose: () => void;
  /** Called once the report is recorded. */
  onFiled: () => void;
}) {
  const id = useId();
  const options = ISSUE_OPTIONS[kind];
  const [type, setType] = useState<string>(options[0].type);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const req = buildReportRequest(kind, bookingId, type, text);
    if (!req.ok) {
      setError(req.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(
          res.status === 409
            ? 'You already have an open report for this booking. Follow it under Disputes and add anything new there.'
            : data?.error ?? 'We could not send your report. Nothing was lost: please try again.',
        );
        return;
      }
      setText('');
      onFiled();
    } catch {
      setError('We could not reach the server. Your text is still here: please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Report a problem">
      <form onSubmit={submit} className="space-y-4">
        <fieldset className="space-y-1">
          <legend className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">What went wrong?</legend>
          {options.map((o) => (
            <label key={o.type} className="flex items-center gap-3 min-h-[44px] text-sm font-mono text-neutral-200 cursor-pointer">
              <input
                type="radio"
                name={`${id}-type`}
                value={o.type}
                checked={type === o.type}
                onChange={() => setType(o.type)}
                className="accent-[#D4A843]"
              />
              {o.label}
            </label>
          ))}
        </fieldset>

        <div>
          <label htmlFor={`${id}-text`} className="block text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">
            What happened?
          </label>
          <textarea
            id={`${id}-text`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={REPORT_MAX_CHARS}
            aria-describedby={`${id}-hint`}
            placeholder={kind === 'gear' ? 'For example: the battery grip does not power the camera.' : 'For example: we agreed 100 edited photos and received 40.'}
            className="w-full bg-neutral-800 border border-white/10 text-white text-sm font-mono px-3 py-2 placeholder-neutral-500 focus:outline-none focus:border-[#D4A843]/50 resize-none"
          />
          <p id={`${id}-hint`} className="mt-1 text-xs font-mono text-neutral-400">
            At least {REPORT_MIN_CHARS} characters. You can add more detail afterwards, under{' '}
            <Link href="/dashboard/disputes" className="text-[#D4A843] underline underline-offset-2">Disputes</Link>.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-xs font-mono text-red-400">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button type="submit" variant="accent" size="sm" loading={busy} className="min-h-[44px]">
            <Flag className="w-3 h-3" aria-hidden="true" />
            Send to our team
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} className="min-h-[44px]">
            Not now
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** The confirmation shown after a report is recorded: what happens next, where to follow it. */
export function ReportFiledNote() {
  return (
    <div role="status" className="p-4 mb-6 border border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
      <p className="text-sm font-mono font-bold">We have your report</p>
      <p className="text-xs font-mono text-emerald-300/80 mt-1">
        A person on our team looks at every report. Follow it and add detail under{' '}
        <Link href="/dashboard/disputes" className="underline underline-offset-2">Disputes</Link>; we email you when it is
        resolved. Nothing is decided until a person has looked at it.
      </p>
    </div>
  );
}
