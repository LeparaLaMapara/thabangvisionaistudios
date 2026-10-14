'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Inbox, Play, RefreshCw } from 'lucide-react';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { formatRand } from '@/lib/format/money';
import { STUDIO } from '@/lib/constants';
import { useAdminUI } from '@/components/admin/shell/AdminUI';

/**
 * Rental operations (spec §7.15): the queues a person works through when the
 * gear-rental money pipeline cannot finish something on its own. Every action
 * here is re-checked by the server; this page only shows what it says.
 */

// ─── Payload types (GET /api/admin/rental-ops) ──────────────────────────────

interface RefundRow {
  id: string;
  reason: string;
  state: string;
  amount_cents: number;
  attempts: number;
  last_error: string | null;
  booking_ids: string[] | null;
  created_at: string;
  updated_at: string;
  /** Only on a failed card refund: the renter's bank account, if they added one. */
  bank?: {
    bank_name: string | null;
    account_last4: string | null;
    account_holder: string | null;
    validated: boolean;
    recipient_code: string | null;
    updated_at: string | null;
  } | null;
}

interface PayoutRow {
  id: string;
  booking_id: string;
  owner_id: string;
  state: string;
  owner_amount_cents: number;
  platform_commission_cents: number | null;
  scheduled_at: string | null;
  hold_reasons: string[] | null;
  last_error: string | null;
  transfer_reference: string | null;
}

interface EventRow {
  id: string;
  event_type: string;
  provider_reference: string | null;
  processing_status: string;
  retry_count: number;
  last_error: string | null;
  received_at: string;
  outcome: string | null;
}

interface EscalationRow {
  id: string;
  booking_id: string;
  stage: string;
  hours_late: number | null;
  created_at: string;
  acted_at: string | null;
  outcome: string | null;
}

interface IntentRow {
  reference: string;
  checkout_group_id: string | null;
  state: string;
  expected_amount_cents: number | null;
  mismatch_reason: string | null;
  updated_at: string;
}

