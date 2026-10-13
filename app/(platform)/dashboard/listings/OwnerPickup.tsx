'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { DELIVERY_CHECKOUT } from '@/lib/constants';
import { uploadFile } from '@/lib/cloudinary/upload';

/**
 * Pickups from the owner's own address (Phase 8). The owner saves a private
 * pickup address (checked on our server, never shown to renters: they see the
 * suburb at most), opts each listing in, and handles the handovers at their
 * door: hand the gear to our driver (photo), and confirm it came back and in
 * what condition, or report a problem (which holds the payout for that item
 * until our team looks at it). Data: GET/PUT/PATCH/DELETE
 * /api/delivery/owner-pickup, POST /api/delivery/owner-handover.
 */

interface PickupAddress {
  formatted_address: string;
  suburb: string | null;
  city: string | null;
  postal_code: string | null;
  contact_name: string;
  contact_phone: string;
  instructions: string | null;
}

interface OwnerItem {
  booking_id: string;
  rental_id: string;
  title: string | null;
  progress: string;
  can_hand_over: boolean;
  can_confirm_return: boolean;
}

interface OwnerLeg {
  shipment_id: string;
  leg: 'outbound' | 'return';
  via: 'your_address' | 'studio';
  status_label: string;
  window_start: string | null;
  window_label: string | null;
  items: OwnerItem[];
}

interface Payload {
  enabled: boolean;
  service_area: string;
  address: PickupAddress | null;
  listings: { rental_id: string; title: string; live: boolean; owner_pickup: boolean }[];
  legs: OwnerLeg[];
}

const INPUT =
  'w-full bg-neutral-900 border border-white/10 text-white px-3 py-3 min-h-[44px] text-base md:text-sm font-mono placeholder:text-neutral-500 focus:outline-none focus:border-[#D4A843]/60';
const LABEL = 'block text-xs font-mono uppercase tracking-widest text-neutral-400 mb-1';
const BUTTON = 'min-h-[44px] px-4 border border-[#D4A843]/60 text-[#D4A843] text-xs font-mono uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed';

const day = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: DELIVERY_CHECKOUT.timeZone }) : '';

