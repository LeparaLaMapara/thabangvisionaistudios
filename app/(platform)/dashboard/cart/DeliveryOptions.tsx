'use client';

import { useEffect, useId, useState } from 'react';
import { DELIVERY_CHECKOUT, STUDIO } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';

/**
 * Delivery at checkout (spec §4.17), our own vehicle only today.
 *
 * The renter types the address; the server verifies it and returns a stored,
 * expiring quote. This component never works out a price and never sends a
 * position: the figure shown is the server's quote, and the checkout charges
 * that stored quote, re-quoting (with the renter's approval) if it expired.
 */

export interface PublicQuote {
  id: string | null;
  leg: 'outbound' | 'return';
  provider_kind: 'courier' | 'own_fleet';
  customer_fee_cents: number;
  expires_at: string | null;
  window_start: string | null;
  window_end: string | null;
  window_label: string | null;
}

export interface AddressFields {
  street: string;
  suburb: string;
  city: string;
  postalCode: string;
}

export type DeliverySelection =
  | { kind: 'quote'; outboundId: string; returnId: string | null; totalCents: number; quotes: PublicQuote[]; addressSummary: string }
  | { kind: 'legacy'; address: AddressFields; totalCents: number; quotes: PublicQuote[]; addressSummary: string };

/** A changed delivery total the server wants the renter to approve (D07). */
export interface PendingApproval {
  message: string;
  totalCents: number;
  quotes: PublicQuote[];
}

export interface DeliveryEligibility {
  delivery_available: boolean;
  code?: string;
  message?: string;
}

export const centsToRand = (c: number): string => formatRand(c / 100, { decimals: c % 100 !== 0 });

/** Build a selection from quotes the server returned. Null when there is no outbound quote. */
export function selectionFromQuotes(quotes: PublicQuote[], addressSummary: string, legacyAddress?: AddressFields): DeliverySelection | null {
  const out = quotes.find((q) => q.leg === 'outbound');
  if (!out) return null;
  const totalCents = quotes.reduce((s, q) => s + q.customer_fee_cents, 0);
  if (!out.id) return legacyAddress ? { kind: 'legacy', address: legacyAddress, totalCents, quotes, addressSummary } : null;
  return { kind: 'quote', outboundId: out.id, returnId: quotes.find((q) => q.leg === 'return')?.id ?? null, totalCents, quotes, addressSummary };
}

/** Whether the renter may have this cart delivered (GET /api/delivery/eligibility). */
export function useDeliveryEligibility(key: string | null): DeliveryEligibility | null {
  const [state, setState] = useState<DeliveryEligibility | null>(null);
  useEffect(() => {
    if (!key) return;
    let active = true;
    fetch('/api/delivery/eligibility')
      .then((r) => r.json().catch(() => null))
      .then((d: DeliveryEligibility | null) => {
        if (active) setState(d && typeof d.delivery_available === 'boolean' ? d : { delivery_available: false, message: 'We could not check delivery just now. You can collect in person.' });
      })
      .catch(() => {
        if (active) setState({ delivery_available: false, message: 'We could not check delivery just now. You can collect in person.' });
      });
    return () => {
      active = false;
    };
  }, [key]);
  return key ? state : null;
}

const INPUT =
  'w-full bg-neutral-900 border border-white/10 text-white px-3 py-3 min-h-[44px] text-base md:text-sm font-mono placeholder:text-neutral-500 focus:outline-none focus:border-[#D4A843]/60';
const LABEL = 'block text-xs font-mono uppercase tracking-widest text-neutral-400 mb-1';

