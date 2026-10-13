'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Truck } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { DELIVERY_CHECKOUT, DELIVERY_POLICY, STUDIO } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';

/**
 * Delivery on a booking (spec §4.17): the verified state of each leg, the
 * window, and a tracking link only when the provider gave one. Nothing is
 * invented: no courier name, ETA or location unless one was recorded. During
 * the hire the renter can see, or ask for, the return pickup.
 *
 * Once an item is delivered, the renter confirms it here: "Received" or
 * "Report a problem" (POST /api/delivery/accept). Only the renter can do this
 * (D15); without an answer the item is deemed received after
 * DELIVERY_POLICY.deemedAcceptanceHours (D-48).
 */

interface LegItem {
  booking_id: string;
  rental_id: string;
  title: string | null;
  receipt: string;
  can_confirm: boolean;
}

interface Leg {
  shipment_id: string;
  item_details?: LegItem[];
  leg: 'outbound' | 'return';
  status: string;
  status_label: string;
  window_start: string | null;
  window_end: string | null;
  window_label: string | null;
  fee_cents: number;
  courier_name: string | null;
  tracking_url: string | null;
  /** The PIN to give the driver at the door (outbound, while the gear is coming). */
  pin?: string | null;
  items: number;
  by: 'our_vehicle' | 'courier';
  /** Phase 8: gear from our studio, or collected from (and returned to) its owner (suburb at most). */
  from?: 'studio' | 'owner';
  origin_area?: string | null;
}

interface StatusResponse {
  legs: Leg[];
  open_incidents: number;
  return_pickup: { allowed: true } | { allowed: false; reason: string; message: string } | null;
  return_pickup_requested?: { fee_cents: number } | null;
}

const RECEIPT_LABEL: Record<string, string> = {
  not_sent: 'Not sent yet',
  with_courier: 'On its way',
  awaiting_renter: 'Delivered: please confirm',
  accepted: 'Received',
  exception: 'Problem reported',
};

interface PickupQuote {
  id: string;
  customer_fee_cents: number;
  window_label: string | null;
  window_start: string | null;
  expires_at: string | null;
}

const rand = (c: number): string => formatRand(c / 100, { decimals: c % 100 !== 0 });
const day = (iso: string | null): string | null =>
  iso ? new Date(iso).toLocaleDateString(STUDIO.currency.locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: DELIVERY_CHECKOUT.timeZone }) : null;

