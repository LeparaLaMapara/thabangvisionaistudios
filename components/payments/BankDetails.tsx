'use client';

import { useState } from 'react';
import { Check, Copy, ShieldAlert } from 'lucide-react';
import { BANK_LINES, BANK_DETAILS_NEVER_CHANGE } from '@/lib/payments/eft';

/** The business bank account, each line one tap to copy, with the scam warning. */
export function BankDetails({ reference, amount }: { reference?: string; amount?: string }) {
  const rows = [
    ...(amount ? [{ label: 'Amount', value: amount }] : []),
    ...BANK_LINES,
    ...(reference ? [{ label: 'Reference', value: reference }] : []),
  ];
  return (
    <div className="space-y-3">
      <dl className="border border-white/10 divide-y divide-white/10">
        {rows.map((r) => (
          <CopyRow key={r.label} label={r.label} value={r.value} strong={r.label === 'Reference' || r.label === 'Amount'} />
        ))}
      </dl>
      <p className="flex items-start gap-2 text-xs text-neutral-400 leading-relaxed">
        <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5 text-[#D4A843]" aria-hidden="true" />
        {BANK_DETAILS_NEVER_CHANGE}
      </p>
    </div>
  );
}

function CopyRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <div className="min-w-0">
        <dt className="text-xs font-mono uppercase tracking-widest text-neutral-400">{label}</dt>
        <dd className={`font-mono break-all ${strong ? 'text-[#D4A843] text-base' : 'text-white text-sm'}`}>{value}</dd>
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            /* copying is a convenience; the value is on screen */
          }
        }}
        aria-label={`Copy ${label.toLowerCase()}`}
        className="w-11 h-11 flex items-center justify-center text-neutral-400 hover:text-white flex-shrink-0"
      >
        {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
}
