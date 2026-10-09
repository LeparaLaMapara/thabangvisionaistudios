'use client';

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, Inbox, Play, RefreshCw } from 'lucide-react';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { formatRand } from '@/lib/format/money';
import { STUDIO } from '@/lib/constants';

/**
 * Delivery operations (spec Phase 4 §4.18): the queues a person works through
 * for deliveries and return pickups. Every action is re-checked on the server
 * by the delivery use cases; this page only shows what the server says.
 * Addresses are never listed: staff reveal one side of one shipment when they
 * need it for dispatch, and the reveal is logged.
 */

// ─── Payload types (GET /api/admin/delivery) ─────────────────────────────────

interface Shipment {
  id: string;
  bookingGroupId: string;
  leg: 'outbound' | 'return';
  attempt: number;
  renterId: string;
  ownerIds: string[];
  items: { bookingId: string; rentalId: string; serialNumber: string | null }[];
  providerId: string;
  providerKind: 'courier' | 'own_fleet';
  status: string;
  merchantReference: string;
  providerReference: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  scheduledAt: string | null;
  collectedAt: string | null;
  deliveredAt: string | null;
  acceptedAt: string | null;
  quoteAmountCents: number;
  customerFeeCents: number;
  accruedCostCents: number;
  providerCostCents: number | null;
  coverageVerified: boolean;
  updatedAt: string;
  intent: { state: string; attempts: number; lastError: string | null } | null;
}

type Row = Record<string, unknown>;

type QueueId = 'awaiting_dispatch' | 'scheduled' | 'couriers_assigned' | 'in_transit' | 'delivered_awaiting_acceptance' | 'return_pickups' | 'failed' | 'missing_damaged';

interface ReturnRequest {
  quoteId: string;
  bookingGroupId: string | null;
  renterId: string;
  customerFeeCents: number;
  requestedAt: string | null;
  windowStart: string | null;
  status: string;
}

type OpsData =
  | { pipeline: false; message: string }
  | {
      pipeline: true;
      queues: Record<QueueId, Shipment[]>;
      returnRequests: ReturnRequest[];
      incidents: Row[];
      providerFailures: { events: Row[]; dispatches: { shipmentId: string; state: string; attempts: number; lastError: string | null; updatedAt: string | null }[] };
      reconciliation: { awaitingInvoice: Shipment[]; recent: Row[] };
    };

type Notice = { kind: 'ok' | 'error'; title: string; detail?: string };

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'featured';

// ─── Helpers ────────────────────────────────────────────────────────────────