export function DeliveryPanel({ bookingId }: { bookingId: string }) {
  const id = useId();
  const [data, setData] = useState<StatusResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [windowId, setWindowId] = useState<string>(DELIVERY_CHECKOUT.windows[DELIVERY_CHECKOUT.windows.length - 1].id);
  const [quote, setQuote] = useState<PickupQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The item whose "Report a problem" form is open, and what the renter typed.
  const [problemFor, setProblemFor] = useState<string | null>(null);
  const [problemKind, setProblemKind] = useState<'damaged' | 'lost'>('damaged');
  const [problemText, setProblemText] = useState('');

  const load = useCallback(() => {
    fetch(`/api/delivery/status?booking_id=${encodeURIComponent(bookingId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: StatusResponse) => {
        setData(d);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [bookingId]);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/delivery/return-pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId, ...payload }),
      });
      return { res, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
    } finally {
      setBusy(false);
    }
  };

  const confirmItem = async (item: LegItem, outcome: 'accepted' | 'exception') => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/delivery/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: bookingId,
          items: [{ booking_id: item.booking_id, rental_id: item.rental_id, outcome, ...(outcome === 'exception' ? { kind: problemKind, detail: problemText } : {}) }],
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; results?: { ok: boolean; message?: string }[] };
      const first = body.results?.[0];
      if (res.ok && first?.ok) {
        setProblemFor(null);
        setProblemText('');
        setNote(outcome === 'accepted' ? 'Thank you. We have recorded that it arrived.' : 'Thank you. We have recorded the problem and will contact you. Nothing is charged while we check.');
        load();
      } else {
        setNote(String(first?.message ?? body.error ?? 'We could not record that just now.'));
      }
    } finally {
      setBusy(false);
    }
  };

  const getPrice = async () => {
    const { res, body } = await post({ action: 'quote', window: windowId });
    if (res.ok && body.ok && body.quote) setQuote(body.quote as PickupQuote);
    else setNote(String(body.message ?? body.error ?? 'We could not price a pickup just now.'));
  };

  const approve = async () => {
    if (!quote) return;
    const { body } = await post({ action: 'approve', quote_id: quote.id, approved_cents: quote.customer_fee_cents });
    if (body.code === 'DELIVERY_REQUOTE' || body.code === 'DELIVERY_PRICE_CHANGED') {
      setQuote((body.quote as PickupQuote) ?? null);
      setNote(String(body.error ?? 'The price changed. Please confirm the current price.'));
      return;
    }
    if (body.scheduled) {
      setQuote(null);
      setNote('Your return pickup is booked.');
      load();
      return;
    }
    if (body.requested) {
      setQuote(null);
      setNote(String(body.message ?? `Return pickup requested at ${rand(quote.customer_fee_cents)}. Our team will contact you to arrange payment.`));
      load();
      return;
    }
    setNote(String(body.error ?? 'We could not arrange the pickup just now.'));
  };

  if (failed) {
    return (
      <Card className="p-6 mb-10">
        <p className="text-xs font-mono text-neutral-400">Delivery details are not available just now.</p>
      </Card>
    );
  }
  if (!data || data.legs.length === 0) return null;

  return (
    <Card className="p-6 mb-10" data-testid="delivery-panel">
      <div className="flex items-center gap-2 mb-4">
        <Truck className="w-4 h-4 text-neutral-400" aria-hidden="true" />
        <h3 className="text-xs font-mono uppercase tracking-widest text-neutral-400">Delivery</h3>
      </div>

      <div className="space-y-5">
        {data.legs.map((l, i) => (
          <div key={`${l.leg}-${i}`} className="space-y-1 text-sm font-mono">
            <div className="flex flex-wrap justify-between gap-2">
              <span className="text-white">
                {l.leg === 'outbound' ? 'Delivery to you' : 'Return pickup'}
                {l.from === 'owner' ? (l.leg === 'outbound' ? ' from the owner' : ' back to the owner') + (l.origin_area ? ` (${l.origin_area})` : '') : ''}
              </span>
              <span className="text-[#D4A843]">{l.status_label}</span>
            </div>
            {(l.window_start || l.window_label) && (
              <p className="text-xs text-neutral-400">
                {day(l.window_start)}
                {l.window_label ? `, ${l.window_label}` : ''}
              </p>
            )}
            <p className="text-xs text-neutral-400">
              {l.by === 'our_vehicle' ? 'By our own vehicle and staff.' : `Courier: ${l.courier_name ?? 'not available yet'}.`}{' '}
              {l.by === 'our_vehicle' && (l.courier_name ? `Driver: ${l.courier_name}.` : 'Driver: not assigned yet.')}
            </p>
            {l.tracking_url ? (
              <a href={l.tracking_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-[44px] text-xs text-[#D4A843] underline underline-offset-4">
                Track this delivery
              </a>
            ) : (
              <p className="text-xs text-neutral-500">Live tracking: not available for this delivery. We message you when it moves.</p>
            )}
            {l.pin && (
              <p className="text-xs text-neutral-300">
                Your PIN for the driver: <span className="text-[#D4A843] text-base tracking-widest">{l.pin}</span>. Give it to the driver only when they hand you the gear.
              </p>
            )}
            {l.fee_cents > 0 && <p className="text-xs text-neutral-500">Fee paid: {rand(l.fee_cents)}</p>}
            {(l.item_details ?? []).length > 0 && (
              <ul className="mt-2 space-y-2">
                {(l.item_details ?? []).map((it) => {
                  const key = `${it.booking_id}:${it.rental_id}`;
                  return (
                    <li key={key} className="border border-white/10 p-3 space-y-2">
                      <div className="flex flex-wrap justify-between gap-2 text-xs">
                        <span className="text-neutral-200">{it.title || 'Item'}</span>
                        <span className="text-neutral-400">{RECEIPT_LABEL[it.receipt] ?? it.receipt}</span>
                      </div>
                      {it.can_confirm && problemFor !== key && (
                        <>
                          <p className="text-xs text-neutral-500">
                            Check it and confirm. If you do not answer, it counts as received {DELIVERY_POLICY.deemedAcceptanceHours} hours after delivery.
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <button type="button" disabled={busy} onClick={() => void confirmItem(it, 'accepted')} className="min-h-[44px] border border-[#D4A843] text-xs font-mono uppercase tracking-widest text-[#D4A843] disabled:opacity-40">
                              Received
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setProblemFor(key);
                                setProblemText('');
                              }}
                              className="min-h-[44px] border border-white/20 text-xs font-mono uppercase tracking-widest text-neutral-200 disabled:opacity-40"
                            >
                              Report a problem
                            </button>
                          </div>
                        </>
                      )}
                      {it.can_confirm && problemFor === key && (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What is wrong">
                            {(['damaged', 'lost'] as const).map((k) => (
                              <label key={k} className={`flex items-center gap-2 min-h-[44px] px-3 border text-xs font-mono cursor-pointer ${problemKind === k ? 'border-[#D4A843] text-[#D4A843]' : 'border-white/10 text-neutral-400'}`}>
                                <input type="radio" name={`${id}-${key}-kind`} className="accent-[#D4A843]" checked={problemKind === k} onChange={() => setProblemKind(k)} />
                                {k === 'damaged' ? 'Damaged or wrong' : 'Missing'}
                              </label>
                            ))}
                          </div>
                          <label className="block text-xs font-mono text-neutral-400" htmlFor={`${id}-${key}-detail`}>
                            What is wrong or missing?
                          </label>
                          <textarea
                            id={`${id}-${key}-detail`}
                            value={problemText}
                            maxLength={500}
                            onChange={(ev) => setProblemText(ev.target.value)}
                            className="w-full min-h-[88px] bg-transparent border border-white/20 p-2 text-sm font-mono text-neutral-100"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <button type="button" disabled={busy || problemText.trim().length < 3} onClick={() => void confirmItem(it, 'exception')} className="min-h-[44px] border border-[#D4A843] text-xs font-mono uppercase tracking-widest text-[#D4A843] disabled:opacity-40">
                              Send
                            </button>
                            <button type="button" disabled={busy} onClick={() => setProblemFor(null)} className="min-h-[44px] border border-white/20 text-xs font-mono uppercase tracking-widest text-neutral-400 disabled:opacity-40">
                              Back
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}

        {data.open_incidents > 0 && (
          <p role="status" className="text-xs font-mono text-amber-400">
            We are looking into a problem with this delivery and will contact you. Nothing is charged while we check.
          </p>
        )}

        {data.return_pickup && !data.return_pickup.allowed && (data.return_pickup.reason === 'collected_in_person' || data.return_pickup.reason === 'requested') && (
          <p role="status" className="text-xs font-mono text-neutral-400">
            {data.return_pickup.message}
            {data.return_pickup.reason === 'requested' && data.return_pickup_requested ? ` Pickup price: ${rand(data.return_pickup_requested.fee_cents)}.` : ''}
          </p>
        )}

        {data.return_pickup?.allowed && (
          <div className="border-t border-white/10 pt-4 space-y-3">
            <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">Return pickup on your last hire day</p>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Pickup window">
              {DELIVERY_CHECKOUT.windows.map((w) => (
                <label key={w.id} className={`flex items-center gap-2 min-h-[44px] px-3 border text-xs font-mono cursor-pointer ${windowId === w.id ? 'border-[#D4A843] text-[#D4A843]' : 'border-white/10 text-neutral-400'}`}>
                  <input
                    type="radio"
                    name={`${id}-pickup`}
                    className="accent-[#D4A843]"
                    checked={windowId === w.id}
                    onChange={() => {
                      setWindowId(w.id);
                      setQuote(null);
                    }}
                  />
                  {w.label}
                </label>
              ))}
            </div>
            {!quote ? (
              <button type="button" disabled={busy} onClick={() => void getPrice()} className="w-full min-h-[44px] border border-white/20 text-xs font-mono uppercase tracking-widest text-neutral-200 disabled:opacity-40">
                {busy ? 'Checking…' : 'Get pickup price'}
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={() => void approve()} className="w-full min-h-[44px] border border-[#D4A843] text-xs font-mono uppercase tracking-widest text-[#D4A843] disabled:opacity-40">
                {busy ? 'Sending…' : `Request pickup at ${rand(quote.customer_fee_cents)}`}
              </button>
            )}
          </div>
        )}

        {note && (
          <p role="status" className="text-xs font-mono text-neutral-300 leading-relaxed">
            {note}
          </p>
        )}
      </div>
    </Card>
  );
}
