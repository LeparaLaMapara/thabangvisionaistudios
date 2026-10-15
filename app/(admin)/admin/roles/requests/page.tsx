'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { useAdminUI } from '@/components/admin/shell/AdminUI';
import { formatRands, requestStatusLabel, type RequestStatus } from '@/lib/roles';

/**
 * People requests (migration 095). A client asked to book a person; nothing
 * is paid. Check the date with the person (their email and phone are here),
 * then answer. Accept emails the client our bank details and a reference;
 * mark it paid once the EFT shows, and both sides are told and see each other.
 */

type Group = 'waiting' | 'accepted' | 'booked' | 'closed';

interface Contact {
  userId: string;
  name: string | null;
  email: string | null;
}

interface Item {
  id: string;
  status: RequestStatus;
  roleName: string;
  personLabel: string;
  dates: string[];
  area: string;
  totalCents: number | null;
  createdAt: string;
  reference: string;
  arrival: string;
  durationHours: number;
  address: string | null;
  note: string | null;
  clientNote: string | null;
  respondedAt: string | null;
  isDemo: boolean;
  client: Contact;
  person: Contact;
  personRoleId: string;
}

const TABS: { id: Group; label: string }[] = [
  { id: 'waiting', label: 'Waiting for an answer' },
  { id: 'accepted', label: 'Waiting for payment' },
  { id: 'booked', label: 'Booked' },
  { id: 'closed', label: 'Closed' },
];

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' });
}

export default function AdminPeopleRequestsPage() {
  const ui = useAdminUI();
  const [group, setGroup] = useState<Group>('waiting');
  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<Group, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (g: Group) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/roles/requests?group=${g}`);
      const body = (await res.json().catch(() => ({}))) as { items?: Item[]; counts?: Record<Group, number>; error?: string };
      if (res.status === 404) throw new Error('People is switched off here (the roles_v1 flag, in Site switches).');
      if (!res.ok) throw new Error(body.error ?? 'Could not load.');
      setItems(body.items ?? []);
      setCounts(body.counts ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(group);
  }, [group, load]);

  async function act(item: Item, action: 'accept' | 'decline' | 'paid') {
    const total = item.totalCents === null ? 'the total' : formatRands(item.totalCents);
    let note: string | null = null;
    if (action === 'accept') {
      const ok = await ui.confirm({
        title: `${item.person.name ?? 'They'} can do it?`,
        body: `The client is emailed to pay ${total} by EFT, with our bank details and the reference ${item.reference}. Only accept once the person has said yes.`,
        action: 'Yes, ask the client to pay',
      });
      if (!ok) return;
    } else if (action === 'paid') {
      const ok = await ui.confirm({
        title: `${total} with reference ${item.reference} has come in?`,
        body: 'The booking is confirmed. The client and the person are emailed and see each other (first name, face, the address).',
        action: 'Yes, mark it paid',
      });
      if (!ok) return;
    } else {
      const answer = await ui.ask({
        title: 'Not going ahead?',
        body: 'The client and the person are told. Add a short line for the client if it helps (optional). The client sees these words.',
        label: 'Note to the client (optional)',
        placeholder: 'They are booked that day. Someone else on People can help.',
        action: 'Close the request',
        multiline: true,
        required: false,
        danger: true,
      });
      if (answer === null) return;
      note = answer.trim() || null;
    }
    setBusy(item.id + action);
    try {
      const res = await fetch('/api/admin/roles/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action, note }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not save.');
      ui.notify(action === 'accept' ? 'Done. The client has been asked to pay.' : action === 'paid' ? 'Booked. Both sides have been told.' : 'Closed. Both sides have been told.', 'good');
      await load(group);
    } catch (e) {
      ui.notify(e instanceof Error ? e.message : 'Could not save.', 'bad');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <h1 className="text-2xl font-display text-white mb-1">People requests</h1>
      <p className="text-sm text-neutral-400 mb-6">
        Nothing is paid when a client asks. Check the date with the person, then answer the client. Accept sends our bank details and the reference; mark it paid once the EFT shows.
      </p>

      <div className="flex gap-2 overflow-x-auto mb-6" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={group === t.id}
            onClick={() => setGroup(t.id)}
            className={`shrink-0 min-h-[44px] px-4 text-sm border ${group === t.id ? 'border-accent-gold text-accent-gold' : 'border-white/15 text-neutral-300'}`}
          >
            {t.label}
            {counts ? ` (${counts[t.id]})` : ''}
          </button>
        ))}
      </div>

      {loading && <Loader2 className="w-5 h-5 animate-spin text-neutral-400" aria-label="Loading" />}
      {error && <p className="text-red-300 text-sm">{error}</p>}
      {!loading && !error && items.length === 0 && <p className="text-neutral-400 text-sm">Nothing here.</p>}

      <ul className="space-y-4">
        {items.map((item) => (
          <li key={item.id} className="border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-white text-lg">{item.roleName}</span>
              <span className="text-xs font-mono text-accent-gold">{item.reference}</span>
              <span className="text-xs text-neutral-400">{requestStatusLabel(item.status, 'client')}</span>
              {item.isDemo && <span className="text-xs px-2 py-0.5 border border-white/20 text-neutral-400">demo</span>}
              <span className="text-xs text-neutral-500">Asked {when(item.createdAt)}</span>
            </div>
            <p className="text-sm text-neutral-200">
              {item.dates.join(', ')}, arriving {item.arrival}, {item.durationHours} hours{item.dates.length > 1 ? ' each day' : ''}. {item.area}
              {item.address ? ` (${item.address})` : ''}. {item.totalCents !== null ? `Total ${formatRands(item.totalCents)}.` : ''}
            </p>
            {item.note && <p className="text-sm text-neutral-400">Client&apos;s note: {item.note}</p>}
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div className="border border-white/10 p-3">
                <p className="text-xs text-neutral-500 mb-1">Client</p>
                <p className="text-white">{item.client.name ?? '(no name)'}</p>
                <p className="text-neutral-400 break-all">{item.client.email ?? '(no email)'}</p>
              </div>
              <div className="border border-white/10 p-3">
                <p className="text-xs text-neutral-500 mb-1">Person asked</p>
                <p className="text-white">{item.person.name ?? '(no name)'}</p>
                <p className="text-neutral-400 break-all">{item.person.email ?? '(no email)'}</p>
                <Link href={`/people/${item.personRoleId}`} className="text-xs text-accent-gold underline underline-offset-4">{item.personLabel}</Link>
              </div>
            </div>
            {item.clientNote && <p className="text-xs text-neutral-400">Note sent to the client: {item.clientNote}</p>}
            <div className="flex flex-wrap gap-2">
              {item.status === 'requested' && (
                <button type="button" disabled={!!busy} onClick={() => act(item, 'accept')} className="min-h-[44px] px-4 bg-accent-gold text-black text-sm font-medium disabled:opacity-50">
                  They can do it
                </button>
              )}
              {item.status === 'accepted' && (
                <button type="button" disabled={!!busy} onClick={() => act(item, 'paid')} className="min-h-[44px] px-4 bg-accent-gold text-black text-sm font-medium disabled:opacity-50">
                  Payment came in
                </button>
              )}
              {(item.status === 'requested' || item.status === 'accepted') && (
                <button type="button" disabled={!!busy} onClick={() => act(item, 'decline')} className="min-h-[44px] px-4 border border-white/20 text-neutral-200 text-sm disabled:opacity-50">
                  Not going ahead
                </button>
              )}
              <Link href={`/people/requests/${item.id}`} className="min-h-[44px] px-4 border border-white/10 text-neutral-400 text-sm flex items-center">
                What the client sees
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
