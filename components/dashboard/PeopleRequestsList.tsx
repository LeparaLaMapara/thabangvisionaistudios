import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { formatRands, requestStatusLabel } from '@/lib/roles';
import type { ClientRequestItem } from '@/lib/supabase/queries/role-requests';

/**
 * The client's People requests (dashboard Hires), newest first. Each opens
 * its request page, where the status is spelled out and, once accepted, the
 * EFT details and reference are shown.
 */
export function PeopleRequestsList({ requests }: { requests: ClientRequestItem[] }) {
  if (requests.length === 0) {
    return (
      <div className="border border-white/10 p-6 text-center">
        <p className="text-sm text-neutral-300 mb-4">You have not asked to book anyone yet.</p>
        <Link href="/people" className="inline-flex items-center gap-2 min-h-[44px] px-5 bg-[#D4A843] text-black text-xs font-mono font-bold uppercase tracking-widest">
          Book a person <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {requests.map((r) => (
        <li key={r.id}>
          <Link href={`/people/requests/${r.id}`} className="flex items-center justify-between gap-4 border border-white/10 p-4 hover:border-[#D4A843]/40 transition-colors min-h-[44px]">
            <span className="min-w-0">
              <span className="block text-sm text-white">{r.personLabel}</span>
              <span className="block text-xs font-mono text-neutral-400 mt-1">
                {r.dates.join(', ')}
                {r.totalCents !== null ? ` · ${formatRands(r.totalCents)}` : ''}
              </span>
            </span>
            <span className="flex items-center gap-2 shrink-0 text-xs font-mono text-[#D4A843]">
              {requestStatusLabel(r.status, 'client')}
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