const money = (cents: number | null | undefined): string => formatRand(Number(cents ?? 0) / 100, { decimals: true });
const when = (iso: unknown): string => {
  if (typeof iso !== 'string' || !iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(STUDIO.currency.locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const short = (id: unknown): string => (typeof id === 'string' && id ? id.slice(0, 8).toUpperCase() : '—');
const label = (s: unknown): string => String(s ?? '').replace(/_/g, ' ');

/** "123.45" → 12345. Integer cents without floating point. */
function randsToCents(v: string): number | null {
  const m = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '0').padEnd(2, '0'));
}

function stateVariant(state: string): BadgeVariant {
  if (['failed', 'lost', 'damaged', 'return_to_sender', 'delivery_attempt_failed', 'dead', 'unknown', 'rejected', 'over'].includes(state)) return 'error';
  if (['incident_under_review', 'open', 'investigating', 'booking', 'under', 'claimed'].includes(state)) return 'warning';
  if (['delivered', 'matched', 'resolved'].includes(state)) return 'success';
  if (['scheduled', 'courier_assigned', 'courier_at_pickup', 'collected', 'in_transit', 'courier_at_dropoff'].includes(state)) return 'info';
  return 'default';
}

const QUEUE_TABS: { id: QueueId; label: string; hint: string }[] = [
  { id: 'awaiting_dispatch', label: 'Awaiting dispatch', hint: 'Prepared legs. Dispatch only after payment is verified; the server checks it again and never books a second courier.' },
  { id: 'scheduled', label: 'Scheduled pickups', hint: 'Booked with the provider (or our driver), not yet assigned.' },
  { id: 'couriers_assigned', label: 'Couriers assigned', hint: 'A driver is assigned or at the pickup.' },
  { id: 'in_transit', label: 'In transit', hint: 'The gear has left the sender.' },
  { id: 'delivered_awaiting_acceptance', label: 'Delivered', hint: 'Delivered, waiting for the renter to check and accept each item. Staff cannot accept for them.' },
  { id: 'return_pickups', label: 'Return pickups', hint: 'Return legs. The deposit waits until every item is received and inspected.' },
  { id: 'failed', label: 'Failed jobs', hint: 'Failed attempts, returns to sender, refused or unknown dispatches.' },
  { id: 'missing_damaged', label: 'Missing / damaged', hint: 'Lost, damaged or under review. Nobody is blamed automatically; a person decides.' },
];
const OTHER_TABS = [
  { id: 'paid_by_hand', label: 'Paid by hand' },
  { id: 'incidents', label: 'Unresolved incidents' },
  { id: 'provider', label: 'Provider failures' },
  { id: 'reconciliation', label: 'Cost reconciliation' },
] as const;
type TabId = QueueId | (typeof OTHER_TABS)[number]['id'];

const MANUAL_STATES = ['courier_assigned', 'courier_at_pickup', 'in_transit', 'courier_at_dropoff', 'delivery_attempt_failed'] as const;
const CANCELLABLE = ['requested', 'quoted', 'prepared', 'booking', 'scheduled', 'courier_assigned', 'courier_at_pickup'];
const REVIEW_STATES = ['incident_under_review', 'lost', 'damaged', 'return_to_sender'];
/** Where a review may end, per state (the core transition rules; the server checks again). */
const REVIEW_ENDS: Record<string, readonly string[]> = {
  incident_under_review: ['delivered', 'lost', 'damaged', 'failed'],
  lost: ['failed'],
  damaged: ['failed'],
  return_to_sender: ['failed'],
};
const PAY_METHODS = ['eft', 'cash', 'card_link'] as const;
const LIABILITY = ['undetermined', 'provider', 'renter', 'owner', 'platform', 'none'] as const;
const INCIDENT_KINDS = ['lost', 'damaged', 'stolen', 'delayed', 'failed_attempt', 'driver_no_show'] as const;

const inputClass = 'w-full bg-[#050505] border border-white/10 px-3 py-2 text-sm text-white min-h-[44px]';

// ─── Page ───────────────────────────────────────────────────────────────────

export default function DeliveryOpsPage() {
  const [data, setData] = useState<OpsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('awaiting_dispatch');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/delivery', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(typeof json.error === 'string' ? json.error : 'Could not load the delivery queues.');
        return;
      }
      setData(json as OpsData);
    } catch {
      setLoadError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** POST an action; show the server's answer, then reload. Returns the JSON on success. */
  const act = async (body: Row, busyKey: string, confirmText?: string): Promise<Row | null> => {
    if (confirmText && !window.confirm(confirmText)) return null;
    setBusy(busyKey);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/delivery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as Row;
      if (!res.ok) {
        setNotice({ kind: 'error', title: typeof json.error === 'string' ? json.error : `The action failed (${res.status}).` });
        return null;
      }
      const detail = ['outcome', 'status', 'refundCents', 'differenceCents']
        .filter((k) => json[k] !== undefined && json[k] !== null)
        .map((k) => (k.endsWith('Cents') ? `${label(k.replace('Cents', ''))}: ${money(Number(json[k]))}` : `${k}: ${label(json[k])}`))
        .join(' · ');
      setNotice({ kind: 'ok', title: 'Done.', detail: detail || undefined });
      if (body.action !== 'reveal_address') await load();
      return json;
    } catch {
      setNotice({ kind: 'error', title: 'Could not reach the server. Reload to see the current state before trying again.' });
      return null;
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <LoadingSpinner label="Loading delivery operations..." className="py-20" />;

  const counts: Partial<Record<TabId, number>> = {};
  if (data && data.pipeline) {
    for (const q of QUEUE_TABS) counts[q.id] = data.queues[q.id]?.length ?? 0;
    counts.incidents = data.incidents.length;
    counts.paid_by_hand = (data.returnRequests ?? []).length;
    counts.provider = data.providerFailures.events.length + data.providerFailures.dispatches.length;
    counts.reconciliation = data.reconciliation.awaitingInvoice.length;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-10">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-display font-medium uppercase text-white mb-1">Delivery ops</h1>
            <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">Deliveries, return pickups and the exceptions that need a person</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="min-h-[44px]" onClick={() => load()} disabled={busy !== null}>
              <RefreshCw className="w-3 h-3" aria-hidden="true" /> Reload
            </Button>
            {data?.pipeline && (
              <Button
                variant="accent"
                size="sm"
                className="min-h-[44px]"
                loading={busy === 'run_jobs'}
                disabled={busy !== null}
                onClick={() =>
                  act(
                    { action: 'run_jobs' },
                    'run_jobs',
                    'Run the delivery jobs now? This retries stored provider events, checks dispatches with an unknown outcome with the provider (never booking twice) and polls courier legs. Each step is idempotent.',
                  )
                }
              >
                <Play className="w-3 h-3" aria-hidden="true" /> Run delivery jobs now
              </Button>
            )}
          </div>
        </div>

        {loadError && (
          <p role="alert" className="text-sm text-red-400 mb-6">
            {loadError}
          </p>
        )}
        {notice && (
          <div role={notice.kind === 'error' ? 'alert' : 'status'} className={`mb-6 border p-4 space-y-1 ${notice.kind === 'error' ? 'border-red-500/40' : 'border-[#D4A843]/40'}`}>
            <p className={`text-sm ${notice.kind === 'error' ? 'text-red-400' : 'text-[#D4A843]'}`}>{notice.title}</p>
            {notice.detail && <p className="text-xs font-mono text-neutral-400">{notice.detail}</p>}
          </div>
        )}

        {data && !data.pipeline && (
          <div className="border border-white/10 p-6">
            <p className="text-sm text-neutral-300">{data.message}</p>
          </div>
        )}

        {data && data.pipeline && (
          <>
            <div className="overflow-x-auto mb-6">
              <Tabs
                tabs={[...QUEUE_TABS, ...OTHER_TABS].map((t) => ({ id: t.id, label: counts[t.id] ? `${t.label} (${counts[t.id]})` : t.label }))}
                activeTab={tab}
                onTabChange={(id) => {
                  setTab(id as TabId);
                  setOpen(null);
                }}
                className="min-w-max"
              />
            </div>

            {QUEUE_TABS.filter((q) => q.id === tab).map((q) => (
              <Section key={q.id} empty={data.queues[q.id].length === 0} emptyText="Nothing in this queue." hint={q.hint}>
                {data.queues[q.id].map((s) => (
                  <ShipmentRow key={s.id} s={s} open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)} busy={busy} act={act} />
                ))}
              </Section>
            ))}

            {tab === 'paid_by_hand' && (
              <Section
                empty={false}
                emptyText=""
                hint="Deliveries paid by hand (EFT, cash, card link) are never dispatched automatically. Once the payment is in, dispatch here: the server checks the order is confirmed, the quotes are the renter's and the amount is exact, then prepares and dispatches each leg. Nothing unpaid is ever dispatched."
              >
                <ManualOrderForm busy={busy} act={act} />
                {(data.returnRequests ?? []).length === 0 ? (
                  <p className="p-4 text-xs text-neutral-400">No return pickups waiting for payment.</p>
                ) : (
                  (data.returnRequests ?? []).map((r) => <ReturnRequestRow key={r.quoteId} r={r} busy={busy} act={act} />)
                )}
              </Section>
            )}

            {tab === 'incidents' && (
              <Section empty={data.incidents.length === 0} emptyText="No unresolved delivery incidents." hint="Resolving records what happened and who is liable, chosen by you. It moves no money: deposits and refunds are separate decisions.">
                {data.incidents.map((i) => (
                  <IncidentRow key={String(i.id)} i={i} busy={busy} act={act} />
                ))}
              </Section>
            )}

            {tab === 'provider' && (
              <Section
                empty={data.providerFailures.events.length + data.providerFailures.dispatches.length === 0}
                emptyText="No failed provider events or uncertain dispatches."
                hint="Dead-lettered webhooks can be requeued. A dispatch with an unknown outcome is looked up at the provider by our reference before anything is sent again."
              >
                {data.providerFailures.events.map((e) => (
                  <div key={String(e.id)} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge variant={stateVariant(String(e.processing_status))}>{label(e.processing_status)}</Badge>
                      <span className="text-sm font-mono text-white">{String(e.provider)}</span>
                      <span className="text-xs font-mono text-neutral-400">{label(e.event_type)}</span>
                    </div>
                    <Meta items={[['Ref', String(e.merchant_reference ?? e.provider_reference ?? '—')], ['Retries', String(e.retry_count)], ['Received', when(e.received_at)], ['Outcome', label(e.outcome ?? '—')]]} />
                    {typeof e.last_error === 'string' && <p className="text-xs font-mono text-red-400 break-words">{e.last_error}</p>}
                    <Button variant="outline" size="sm" className="min-h-[44px]" loading={busy === `ev:${String(e.id)}`} disabled={busy !== null} onClick={() => act({ action: 'requeue_event', id: e.id }, `ev:${String(e.id)}`)}>
                      Requeue
                    </Button>
                  </div>
                ))}
                {data.providerFailures.dispatches.map((d) => (
                  <div key={d.shipmentId} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge variant={stateVariant(d.state)}>dispatch {label(d.state)}</Badge>
                      <span className="text-xs font-mono text-neutral-400">shipment {short(d.shipmentId)}</span>
                    </div>
                    <Meta items={[['Attempts', String(d.attempts)], ['Updated', when(d.updatedAt)]]} />
                    {d.lastError && <p className="text-xs font-mono text-red-400 break-words">{d.lastError}</p>}
                    {d.state === 'unknown' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-[44px]"
                        loading={busy === `dispatch:${d.shipmentId}`}
                        disabled={busy !== null}
                        onClick={() => act({ action: 'dispatch', shipmentId: d.shipmentId }, `dispatch:${d.shipmentId}`, 'Check with the provider and record the job if it exists; only if it does not, book it again with the same reference?')}
                      >
                        Reconcile with provider
                      </Button>
                    )}
                  </div>
                ))}
              </Section>
            )}

            {tab === 'reconciliation' && (
              <Section empty={data.reconciliation.awaitingInvoice.length + data.reconciliation.recent.length === 0} emptyText="Nothing to reconcile." hint="Compare each courier invoice with what we booked. A difference becomes an adjusting ledger entry; an invoice above the quote alerts staff.">
                {data.reconciliation.awaitingInvoice.map((s) => (
                  <div key={s.id} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge variant={stateVariant(s.status)}>{label(s.status)}</Badge>
                      <span className="text-sm font-mono text-white">{s.merchantReference}</span>
                      <span className="text-xs font-mono text-neutral-400">{s.providerId}</span>
                    </div>
                    <Meta items={[['Quoted', money(s.quoteAmountCents)], ['Booked so far', money(s.accruedCostCents)], ['Customer paid', money(s.customerFeeCents)]]} />
                    <ReconcileForm s={s} busy={busy} act={act} />
                  </div>
                ))}
                {data.reconciliation.recent.map((r) => (
                  <div key={String(r.id)} className="p-4 space-y-1">
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge variant={stateVariant(String(r.status))}>{label(r.status)}</Badge>
                      <span className="text-sm font-mono text-white">{String(r.provider_invoice_ref)}</span>
                      <span className="text-xs font-mono text-neutral-400">shipment {short(r.shipment_id)}</span>
                    </div>
                    <Meta items={[['Quoted', money(Number(r.quoted_cents))], ['Invoiced', money(Number(r.invoiced_cents))], ['Difference', money(Number(r.difference_cents))], ['Checked', when(r.checked_at)]]} />
                  </div>
                ))}
              </Section>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}

type Act = (body: Row, busyKey: string, confirmText?: string) => Promise<Row | null>;

// ─── Shipment row and detail ────────────────────────────────────────────────

function ShipmentRow({ s, open, onToggle, busy, act }: { s: Shipment; open: boolean; onToggle: () => void; busy: string | null; act: Act }) {
  const [revealed, setRevealed] = useState<Record<string, Row>>({});
  const reveal = async (side: 'origin' | 'destination') => {
    const json = await act({ action: 'reveal_address', shipmentId: s.id, side }, `reveal:${s.id}:${side}`, 'Show this address? Only for dispatch. The reveal is logged with your name.');
    if (json && json.address) setRevealed((r) => ({ ...r, [side]: { ...(json.address as Row), trackingUrl: json.trackingUrl ?? null } }));
  };

  return (
    <div className="p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={stateVariant(s.status)}>{label(s.status)}</Badge>
        <Badge variant="default">{s.leg === 'outbound' ? 'to renter' : 'return'}</Badge>
        <Badge variant={s.providerKind === 'own_fleet' ? 'featured' : 'default'}>{s.providerKind === 'own_fleet' ? 'our driver' : s.providerId}</Badge>
        <span className="text-sm font-mono text-white break-all">{s.merchantReference}</span>
        {s.intent && s.intent.state !== 'succeeded' && <Badge variant={stateVariant(s.intent.state)}>dispatch {label(s.intent.state)}</Badge>}
      </div>
      <Meta
        items={[
          ['Window', s.windowStart ? `${when(s.windowStart)} – ${when(s.windowEnd)}` : 'as soon as possible'],
          ['Items', String(s.items.length)],
          ['Fee', money(s.customerFeeCents)],
          ['Order', short(s.bookingGroupId)],
          ['Renter', short(s.renterId)],
          ['Owners', s.ownerIds.map(short).join(', ') || '—'],
          ['Cover', s.coverageVerified ? 'verified' : 'none verified'],
          ['Updated', when(s.updatedAt)],
        ]}
      />
      {s.intent?.lastError && <p className="text-xs font-mono text-red-400 break-words">{s.intent.lastError}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="outline" size="sm" className="min-h-[44px]" onClick={onToggle} aria-expanded={open}>
          {open ? 'Hide details' : 'Details & actions'}
        </Button>
        {(s.status === 'prepared' || s.status === 'booking') && (
          <Button variant="accent" size="sm" className="min-h-[44px]" loading={busy === `dispatch:${s.id}`} disabled={busy !== null} onClick={() => act({ action: 'dispatch', shipmentId: s.id }, `dispatch:${s.id}`, 'Dispatch this leg? The server checks payment and the booking first and never books a second courier.')}>
            Dispatch
          </Button>
        )}
        {(['origin', 'destination'] as const).map((side) => (
          <Button key={side} variant="ghost" size="sm" className="min-h-[44px]" loading={busy === `reveal:${s.id}:${side}`} disabled={busy !== null} onClick={() => reveal(side)}>
            <Eye className="w-3 h-3" aria-hidden="true" /> {side === 'origin' ? 'Pickup address' : 'Drop-off address'}
          </Button>
        ))}
      </div>
      {Object.entries(revealed).map(([side, a]) => (
        <div key={side} className="border border-[#D4A843]/30 p-3 text-xs font-mono text-neutral-200 space-y-1">
          <p className="uppercase tracking-widest text-neutral-400">{side === 'origin' ? 'Pickup' : 'Drop-off'} (revealed, logged)</p>
          <p>{String(a.formatted_address ?? '')}</p>
          <p>
            {String(a.contact_name ?? '')} {String(a.contact_phone ?? '')}
          </p>
          {typeof a.instructions === 'string' && a.instructions && <p>Instructions: {a.instructions}</p>}
          {typeof a.trackingUrl === 'string' && (
            <a href={a.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-[#D4A843] underline min-h-[44px] inline-flex items-center">
              Tracking link
            </a>
          )}
        </div>
      ))}
      {open && <ShipmentDetail s={s} busy={busy} act={act} />}
    </div>
  );
}

function ShipmentDetail({ s, busy, act }: { s: Shipment; busy: string | null; act: Act }) {
  const [detail, setDetail] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<string | null>(null);

  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    let alive = true;
    fetchDetail(s.id).then((r) => {
      if (!alive) return;
      if ('error' in r) setError(r.error);
      else {
        setError(null);
        setDetail(r.detail);
      }
    });
    return () => {
      alive = false;
    };
  }, [s.id, version]);

  const run = async (body: Row, key: string, confirmText?: string) => {
    const ok = await act({ ...body, shipmentId: s.id }, key, confirmText);
    if (ok) {
      setForm(null);
      reload();
    }
  };

  const events = (detail?.events as Row[] | undefined) ?? [];
  const custody = (detail?.custody as Row[] | undefined) ?? [];
  const incidents = (detail?.incidents as Row[] | undefined) ?? [];
  const ownFleet = s.providerKind === 'own_fleet';

  return (
    <div className="mt-3 border border-white/10 p-4 space-y-4">
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {ownFleet && (
          <label className="flex items-center gap-2 text-xs font-mono text-neutral-400">
            <span className="uppercase tracking-widest">Driver update</span>
            <select
              className="bg-[#050505] border border-white/10 px-2 text-sm text-white min-h-[44px]"
              value=""
              disabled={busy !== null}
              onChange={(e) => e.target.value && run({ action: 'advance_manual', state: e.target.value }, `adv:${s.id}`, `Record "${label(e.target.value)}" for this leg?`)}
            >
              <option value="">Choose…</option>
              {MANUAL_STATES.map((st) => (
                <option key={st} value={st}>
                  {label(st)}
                </option>
              ))}
            </select>
          </label>
        )}
        {(['collection', 'handover', 'inspection', 'incident', 'reschedule', 'close_review', 'cancel'] as const)
          .filter((f) =>
            f === 'reschedule' ? ownFleet : f === 'cancel' ? CANCELLABLE.includes(s.status) : f === 'inspection' ? s.leg === 'return' : f === 'close_review' ? REVIEW_STATES.includes(s.status) : true,
          )
          .map((f) => (
            <Button key={f} variant={f === 'cancel' ? 'danger' : 'outline'} size="sm" className="min-h-[44px]" onClick={() => setForm(form === f ? null : f)} disabled={busy !== null}>
              {f === 'collection'
                ? 'Record collection'
                : f === 'handover'
                  ? 'Record handover'
                  : f === 'inspection'
                    ? 'Record inspection'
                    : f === 'incident'
                      ? 'Report incident'
                      : f === 'reschedule'
                        ? 'Reschedule'
                        : f === 'close_review'
                          ? 'Close review'
                          : 'Cancel leg'}
            </Button>
          ))}
      </div>

      {(form === 'collection' || form === 'handover' || form === 'inspection') && (
        <CustodyForm s={s} kind={form} busy={busy !== null} onSubmit={(body) => run(body, `custody:${s.id}`)} onCancel={() => setForm(null)} />
      )}
      {form === 'incident' && (
        <SimpleForm
          fields={[
            { name: 'kind', label: 'What happened', options: INCIDENT_KINDS },
            { name: 'description', label: 'Description', multiline: true, min: 3 },
            { name: 'photos', label: 'Photo links (one per line, from our storage)', multiline: true, optional: true },
          ]}
          submitLabel="Report incident"
          busy={busy !== null}
          onSubmit={(v) => run({ action: 'report_incident', kind: v.kind, description: v.description, photos: lines(v.photos) }, `inc:${s.id}`)}
          onCancel={() => setForm(null)}
        />
      )}
      {form === 'reschedule' && (
        <SimpleForm
          fields={[{ name: 'date', label: 'New date (YYYY-MM-DD)', min: 10 }]}
          submitLabel="Reschedule"
          busy={busy !== null}
          onSubmit={(v) => run({ action: 'reschedule', date: v.date }, `resched:${s.id}`)}
          onCancel={() => setForm(null)}
        />
      )}
      {form === 'close_review' && (
        <SimpleForm
          fields={[
            { name: 'to', label: 'Close as', options: REVIEW_ENDS[s.status] ?? ['failed'] },
            { name: 'reason', label: 'Reason (kept in the history)', multiline: true, min: 3 },
            { name: 'refundFee', label: 'Refund the delivery fee (only when closing as failed)', options: ['no', 'yes'] },
          ]}
          submitLabel="Close review"
          busy={busy !== null}
          onSubmit={(v) =>
            run(
              { action: 'close_review', to: v.to, reason: v.reason, refundFee: v.refundFee === 'yes' },
              `review:${s.id}`,
              `Close this review as "${label(v.to)}"? Incidents are resolved separately.`,
            )
          }
          onCancel={() => setForm(null)}
        />
      )}
      {form === 'cancel' && (
        <SimpleForm
          fields={[
            { name: 'reason', label: 'Reason', multiline: true, min: 3 },
            { name: 'initiatedBy', label: 'Who asked', options: ['platform', 'renter', 'provider'] },
          ]}
          submitLabel="Cancel this leg"
          danger
          busy={busy !== null}
          onSubmit={(v) => run({ action: 'cancel', reason: v.reason, initiatedBy: v.initiatedBy }, `cancel:${s.id}`, 'Cancel this leg? The delivery fee refund (less any provider fee passed on when the renter asked) is worked out by the server.')}
          onCancel={() => setForm(null)}
        />
      )}

      <div>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">Items</p>
        <ul className="text-xs font-mono text-neutral-200 space-y-1">
          {s.items.map((i) => (
            <li key={`${i.bookingId}:${i.rentalId}`}>
              booking {short(i.bookingId)} · listing {short(i.rentalId)} · serial {i.serialNumber ?? '—'}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">Chain of custody</p>
        {custody.length === 0 ? (
          <p className="text-xs text-neutral-400">No custody events yet.</p>
        ) : (
          <ul className="text-xs font-mono text-neutral-200 space-y-2">
            {custody.map((c) => (
              <li key={String(c.id)} className="space-y-1">
                <span>
                  {when(c.occurred_at)} · {label(c.kind)} · {label(c.actor_kind)} · booking {short(c.booking_id)}
                  {c.condition ? ` · condition: ${String(c.condition)}` : ''}
                  {c.serial_confirmed ? ' · serial checked' : ''}
                </span>
                <span className="flex flex-wrap gap-2">
                  {((c.evidence as { kind: string; ref: string }[] | null) ?? []).map((ev) =>
                    /^https:\/\//.test(ev.ref) ? (
                      <a key={ev.ref} href={ev.ref} target="_blank" rel="noopener noreferrer" className="text-[#D4A843] underline min-h-[44px] inline-flex items-center">
                        {label(ev.kind)}
                      </a>
                    ) : (
                      <span key={ev.ref} className="text-neutral-400">
                        {label(ev.kind)}: {ev.ref}
                      </span>
                    ),
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {incidents.length > 0 && (
        <div>
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">Incidents</p>
          <ul className="text-xs font-mono text-neutral-200 space-y-1">
            {incidents.map((i) => (
              <li key={String(i.id)}>
                {label(i.kind)} · {label(i.status)} · liability {label(i.liability)} · reported by {label(i.reported_by_kind)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400 mb-2">History</p>
        <ul className="text-xs font-mono text-neutral-300 space-y-1 max-h-64 overflow-auto">
          {events.map((e) => (
            <li key={String(e.id)}>
              {when(e.occurred_at)} · {label(e.from_status)} → {label(e.to_status)} · {label(e.source)}
              {e.note ? ` · ${String(e.note)}` : ''}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

async function fetchDetail(id: string): Promise<{ detail: Row } | { error: string }> {
  try {
    const res = await fetch(`/api/admin/delivery/${id}`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { error: typeof json.error === 'string' ? json.error : 'Could not load this delivery.' };
    return { detail: json as Row };
  } catch {
    return { error: 'Could not reach the server.' };
  }
}

const lines = (v: string | undefined): string[] =>
  (v ?? '')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);

function CustodyForm({ s, kind, busy, onSubmit, onCancel }: { s: Shipment; kind: 'collection' | 'handover' | 'inspection'; busy: boolean; onSubmit: (body: Row) => void; onCancel: () => void }) {
  const [item, setItem] = useState(`${s.items[0]?.bookingId ?? ''}:${s.items[0]?.rentalId ?? ''}`);
  const [outcome, setOutcome] = useState(s.leg === 'return' ? 'received' : 'delivered');
  const [photos, setPhotos] = useState('');
  const [condition, setCondition] = useState('');
  const [serial, setSerial] = useState(false);
  const [accessories, setAccessories] = useState('');
  const [discrepancies, setDiscrepancies] = useState('');
  const [bookingId, rentalId] = item.split(':');
  const action = kind === 'collection' ? 'record_collection' : kind === 'inspection' ? 'record_inspection' : 'record_handover';

  return (
    <form
      className="border border-white/10 p-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        onSubmit({
          action,
          bookingId,
          rentalId,
          outcome,
          photos: lines(photos),
          condition,
          serialConfirmed: serial,
          // "Lens cap: yes" per line.
          accessories: accessories
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => ({ name: l.replace(/:\s*(yes|no)$/i, '').trim(), present: !/:\s*no$/i.test(l) })),
          discrepancies: discrepancies
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean),
        });
      }}
    >
      <Field label="Item">
        <select className={inputClass} value={item} onChange={(e) => setItem(e.target.value)}>
          {s.items.map((i) => (
            <option key={`${i.bookingId}:${i.rentalId}`} value={`${i.bookingId}:${i.rentalId}`}>
              booking {short(i.bookingId)} · serial {i.serialNumber ?? '—'}
            </option>
          ))}
        </select>
      </Field>
      {kind === 'handover' && (
        <Field label="What happened">
          <select className={inputClass} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {s.leg === 'outbound' ? (
              <>
                <option value="delivered">Our driver handed it to the renter</option>
                <option value="exception">Renter reports a problem (opens an incident)</option>
              </>
            ) : (
              <option value="received">Received back by the owner / us</option>
            )}
          </select>
        </Field>
      )}
      <Field label="Photo links (one per line, uploaded through the app)">
        <textarea rows={3} className={inputClass} value={photos} onChange={(e) => setPhotos(e.target.value)} />
      </Field>
      <Field label="Condition">
        <input className={inputClass} value={condition} onChange={(e) => setCondition(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-neutral-200 min-h-[44px]">
        <input type="checkbox" checked={serial} onChange={(e) => setSerial(e.target.checked)} className="w-5 h-5" /> Serial number checked against the listing
      </label>
      <Field label='Accessories (one per line, e.g. "Battery: yes")'>
        <textarea rows={2} className={inputClass} value={accessories} onChange={(e) => setAccessories(e.target.value)} />
      </Field>
      {(kind === 'handover' || kind === 'inspection') && (
        <Field label="What is wrong or missing (one per line)">
          <textarea rows={2} className={inputClass} value={discrepancies} onChange={(e) => setDiscrepancies(e.target.value)} />
        </Field>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="accent" size="sm" className="min-h-[44px]" loading={busy}>
          Save
        </Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-[44px]" onClick={onCancel} disabled={busy}>
          Close
        </Button>
      </div>
    </form>
  );
}

function IncidentRow({ i, busy, act }: { i: Row; busy: string | null; act: Act }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={stateVariant(String(i.status))}>{label(i.status)}</Badge>
        <span className="text-sm font-mono text-white">{label(i.kind)}</span>
        <span className="text-xs font-mono text-neutral-400">{i.leg === 'outbound' ? 'to renter' : 'return'}</span>
      </div>
      <Meta
        items={[
          ['Shipment', short(i.shipment_id)],
          ['Order', short(i.booking_group_id)],
          ['Reported by', label(i.reported_by_kind)],
          ['Provider caused', i.provider_caused === null ? 'not known' : i.provider_caused ? 'yes' : 'no'],
          ['Opened', when(i.created_at)],
        ]}
      />
      {typeof i.description === 'string' && i.description && <p className="text-sm text-neutral-300 break-words">{i.description}</p>}
      {!open ? (
        <Button variant="outline" size="sm" className="min-h-[44px]" onClick={() => setOpen(true)} disabled={busy !== null}>
          Resolve
        </Button>
      ) : (
        <SimpleForm
          fields={[
            { name: 'resolution', label: 'How it was resolved', multiline: true, min: 3 },
            { name: 'liability', label: 'Liability (your decision)', options: LIABILITY },
            { name: 'providerCaused', label: 'Provider caused', options: ['not known', 'yes', 'no'] },
          ]}
          submitLabel="Resolve incident"
          busy={busy !== null}
          onSubmit={(v) =>
            act(
              { action: 'resolve_incident', incidentId: i.id, resolution: v.resolution, liability: v.liability, providerCaused: v.providerCaused === 'yes' ? true : v.providerCaused === 'no' ? false : null },
              `resolve:${String(i.id)}`,
            ).then((ok) => ok && setOpen(false))
          }
          onCancel={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function ReconcileForm({ s, busy, act }: { s: Shipment; busy: string | null; act: Act }) {
  const [ref, setRef] = useState('');
  const [amount, setAmount] = useState('');
  const cents = randsToCents(amount);
  return (
    <form
      className="flex flex-col md:flex-row gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (cents === null || ref.trim().length < 2) return;
        act({ action: 'reconcile_invoice', shipmentId: s.id, providerInvoiceRef: ref.trim(), invoicedCents: cents }, `recon:${s.id}`);
      }}
    >
      <input aria-label="Invoice reference" placeholder="Invoice reference" className={inputClass} value={ref} onChange={(e) => setRef(e.target.value)} />
      <input aria-label="Invoiced amount in rand" placeholder="Invoiced (R)" inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Button type="submit" variant="accent" size="sm" className="min-h-[44px]" loading={busy === `recon:${s.id}`} disabled={busy !== null || cents === null || ref.trim().length < 2}>
        Reconcile
      </Button>
    </form>
  );
}

// ─── Small building blocks ──────────────────────────────────────────────────

function Section({ empty, emptyText, hint, children }: { empty: boolean; emptyText: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      {hint && <p className="text-xs text-neutral-400 leading-relaxed max-w-3xl">{hint}</p>}
      {empty ? <EmptyState title="Nothing here" description={emptyText} icon={<Inbox className="w-8 h-8" />} /> : <div className="divide-y divide-white/5 border border-white/10">{children}</div>}
    </section>
  );
}

function Meta({ items }: { items: [string, string][] }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono">
      {items.map(([k, v]) => (
        <div key={k} className="flex gap-2 min-w-0">
          <dt className="text-neutral-400 uppercase tracking-widest">{k}</dt>
          <dd className="text-neutral-200 break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Field({ label: text, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">{text}</span>
      {children}
    </label>
  );
}

interface FieldSpec {
  name: string;
  label: string;
  min?: number;
  multiline?: boolean;
  optional?: boolean;
  options?: readonly string[];
}

function SimpleForm({ fields, submitLabel, busy, danger, onSubmit, onCancel }: { fields: FieldSpec[]; submitLabel: string; busy: boolean; danger?: boolean; onSubmit: (v: Record<string, string>) => void; onCancel: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.filter((f) => f.options).map((f) => [f.name, (f.options as readonly string[])[0]])));
  const valid = fields.every((f) => f.optional || f.options || (values[f.name] ?? '').trim().length >= (f.min ?? 1));
  return (
    <form
      className="border border-white/10 p-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || busy) return;
        onSubmit(Object.fromEntries(fields.map((f) => [f.name, (values[f.name] ?? '').trim()])));
      }}
    >
      {fields.map((f) => (
        <Field key={f.name} label={f.label}>
          {f.options ? (
            <select className={inputClass} value={values[f.name]} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {label(o)}
                </option>
              ))}
            </select>
          ) : f.multiline ? (
            <textarea rows={3} className={inputClass} value={values[f.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
          ) : (
            <input className={inputClass} value={values[f.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
          )}
        </Field>
      ))}
      <div className="flex gap-2">
        <Button type="submit" variant={danger ? 'danger' : 'accent'} size="sm" className="min-h-[44px]" loading={busy} disabled={!valid}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-[44px]" onClick={onCancel} disabled={busy}>
          Close
        </Button>
      </div>
    </form>
  );
}

// ─── Paid by hand (F-2, F-3) ────────────────────────────────────────────────

/** An order paid by EFT/cash at checkout: dispatch its delivery after "Mark paid". */
function ManualOrderForm({ busy, act }: { busy: string | null; act: Act }) {
  const [group, setGroup] = useState('');
  const valid = /^[0-9a-f-]{36}$/i.test(group.trim());
  return (
    <form
      className="p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        act(
          { action: 'dispatch_manual_paid', bookingGroupId: group.trim() },
          'manual-order',
          'Dispatch this order’s delivery? Only if its payment was recorded with Mark paid: the server checks the order, its delivery quotes and the delivery total recorded at checkout.',
        );
      }}
    >
      <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">Order paid by hand at checkout</p>
      <Field label="Order id (checkout group)">
        <input className={inputClass} value={group} onChange={(e) => setGroup(e.target.value)} />
      </Field>
      <Button type="submit" variant="accent" size="sm" className="min-h-[44px]" loading={busy === 'manual-order'} disabled={!valid || busy !== null}>
        Dispatch paid delivery
      </Button>
    </form>
  );
}

/** A return pickup the renter requested during the hire: confirm it once the fee was paid by hand. */
function ReturnRequestRow({ r, busy, act }: { r: ReturnRequest; busy: string | null; act: Act }) {
  const [method, setMethod] = useState<(typeof PAY_METHODS)[number]>('eft');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const cents = randsToCents(amount);
  const valid = !!r.bookingGroupId && reference.trim().length >= 2 && cents !== null;
  return (
    <form
      className="p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || cents === null) return;
        act(
          { action: 'dispatch_manual_paid', bookingGroupId: r.bookingGroupId, quoteIds: [r.quoteId], method, reference: reference.trim(), receivedCents: cents },
          `manual-req:${r.quoteId}`,
          `Record ${money(cents)} received and book this return pickup?`,
        );
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="warning">return pickup requested</Badge>
        <span className="text-xs font-mono text-neutral-400">order {short(r.bookingGroupId)}</span>
      </div>
      <Meta items={[['Price', money(r.customerFeeCents)], ['Requested', when(r.requestedAt)], ['Window', when(r.windowStart)], ['Renter', short(r.renterId)]]} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="Paid by">
          <select className={inputClass} value={method} onChange={(e) => setMethod(e.target.value as (typeof PAY_METHODS)[number])}>
            {PAY_METHODS.map((m) => (
              <option key={m} value={m}>
                {label(m)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Payment reference">
          <input className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <Field label="Amount received (R)">
          <input className={inputClass} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <Button type="submit" variant="accent" size="sm" className="min-h-[44px]" loading={busy === `manual-req:${r.quoteId}`} disabled={!valid || busy !== null}>
        Confirm payment and book pickup
      </Button>
    </form>
  );
}