export function OwnerPickup() {
  const id = useId();
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ street: '', suburb: '', city: '', postalCode: '', contact_name: '', contact_phone: '', instructions: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/delivery/owner-pickup', { cache: 'no-store' });
      if (!r.ok) throw new Error('load failed');
      setData((await r.json()) as Payload);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (key: string, url: string, method: string, body?: unknown): Promise<boolean> => {
    setBusy(key);
    setMessage(null);
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setMessage(j.error ?? 'That did not work. Please try again.');
        return false;
      }
      await load();
      return true;
    } catch {
      setMessage('That did not work. Please try again.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveAddress = async () => {
    const ok = await call('address', '/api/delivery/owner-pickup', 'PUT', {
      address: { street: form.street, suburb: form.suburb, city: form.city, postalCode: form.postalCode },
      contact_name: form.contact_name,
      contact_phone: form.contact_phone,
      instructions: form.instructions || undefined,
    });
    if (ok) {
      setEditing(false);
      setMessage('Pickup address saved.');
    }
  };

  if (failed) return <p className="mb-8 text-xs font-mono text-neutral-400">We could not load your pickup settings just now. Reload the page to try again.</p>;
  if (!data || !data.enabled) return null;
  const community = data.listings;
  if (community.length === 0 && data.legs.length === 0 && !data.address) return null;
  const showForm = editing || !data.address;

  return (
    <section id="owner-pickups" aria-labelledby={`${id}-title`} className="mb-10 space-y-4">
      <h3 id={`${id}-title`} className="text-sm font-bold uppercase tracking-tight border-l-2 border-[#D4A843] pl-4 text-white">
        Pickups from your address
      </h3>
      <p className="text-xs font-mono text-neutral-400 pl-4 leading-relaxed">
        Instead of bringing gear to our studio, our driver can collect it from you and bring it back after the hire ({data.service_area} only). Your address stays private: renters see your suburb at most, and our team sees it only to send a driver. First hires and high-value orders are still collected at our studio, so bring that gear to us as before.
      </p>

      {message && (
        <p role="status" className="text-xs font-mono text-[#D4A843] pl-4">
          {message}
        </p>
      )}

      <div className="border border-white/10 p-4 space-y-3">
        <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">Your pickup address</p>
        {data.address && !editing && (
          <div className="space-y-2 text-sm font-mono text-white" data-testid="owner-pickup-address">
            <p>{data.address.formatted_address}</p>
            <p className="text-xs text-neutral-400">
              Ask for {data.address.contact_name}, {data.address.contact_phone}
              {data.address.instructions ? `. ${data.address.instructions}` : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BUTTON} onClick={() => setEditing(true)} disabled={busy !== null}>
                Change address
              </button>
              <button type="button" className={BUTTON} onClick={() => void call('remove', '/api/delivery/owner-pickup', 'DELETE')} disabled={busy !== null}>
                Remove
              </button>
            </div>
          </div>
        )}
        {showForm && (
          <fieldset className="space-y-3">
            <legend className="sr-only">Pickup address</legend>
            <div>
              <label htmlFor={`${id}-street`} className={LABEL}>Pickup street address</label>
              <input id={`${id}-street`} className={INPUT} autoComplete="address-line1" value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor={`${id}-suburb`} className={LABEL}>Pickup suburb</label>
                <input id={`${id}-suburb`} className={INPUT} autoComplete="address-level3" value={form.suburb} onChange={(e) => setForm({ ...form, suburb: e.target.value })} />
              </div>
              <div>
                <label htmlFor={`${id}-city`} className={LABEL}>Pickup city</label>
                <input id={`${id}-city`} className={INPUT} autoComplete="address-level2" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div>
                <label htmlFor={`${id}-postal`} className={LABEL}>Pickup postal code</label>
                <input id={`${id}-postal`} className={INPUT} inputMode="numeric" autoComplete="postal-code" value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${id}-name`} className={LABEL}>Driver asks for</label>
                <input id={`${id}-name`} className={INPUT} autoComplete="given-name" placeholder="First name" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
              </div>
              <div>
                <label htmlFor={`${id}-phone`} className={LABEL}>Phone for the driver</label>
                <input id={`${id}-phone`} className={INPUT} inputMode="tel" autoComplete="tel" placeholder="082 123 4567" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} />
              </div>
            </div>
            <div>
              <label htmlFor={`${id}-notes`} className={LABEL}>Instructions for the driver (optional)</label>
              <input id={`${id}-notes`} className={INPUT} maxLength={DELIVERY_CHECKOUT.contact.maxInstructionsLength} placeholder="Gate code, where to park" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BUTTON} onClick={() => void saveAddress()} disabled={busy !== null || form.street.trim().length < 5 || form.city.trim().length < 2}>
                {busy === 'address' ? 'Checking the address…' : 'Save pickup address'}
              </button>
              {editing && (
                <button type="button" className={BUTTON} onClick={() => setEditing(false)} disabled={busy !== null}>
                  Cancel
                </button>
              )}
            </div>
          </fieldset>
        )}
      </div>

      {community.length > 0 && (
        <div className="border border-white/10 p-4 space-y-2">
          <p className="text-xs font-mono uppercase tracking-widest text-neutral-400">Which gear can be collected from you</p>
          {!data.address && <p className="text-xs font-mono text-neutral-500">Save a pickup address first.</p>}
          {community.map((l) => (
            <label key={l.rental_id} className="flex items-center gap-3 min-h-[44px] text-sm font-mono text-neutral-200 cursor-pointer">
              <input
                type="checkbox"
                className="accent-[#D4A843] w-4 h-4"
                checked={l.owner_pickup}
                disabled={busy !== null || !data.address}
                onChange={(e) => void call(`listing:${l.rental_id}`, '/api/delivery/owner-pickup', 'PATCH', { rental_id: l.rental_id, enabled: e.target.checked })}
                aria-label={`Available for pickup from my address: ${l.title}`}
              />
              <span>
                {l.title} {!l.live && <span className="text-xs text-neutral-500">(not live)</span>}
              </span>
            </label>
          ))}
        </div>
      )}

      {data.legs.length > 0 && (
        <ul className="divide-y divide-white/5 border border-white/10" aria-label="Collections and returns of your gear">
          {data.legs.map((leg) => (
            <li key={leg.shipment_id} className="p-4 space-y-2">
              <div className="flex flex-wrap justify-between gap-2 text-sm font-mono">
                <span className="text-white">
                  {leg.leg === 'outbound' ? (leg.via === 'your_address' ? 'Collection from you' : 'Delivery from our studio') : leg.via === 'your_address' ? 'Return to you' : 'Return to our studio'}
                </span>
                <span className="text-[#D4A843]">{leg.status_label}</span>
              </div>
              {leg.window_start && (
                <p className="text-xs font-mono text-neutral-400">
                  {day(leg.window_start)}
                  {leg.window_label ? `, ${leg.window_label}` : ''}
                </p>
              )}
              {leg.items.map((it) => (
                <OwnerItemRow key={`${leg.shipment_id}:${it.booking_id}:${it.rental_id}`} leg={leg} item={it} busy={busy} call={call} />
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OwnerItemRow({
  leg,
  item,
  busy,
  call,
}: {
  leg: OwnerLeg;
  item: OwnerItem;
  busy: string | null;
  call: (key: string, url: string, method: string, body?: unknown) => Promise<boolean>;
}) {
  const id = useId();
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [condition, setCondition] = useState('');
  const [problem, setProblem] = useState(false);
  const [kind, setKind] = useState<'damaged' | 'lost'>('damaged');
  const [description, setDescription] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      setPhoto((await uploadFile(file, 'delivery-evidence')).url);
    } catch {
      setUploadError('The photo did not upload. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const send = (action: 'handed_over' | 'received' | 'problem') =>
    call(`hand:${leg.shipment_id}:${item.booking_id}`, '/api/delivery/owner-handover', 'POST', {
      shipment_id: leg.shipment_id,
      booking_id: item.booking_id,
      rental_id: item.rental_id,
      action,
      photos: photo ? [photo] : [],
      condition: action === 'received' ? condition : undefined,
      problem_kind: action === 'problem' ? kind : undefined,
      description: action === 'problem' ? description : undefined,
    });

  const actionable = item.can_hand_over || item.can_confirm_return;
  return (
    <div className="pl-3 border-l border-white/10 space-y-2">
      <p className="text-xs font-mono text-neutral-300">{item.title ?? 'Your item'}</p>
      {actionable && (
        <div className="space-y-2">
          <div>
            <label htmlFor={`${id}-photo`} className={LABEL}>
              {item.can_hand_over ? 'Photo of the item at handover' : 'Photo of the item as it came back'}
            </label>
            <input id={`${id}-photo`} type="file" accept="image/*" capture="environment" className="block text-xs font-mono text-neutral-400" onChange={(e) => void upload(e.target.files?.[0])} />
            {uploading && <p className="text-xs font-mono text-neutral-500">Uploading…</p>}
            {photo && <p className="text-xs font-mono text-emerald-400">Photo added.</p>}
            {uploadError && <p role="alert" className="text-xs font-mono text-amber-400">{uploadError}</p>}
          </div>
          {item.can_hand_over && (
            <button type="button" className={BUTTON} disabled={!photo || busy !== null} onClick={() => void send('handed_over')}>
              Handed to our driver
            </button>
          )}
          {item.can_confirm_return && !problem && (
            <>
              <div>
                <label htmlFor={`${id}-condition`} className={LABEL}>Condition it came back in</label>
                <input id={`${id}-condition`} className={INPUT} placeholder="Good, all accessories there" value={condition} onChange={(e) => setCondition(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BUTTON} disabled={!photo || condition.trim().length < 3 || busy !== null} onClick={() => void send('received')}>
                  Received back
                </button>
                <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => setProblem(true)}>
                  Report a problem
                </button>
              </div>
            </>
          )}
          {item.can_confirm_return && problem && (
            <div className="space-y-2">
              <div>
                <label htmlFor={`${id}-kind`} className={LABEL}>What is wrong</label>
                <select id={`${id}-kind`} className={INPUT} value={kind} onChange={(e) => setKind(e.target.value === 'lost' ? 'lost' : 'damaged')}>
                  <option value="damaged">Damaged</option>
                  <option value="lost">Missing (item or accessory)</option>
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-desc`} className={LABEL}>Describe the problem</label>
                <input id={`${id}-desc`} className={INPUT} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BUTTON} disabled={!photo || description.trim().length < 3 || busy !== null} onClick={() => void send('problem')}>
                  Send problem report
                </button>
                <button type="button" className={BUTTON} disabled={busy !== null} onClick={() => setProblem(false)}>
                  Back
                </button>
              </div>
              <p className="text-xs font-mono text-neutral-500">Our team looks at every report. Nobody is blamed automatically; your payout for this item waits until it is resolved.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