export default function DeliveryOptions({
  selection,
  onSelection,
  approval,
  onApprove,
  onCollectionOnly,
}: {
  selection: DeliverySelection | null;
  onSelection: (s: DeliverySelection | null) => void;
  approval: PendingApproval | null;
  onApprove: () => void;
  onCollectionOnly: (message: string) => void;
}) {
  const id = useId();
  const [address, setAddress] = useState<AddressFields>({ street: '', suburb: '', city: '', postalCode: '' });
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [instructions, setInstructions] = useState('');
  const [windowId, setWindowId] = useState<string>(DELIVERY_CHECKOUT.windows[0].id);
  const [wantReturn, setWantReturn] = useState(false);
  const [returnWindowId, setReturnWindowId] = useState<string>(DELIVERY_CHECKOUT.windows[DELIVERY_CHECKOUT.windows.length - 1].id);
  const [quoting, setQuoting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Any change to what was quoted means a new quote.
  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    if (selection) onSelection(null);
  };

  const getQuote = async () => {
    setQuoting(true);
    setProblem(null);
    try {
      const res = await fetch('/api/delivery/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          contact_name: contactName,
          contact_phone: contactPhone,
          instructions: instructions || undefined,
          window: windowId,
          return_window: wantReturn ? returnWindowId : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        collection_only?: boolean;
        message?: string;
        error?: string;
        quotes?: PublicQuote[];
        address?: { summary?: string };
      };
      if (data.collection_only) {
        onSelection(null);
        onCollectionOnly(data.message ?? 'Delivery is not available for this order. You can collect in person.');
        return;
      }
      if (!res.ok || !data.ok || !data.quotes) {
        onSelection(null);
        setProblem(data.error ?? data.message ?? 'We could not quote delivery just now. Please try again.');
        return;
      }
      const s = selectionFromQuotes(data.quotes, data.address?.summary ?? '', address);
      onSelection(s);
      if (!s) setProblem('We could not quote delivery just now. Please try again.');
    } catch {
      setProblem('We could not quote delivery just now. Please try again.');
    } finally {
      setQuoting(false);
    }
  };

  const ready = address.street.trim().length >= 5 && address.city.trim().length >= 2 && contactName.trim().length >= 2 && contactPhone.trim().length >= 10;

  return (
    <div className="space-y-4">
      <p className="text-xs font-mono text-neutral-400 leading-relaxed">
        We deliver in our own vehicle, in {STUDIO.serviceArea.summary}, and hand the gear to you in person. Enter your address for a
        price before you book.
      </p>

      <fieldset className="space-y-3">
        <legend className="sr-only">Delivery address</legend>
        <div>
          <label htmlFor={`${id}-street`} className={LABEL}>Street address</label>
          <input id={`${id}-street`} className={INPUT} autoComplete="address-line1" placeholder="12 Example Street, unit or complex" value={address.street} onChange={(e) => touch(setAddress)({ ...address, street: e.target.value })} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-suburb`} className={LABEL}>Suburb</label>
            <input id={`${id}-suburb`} className={INPUT} autoComplete="address-level3" value={address.suburb} onChange={(e) => touch(setAddress)({ ...address, suburb: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${id}-city`} className={LABEL}>City</label>
            <input id={`${id}-city`} className={INPUT} autoComplete="address-level2" value={address.city} onChange={(e) => touch(setAddress)({ ...address, city: e.target.value })} />
          </div>
          <div>
            <label htmlFor={`${id}-postal`} className={LABEL}>Postal code</label>
            <input id={`${id}-postal`} className={INPUT} autoComplete="postal-code" inputMode="numeric" value={address.postalCode} onChange={(e) => touch(setAddress)({ ...address, postalCode: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-name`} className={LABEL}>Who receives it</label>
            <input id={`${id}-name`} className={INPUT} autoComplete="given-name" placeholder="First name" value={contactName} onChange={(e) => touch(setContactName)(e.target.value)} />
          </div>
          <div>
            <label htmlFor={`${id}-phone`} className={LABEL}>Their phone</label>
            <input id={`${id}-phone`} className={INPUT} autoComplete="tel" inputMode="tel" placeholder="082 123 4567" value={contactPhone} onChange={(e) => touch(setContactPhone)(e.target.value)} />
          </div>
        </div>
        <div>
          <label htmlFor={`${id}-notes`} className={LABEL}>For the driver (optional)</label>
          <input id={`${id}-notes`} className={INPUT} placeholder="Gate code, where to park" maxLength={DELIVERY_CHECKOUT.contact.maxInstructionsLength} value={instructions} onChange={(e) => touch(setInstructions)(e.target.value)} />
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-mono uppercase tracking-widest text-neutral-400">Delivery window, first hire day</legend>
        <div className="grid grid-cols-2 gap-2">
          {DELIVERY_CHECKOUT.windows.map((w) => (
            <label key={w.id} className={`flex items-center gap-2 min-h-[44px] px-3 border text-xs font-mono cursor-pointer ${windowId === w.id ? 'border-[#D4A843] text-[#D4A843]' : 'border-white/10 text-neutral-400'}`}>
              <input type="radio" name={`${id}-window`} className="accent-[#D4A843]" checked={windowId === w.id} onChange={() => touch(setWindowId)(w.id)} />
              {w.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-xs font-mono uppercase tracking-widest text-neutral-400">Return</legend>
        <label className="flex items-center gap-3 min-h-[44px] text-xs font-mono text-neutral-300 cursor-pointer">
          <input type="checkbox" className="accent-[#D4A843] w-4 h-4" checked={wantReturn} onChange={(e) => touch(setWantReturn)(e.target.checked)} />
          Collect it from me on the last hire day (priced separately)
        </label>
        {wantReturn && (
          <div className="grid grid-cols-2 gap-2">
            {DELIVERY_CHECKOUT.windows.map((w) => (
              <label key={w.id} className={`flex items-center gap-2 min-h-[44px] px-3 border text-xs font-mono cursor-pointer ${returnWindowId === w.id ? 'border-[#D4A843] text-[#D4A843]' : 'border-white/10 text-neutral-400'}`}>
                <input type="radio" name={`${id}-return-window`} className="accent-[#D4A843]" checked={returnWindowId === w.id} onChange={() => touch(setReturnWindowId)(w.id)} />
                {w.label}
              </label>
            ))}
          </div>
        )}
        {!wantReturn && <p className="text-xs font-mono text-neutral-500">Without a return pickup, you bring the gear back to us. You can ask for a pickup later from your booking.</p>}
      </fieldset>

      <button
        type="button"
        onClick={() => void getQuote()}
        disabled={!ready || quoting}
        className="w-full min-h-[44px] border border-[#D4A843]/60 text-[#D4A843] text-xs font-mono uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {quoting ? 'Checking your address…' : selection ? 'Get a new quote' : 'Get delivery quote'}
      </button>
      <p className="text-[11px] font-mono text-neutral-500">{DELIVERY_CHECKOUT.address.attribution}</p>

      {problem && (
        <p role="alert" className="text-xs font-mono text-amber-400 leading-relaxed">
          {problem}
        </p>
      )}

      {selection && !approval && (
        <div role="status" className="border border-white/10 p-3 space-y-1 text-xs font-mono text-neutral-300" data-testid="delivery-quote">
          {selection.addressSummary && <p className="text-neutral-400">To {selection.addressSummary}</p>}
          {selection.quotes.map((q) => (
            <p key={q.leg} className="flex justify-between gap-3">
              <span>{q.leg === 'outbound' ? 'Delivery' : 'Return pickup'}{q.window_label ? `, ${q.window_label}` : ''}</span>
              <span className="text-white">{centsToRand(q.customer_fee_cents)}</span>
            </p>
          ))}
          {selection.quotes[0]?.expires_at && (
            <p className="text-neutral-500">
              Price held until {new Date(selection.quotes[0].expires_at).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}. After that we check it again before you pay.
            </p>
          )}
        </div>
      )}

      {approval && (
        <div role="alert" className="border border-[#D4A843]/40 bg-[#D4A843]/5 p-3 space-y-2 text-xs font-mono text-neutral-200">
          <p>{approval.message}</p>
          {approval.quotes.map((q) => (
            <p key={q.leg} className="flex justify-between gap-3">
              <span>{q.leg === 'outbound' ? 'Delivery' : 'Return pickup'}</span>
              <span className="text-white">{centsToRand(q.customer_fee_cents)}</span>
            </p>
          ))}
          <button type="button" onClick={onApprove} className="w-full min-h-[44px] border border-[#D4A843] text-[#D4A843] uppercase tracking-widest">
            Accept delivery at {centsToRand(approval.totalCents)}
          </button>
        </div>
      )}
    </div>
  );
}