interface OutboxRow {
  id: string;
  kind: string;
  channel: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

interface RiskRow {
  id: string;
  user_id: string;
  status: string;
  start_date: string;
  end_date: string;
}

interface JournalRow {
  idempotency_key: string;
  kind: string;
  booking_group_id: string | null;
  memo: string | null;
  created_at: string;
}

type OpsData =
  | { pipeline: false; message: string }
  | {
      pipeline: true;
      names?: Names;
      refunds: RefundRow[];
      payouts: PayoutRow[];
      events: EventRow[];
      escalations: EscalationRow[];
      unallocated: IntentRow[];
      outbox: OutboxRow[];
      risk_approvals: RiskRow[];
      recent_journals: JournalRow[];
    };

type OpsAction =
  | { action: 'retry_refund'; id: string }
  | { action: 'approve_payout'; id: string }
  | { action: 'hold_payout'; id: string; reason: string }
  | { action: 'requeue_event'; id: string }
  | { action: 'ack_escalation'; id: string; outcome: string; notes?: string }
  | { action: 'refund_unallocated'; reference: string; note: string }
  | { action: 'run_pipeline' };

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'featured';

/** What the last action produced: shown in a banner until the next one. */
type Notice = { kind: 'ok' | 'error'; title: string; detail?: string; reasons?: string[] };

// ─── Helpers ────────────────────────────────────────────────────────────────

const money = (cents: number | null | undefined): string => formatRand(Number(cents ?? 0) / 100, { decimals: true });

const when = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(STUDIO.currency.locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const short = (id: string | null | undefined): string => (id ? id.slice(0, 8).toUpperCase() : '—');

/** Names for the ids in the queues (from the API), so rows read as people and gear. */
interface Names {
  bookings: Record<string, { gear: string; renter: string; phone: string | null }>;
  orders: Record<string, { gear: string; renter: string }>;
  people: Record<string, { name: string; phone: string | null }>;
}
const NO_NAMES: Names = { bookings: {}, orders: {}, people: {} };
const label = (s: string): string => s.replace(/_/g, ' ');

/** What a refund or payout attempt came back with, for the person who pressed the button. */
const OUTCOME_WORDS: Record<string, string> = {
  submitted: 'Sent to the payment provider. It shows as done once they confirm.',
  reconciled: 'The provider already had it; it is now recorded here.',
  waiting: 'Waiting for the payment provider to answer. Check again later.',
  escalated: 'It did not go through, so it needs a person: check the payment provider, then retry or settle it by hand.',
  nothing_to_do: 'Nothing to do: it is already settled.',
  lost_race: 'Someone else handled it at the same moment. Reloaded.',
  unknown_outcome: 'No clear answer from the provider. Check their dashboard before trying again.',
};

function stateVariant(state: string): BadgeVariant {
  if (['failed', 'dead', 'needs_attention', 'mismatch', 'reversed', 'rejected', 'blocked'].includes(state)) return 'error';
  if (['held', 'refund_due', 'disputed', 'escalated'].includes(state)) return 'warning';
  if (['processed', 'success'].includes(state)) return 'success';
  if (['eligible', 'scheduled', 'approved', 'received'].includes(state)) return 'info';
  return 'default';
}

const TABS = [
  { id: 'refunds', label: 'Refunds' },
  { id: 'payouts', label: 'Payouts' },
  { id: 'events', label: 'Payment events' },
  { id: 'escalations', label: 'Overdue' },
  { id: 'unallocated', label: 'Money needing a person' },
  { id: 'outbox', label: 'Failed notifications' },
  { id: 'risk', label: 'Risk approvals' },
  { id: 'journals', label: 'Ledger' },
] as const;
type TabId = (typeof TABS)[number]['id'];

// ─── Page ───────────────────────────────────────────────────────────────────

export default function RentalOpsPage() {
  const ui = useAdminUI();
  const [data, setData] = useState<OpsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('refunds');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pipelineResult, setPipelineResult] = useState<unknown>(null);
  // One open inline form at a time: "<kind>:<id>".
  const [openForm, setOpenForm] = useState<string | null>(null);

  const NAMES: Names = (data && data.pipeline && data.names) || NO_NAMES;
  const bookingName = (id: string | null | undefined): string => {
    const b = id ? NAMES.bookings[id] : undefined;
    return b ? `${b.gear} for ${b.renter}` : `Booking ${short(id)}`;
  };
  const orderName = (id: string | null | undefined): string => {
    const o = id ? NAMES.orders[id] : undefined;
    return o ? `${o.gear} for ${o.renter}` : `Order ${short(id)}`;
  };
  const personName = (id: string | null | undefined): string => (id && NAMES.people[id]?.name) || 'an owner';

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/rental-ops', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(typeof json.error === 'string' ? json.error : 'Could not load the rental operations queues.');
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

  /** POST an action; show the server's answer, then reload the queues. */
  const act = async (body: OpsAction, busyKey: string, confirmText?: string): Promise<boolean> => {
    if (confirmText && !(await ui.confirm({ title: confirmText, action: 'Yes, go ahead' }))) return false;
    setBusy(busyKey);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/rental-ops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setNotice({
          kind: 'error',
          title: typeof json.error === 'string' ? json.error : `The action failed (${res.status}).`,
          reasons: Array.isArray(json.reasons) ? json.reasons.map(String) : undefined,
        });
        return false;
      }
      if (body.action === 'run_pipeline') {
        setPipelineResult(json);
        const errs = json.errors && typeof json.errors === 'object' ? Object.keys(json.errors as object) : [];
        setNotice({
          kind: json.ok === false || errs.length ? 'error' : 'ok',
          title: errs.length ? `Pipeline ran with ${errs.length} failing step(s).` : 'Pipeline ran.',
          reasons: errs.length ? errs.map((k) => `${k}: ${String((json.errors as Record<string, unknown>)[k])}`) : undefined,
        });
      } else {
        const outcome = json.outcome !== undefined ? String(json.outcome) : null;
        const said = outcome ? OUTCOME_WORDS[outcome] : undefined;
        const detail = [
          outcome && !said ? `Result: ${label(outcome)}` : null,
          json.created !== undefined ? `Refunds created: ${String(json.created)}` : null,
          json.result !== undefined ? `Inbox: ${JSON.stringify(json.result)}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        setNotice({
          kind: outcome === 'escalated' || outcome === 'unknown_outcome' ? 'error' : 'ok',
          title: said ?? 'Done.',
          detail: detail || undefined,
        });
      }
      setOpenForm(null);
      await load();
      return true;
    } catch {
      setNotice({ kind: 'error', title: 'Could not reach the server. Reload to see the current state before trying again.' });
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <LoadingSpinner label="Loading rental operations..." className="py-20" />;

  const counts: Partial<Record<TabId, number>> =
    data && data.pipeline
      ? {
          refunds: data.refunds.length,
          payouts: data.payouts.length,
          events: data.events.length,
          escalations: data.escalations.length,
          unallocated: data.unallocated.length,
          outbox: data.outbox.length,
          risk: data.risk_approvals.length,
          journals: data.recent_journals.length,
        }
      : {};

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-10">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-display font-medium uppercase text-white mb-1">Rental ops</h1>
            <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">
              Refunds, payouts and exceptions the pipeline needs a person for
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="min-h-[44px]" onClick={() => load()} disabled={busy !== null}>
              <RefreshCw className="w-3 h-3" aria-hidden="true" /> Reload
            </Button>
            {data?.pipeline && (
              <Button
                variant="accent"
                size="sm"
                className="min-h-[44px]"
                loading={busy === 'run_pipeline'}
                disabled={busy !== null}
                onClick={() =>
                  act(
                    { action: 'run_pipeline' },
                    'run_pipeline',
                    'Run the rental pipeline now? It retries payment events, moves refunds and payouts, runs the overdue ladder and sends queued notifications. Every step is idempotent.',
                  )
                }
              >
                <Play className="w-3 h-3" aria-hidden="true" /> Run pipeline now
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
          <div
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={`mb-6 border p-4 space-y-1 ${notice.kind === 'error' ? 'border-red-500/40' : 'border-[#D4A843]/40'}`}
          >
            <p className={`text-sm ${notice.kind === 'error' ? 'text-red-400' : 'text-[#D4A843]'}`}>{notice.title}</p>
            {notice.detail && <p className="text-xs font-mono text-neutral-400">{notice.detail}</p>}
            {notice.reasons && notice.reasons.length > 0 && (
              <ul className="list-disc pl-5 text-xs font-mono text-neutral-400 space-y-0.5">
                {notice.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {pipelineResult !== null && (
          <details className="mb-6 border border-white/10 p-4">
            <summary className="cursor-pointer text-xs font-mono uppercase tracking-widest text-neutral-400 min-h-[44px] flex items-center">
              Last pipeline run (full result)
            </summary>
            <pre className="mt-3 text-xs font-mono text-neutral-300 whitespace-pre-wrap break-all max-h-96 overflow-auto">
              {JSON.stringify(pipelineResult, null, 2)}
            </pre>
          </details>
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
                tabs={TABS.map((t) => ({ id: t.id, label: counts[t.id] ? `${t.label} (${counts[t.id]})` : t.label }))}
                activeTab={tab}
                onTabChange={(id) => {
                  setTab(id as TabId);
                  setOpenForm(null);
                }}
                className="min-w-max"
              />
            </div>

            {/* ── Refunds ── */}
            {tab === 'refunds' && (
              <Section
                empty={data.refunds.length === 0}
                emptyText="No refunds waiting. Processed refunds are not listed."
                hint="A refund is only refunded once the payment provider confirms it. Until then it is initiated (requested/pending/processing). Retry reconciles with the provider first, so it is never sent twice."
              >
                {data.refunds.map((r) => (
                  <Row key={r.id}>
                    <RowHead>
                      <Badge variant={stateVariant(r.state)}>{label(r.state)}</Badge>
                      <span className="text-sm font-mono text-white">{money(r.amount_cents)}</span>
                      <span className="text-xs font-mono text-neutral-400">{label(r.reason)}</span>
                    </RowHead>
                    <Meta
                      items={[
                        ['Attempts', String(r.attempts)],
                        ['For', (r.booking_ids ?? []).map(bookingName).join(', ') || '—'],
                        ['Created', when(r.created_at)],
                        ['Updated', when(r.updated_at)],
                      ]}
                    />
                    {r.last_error && <ErrorLine text={r.last_error} />}
                    {r.bank !== undefined && <RefundBankLine bank={r.bank} />}
                    <Actions>
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-[44px]"
                        loading={busy === `refund:${r.id}`}
                        disabled={busy !== null}
                        onClick={() =>
                          act(
                            { action: 'retry_refund', id: r.id },
                            `refund:${r.id}`,
                            `Retry this ${money(r.amount_cents)} refund with the payment provider?`,
                          )
                        }
                      >
                        Retry
                      </Button>
                    </Actions>
                  </Row>
                ))}
              </Section>
            )}

            {/* ── Payouts ── */}
            {tab === 'payouts' && (
              <Section
                empty={data.payouts.length === 0}
                emptyText="No owner payouts waiting."
                hint="Approving never bypasses the payout conditions: the server re-checks them, and holds the payout with the reasons if it is not eligible yet."
              >
                {data.payouts.map((p) => (
                  <Row key={p.id}>
                    <RowHead>
                      <Badge variant={stateVariant(p.state)}>{label(p.state)}</Badge>
                      <span className="text-sm font-mono text-white">{money(p.owner_amount_cents)}</span>
                      <span className="text-xs text-neutral-400">to {personName(p.owner_id)}</span>
                    </RowHead>
                    <Meta
                      items={[
                        ['Scheduled', when(p.scheduled_at)],
                        ['Commission', money(p.platform_commission_cents)],
                        ['For', bookingName(p.booking_id)],
                        ['Transfer ref', p.transfer_reference ?? '—'],
                      ]}
                    />
                    {p.hold_reasons && p.hold_reasons.length > 0 && (
                      <ul className="list-disc pl-5 text-xs font-mono text-amber-400 space-y-0.5">
                        {p.hold_reasons.map((h) => (
                          <li key={h}>{h}</li>
                        ))}
                      </ul>
                    )}
                    {p.last_error && <ErrorLine text={p.last_error} />}
                    <Actions>
                      {(p.state === 'scheduled' || p.state === 'held') && (
                        <Button
                          variant="accent"
                          size="sm"
                          className="min-h-[44px]"
                          loading={busy === `approve:${p.id}`}
                          disabled={busy !== null}
                          onClick={() =>
                            act(
                              { action: 'approve_payout', id: p.id },
                              `approve:${p.id}`,
                              `Approve and send ${money(p.owner_amount_cents)} to ${personName(p.owner_id)}? The transfer is submitted to the payment provider now.`,
                            )
                          }
                        >
                          Approve &amp; send
                        </Button>
                      )}
                      {(p.state === 'scheduled' || p.state === 'approved') && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-[44px]"
                          disabled={busy !== null}
                          onClick={() => setOpenForm(openForm === `hold:${p.id}` ? null : `hold:${p.id}`)}
                        >
                          Hold
                        </Button>
                      )}
                    </Actions>
                    {openForm === `hold:${p.id}` && (
                      <NoteForm
                        fields={[{ name: 'reason', label: 'Why is it held? (min 3 characters)', required: true, min: 3 }]}
                        submitLabel="Hold payout"
                        busy={busy === `hold:${p.id}`}
                        onCancel={() => setOpenForm(null)}
                        onSubmit={(v) => act({ action: 'hold_payout', id: p.id, reason: v.reason }, `hold:${p.id}`)}
                      />
                    )}
                  </Row>
                ))}
              </Section>
            )}

            {/* ── Payment events ── */}
            {tab === 'events' && (
              <Section
                empty={data.events.length === 0}
                emptyText="No payment events waiting or failed."
                hint="Provider webhooks are stored first and processed after. Failed or dead events can be requeued once the cause is fixed; received/processing ones are still in flight."
              >
                {data.events.map((e) => (
                  <Row key={e.id}>
                    <RowHead>
                      <Badge variant={stateVariant(e.processing_status)}>{label(e.processing_status)}</Badge>
                      <span className="text-sm font-mono text-white">{e.event_type}</span>
                    </RowHead>
                    <Meta
                      items={[
                        ['Reference', e.provider_reference ?? '—'],
                        ['Retries', String(e.retry_count)],
                        ['Received', when(e.received_at)],
                        ['Outcome', e.outcome ? label(e.outcome) : '—'],
                      ]}
                    />
                    {e.last_error && <ErrorLine text={e.last_error} />}
                    {(e.processing_status === 'failed' || e.processing_status === 'dead') && (
                      <Actions>
                        <Button
                          variant="outline"
                          size="sm"
                          className="min-h-[44px]"
                          loading={busy === `event:${e.id}`}
                          disabled={busy !== null}
                          onClick={() =>
                            act(
                              { action: 'requeue_event', id: e.id },
                              `event:${e.id}`,
                              'Requeue this payment event and process it again now?',
                            )
                          }
                        >
                          Requeue
                        </Button>
                      </Actions>
                    )}
                  </Row>
                ))}
              </Section>
            )}

            {/* ── Overdue escalations ── */}
            {tab === 'escalations' && (
              <Section
                empty={data.escalations.length === 0}
                emptyText="No overdue escalations waiting for a person."
                hint="Each stage of the overdue ladder waits here until someone records what they did (a call, a visit, a case opened)."
              >
                {data.escalations.map((x) => (
                  <Row key={x.id}>
                    <RowHead>
                      <Badge variant="warning">{label(x.stage)}</Badge>
                      <span className="text-sm font-mono text-white">{x.hours_late ?? 0}h late</span>
                      <Link
                        href={`/admin/bookings?open=${x.booking_id}`}
                        className="text-xs font-mono uppercase tracking-widest text-[#D4A843] underline underline-offset-4 min-h-[44px] inline-flex items-center"
                      >
                        {bookingName(x.booking_id)}
                        {NAMES.bookings[x.booking_id]?.phone ? ` · ${NAMES.bookings[x.booking_id].phone}` : ''}
                      </Link>
                    </RowHead>
                    <Meta items={[['Raised', when(x.created_at)]]} />
                    <Actions>
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-[44px]"
                        disabled={busy !== null}
                        onClick={() => setOpenForm(openForm === `ack:${x.id}` ? null : `ack:${x.id}`)}
                      >
                        Record action
                      </Button>
                    </Actions>
                    {openForm === `ack:${x.id}` && (
                      <NoteForm
                        fields={[
                          { name: 'outcome', label: 'What was done (min 3 characters)', required: true, min: 3 },
                          { name: 'notes', label: 'Notes (optional)', multiline: true },
                        ]}
                        submitLabel="Record"
                        busy={busy === `ack:${x.id}`}
                        onCancel={() => setOpenForm(null)}
                        onSubmit={(v) =>
                          act(
                            { action: 'ack_escalation', id: x.id, outcome: v.outcome, notes: v.notes || undefined },
                            `ack:${x.id}`,
                          )
                        }
                      />
                    )}
                  </Row>
                ))}
              </Section>
            )}

            {/* ── Money needing a person ── */}
            {tab === 'unallocated' && (
              <Section
                empty={data.unallocated.length === 0}
                emptyText="No unallocated money. Every payment received was matched to its order."
                hint="Payments that arrived but could not be applied (for example the wrong amount). Check the order and the provider record, then refund the full receipt. The refund is initiated with the provider, not instant."
              >
                {data.unallocated.map((i) => (
                  <Row key={i.reference}>
                    <RowHead>
                      <Badge variant={stateVariant(i.state)}>{label(i.state)}</Badge>
                      <span className="text-sm font-mono text-white">{i.reference}</span>
                    </RowHead>
                    <Meta
                      items={[
                        ['Expected', i.expected_amount_cents != null ? money(i.expected_amount_cents) : '—'],
                        ['Order', orderName(i.checkout_group_id)],
                        ['Updated', when(i.updated_at)],
                      ]}
                    />
                    {i.mismatch_reason && <ErrorLine text={i.mismatch_reason} />}
                    <Actions>
                      <Button
                        variant="danger"
                        size="sm"
                        className="min-h-[44px]"
                        disabled={busy !== null}
                        onClick={() => setOpenForm(openForm === `unalloc:${i.reference}` ? null : `unalloc:${i.reference}`)}
                      >
                        Refund in full
                      </Button>
                    </Actions>
                    {openForm === `unalloc:${i.reference}` && (
                      <NoteForm
                        fields={[{ name: 'note', label: 'What you checked (required, min 3 characters)', required: true, min: 3, multiline: true }]}
                        submitLabel="Refund the full receipt"
                        danger
                        busy={busy === `unalloc:${i.reference}`}
                        onCancel={() => setOpenForm(null)}
                        onSubmit={(v) =>
                          act(
                            { action: 'refund_unallocated', reference: i.reference, note: v.note },
                            `unalloc:${i.reference}`,
                            `Refund everything received for ${i.reference} back to the payer? This initiates a refund with the payment provider and cannot be undone.`,
                          )
                        }
                      />
                    )}
                  </Row>
                ))}
              </Section>
            )}

            {/* ── Failed notifications (read only) ── */}
            {tab === 'outbox' && (
              <Section empty={data.outbox.length === 0} emptyText="No failed notifications." hint="Read only. Running the pipeline retries notifications that can still be sent.">
                {data.outbox.map((o) => (
                  <Row key={o.id}>
                    <RowHead>
                      <Badge variant={stateVariant(o.status)}>{label(o.status)}</Badge>
                      <span className="text-sm font-mono text-white">{label(o.kind)}</span>
                      <span className="text-xs font-mono text-neutral-400">{o.channel}</span>
                    </RowHead>
                    <Meta items={[['Attempts', String(o.attempts)], ['Created', when(o.created_at)]]} />
                    {o.last_error && <ErrorLine text={o.last_error} />}
                  </Row>
                ))}
              </Section>
            )}

            {/* ── Risk approvals ── */}
            {tab === 'risk' && (
              <Section
                empty={data.risk_approvals.length === 0}
                emptyText="No bookings waiting for risk approval."
                hint="These bookings were flagged by the risk checks. A manager approves them, with a note, on the handover screen before the gear leaves."
              >
                {data.risk_approvals.map((b) => (
                  <Row key={b.id}>
                    <RowHead>
                      <Badge variant="featured">Needs risk approval</Badge>
                      <Badge variant={b.status === 'confirmed' ? 'info' : 'warning'}>{label(b.status)}</Badge>
                      <span className="text-sm text-white">{bookingName(b.id)}</span>
                    </RowHead>
                    <Meta items={[['Dates', `${b.start_date} to ${b.end_date}`], ['Renter', NAMES.bookings[b.id]?.renter ?? short(b.user_id)]]} />
                    <Actions>
                      <Link
                        href={`/admin/rentals/${b.id}/handover`}
                        className="inline-flex items-center justify-center min-h-[44px] px-4 border border-white/20 text-xs font-mono uppercase tracking-widest text-white hover:border-[#D4A843] hover:text-[#D4A843] transition-colors"
                      >
                        Open handover
                      </Link>
                    </Actions>
                  </Row>
                ))}
              </Section>
            )}

            {/* ── Recent ledger journals (read only) ── */}
            {tab === 'journals' && (
              <Section empty={data.recent_journals.length === 0} emptyText="No ledger journals yet." hint="Read only. The 50 most recent journals.">
                {data.recent_journals.map((j) => (
                  <Row key={j.idempotency_key}>
                    <RowHead>
                      <Badge variant="default">{label(j.kind)}</Badge>
                      <span className="text-xs font-mono text-neutral-300 break-all">{j.idempotency_key}</span>
                    </RowHead>
                    <Meta items={[['Order', orderName(j.booking_group_id)], ['At', when(j.created_at)]]} />
                    {j.memo && <p className="text-xs text-neutral-400">{j.memo}</p>}
                  </Row>
                ))}
              </Section>
            )}
          </>
        )}
      </motion.div>
    </div>
  );
}

// ─── Small building blocks ──────────────────────────────────────────────────

function Section({
  empty,
  emptyText,
  hint,
  children,
}: {
  empty: boolean;
  emptyText: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      {hint && <p className="text-xs text-neutral-400 leading-relaxed max-w-3xl">{hint}</p>}
      {empty ? (
        <EmptyState title="Nothing here" description={emptyText} icon={<Inbox className="w-8 h-8" />} />
      ) : (
        <div className="divide-y divide-white/5 border border-white/10">{children}</div>
      )}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="p-4 space-y-2">{children}</div>;
}

function RowHead({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
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

function ErrorLine({ text }: { text: string }) {
  return <p className="text-xs font-mono text-red-400 break-words">{text}</p>;
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2 pt-1">{children}</div>;
}

interface FieldSpec {
  name: string;
  label: string;
  required?: boolean;
  min?: number;
  multiline?: boolean;
}

/** A small inline form for actions that need words from a person. */
function NoteForm({
  fields,
  submitLabel,
  busy,
  danger,
  onSubmit,
  onCancel,
}: {
  fields: FieldSpec[];
  submitLabel: string;
  busy: boolean;
  danger?: boolean;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const valid = fields.every((f) => !f.required || (values[f.name] ?? '').trim().length >= (f.min ?? 1));
  const inputClass = 'w-full bg-[#050505] border border-white/10 px-3 py-2 text-sm text-white';

  return (
    <form
      className="mt-2 border border-white/10 p-3 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || busy) return;
        const trimmed: Record<string, string> = {};
        for (const f of fields) trimmed[f.name] = (values[f.name] ?? '').trim();
        onSubmit(trimmed);
      }}
    >
      {fields.map((f) => (
        <label key={f.name} className="block space-y-1">
          <span className="text-xs font-mono uppercase tracking-widest text-neutral-400">{f.label}</span>
          {f.multiline ? (
            <textarea
              rows={3}
              value={values[f.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              className={inputClass}
            />
          ) : (
            <input
              value={values[f.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              className={`${inputClass} min-h-[44px]`}
            />
          )}
        </label>
      ))}
      <div className="flex gap-2">
        <Button type="submit" variant={danger ? 'danger' : 'accent'} size="sm" className="min-h-[44px]" loading={busy} disabled={!valid}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="min-h-[44px]" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ── A failed card refund: has the renter added a bank account? ─────────────── */

function RefundBankLine({ bank }: { bank: NonNullable<RefundRow['bank']> | null }) {
  if (!bank) {
    return (
      <p className="text-xs font-mono text-amber-400 mt-2">
        No bank account yet. The renter has been asked to add one (email, phone and SMS when SMS is on).
      </p>
    );
  }
  return (
    <p className="text-xs font-mono text-neutral-300 mt-2">
      Bank account added: {bank.bank_name ?? 'bank'} ending {bank.account_last4 ?? '????'}, {bank.account_holder ?? 'holder not given'}
      {bank.validated ? ' (validated)' : ' (NOT validated: check the name with them)'}
      {bank.recipient_code && <> · Paystack recipient {bank.recipient_code}</>}
      . Pay it from Paystack Transfers to this recipient.
    </p>
  );
}

