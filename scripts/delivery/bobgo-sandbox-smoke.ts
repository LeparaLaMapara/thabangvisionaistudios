/**
 * Bob Go SANDBOX smoke test: runs the real adapter (lib/delivery/bobgo) against
 * the Bob Go sandbox, end to end, and prints every request and answer.
 *
 *   npx tsx scripts/delivery/bobgo-sandbox-smoke.ts            # read-only: serviceability, quote, lookups
 *   npx tsx scripts/delivery/bobgo-sandbox-smoke.ts --book     # also create, look up, read, track, cancel
 *
 * Reads BOBGO_SANDBOX_API_KEY from the environment or .env.local. Sandbox only:
 * the production key is never read and the mode is fixed. The approved service
 * levels are passed here for the test (the sandbox courier's ECO and LSX); the
 * contract's own list stays empty, so nothing changes for customers.
 *
 * It creates ONE shipment and cancels it. It never sends the same create twice:
 * Bob Go books a second shipment under the same reference.
 */
import { readFileSync } from 'fs';
import { createBobgoAdapter } from '@/lib/delivery/bobgo/adapter';
import type { FetchLike } from '@/lib/delivery/http';
import type { DeliveryPoint, ParcelItem } from '@/lib/core/delivery/port';

const SANDBOX_SERVICE_LEVELS = ['sandbox:ECO', 'sandbox:LSX'];

function sandboxKey(): string {
  if (process.env.BOBGO_SANDBOX_API_KEY) return process.env.BOBGO_SANDBOX_API_KEY.trim();
  try {
    const line = readFileSync('.env.local', 'utf8').split(/\r?\n/).find((l) => l.startsWith('BOBGO_SANDBOX_API_KEY='));
    if (line) return line.slice('BOBGO_SANDBOX_API_KEY='.length).trim();
  } catch {
    // no .env.local
  }
  throw new Error('BOBGO_SANDBOX_API_KEY is not set (environment or .env.local)');
}

/** Logs each call's method, path, status and body, with the key masked. */
const loggingFetch: FetchLike = async (input, init) => {
  const res = await globalThis.fetch(input, init);
  const text = await res.clone().text();
  console.log(`    HTTP ${init.method ?? 'GET'} ${input.replace(/^https:\/\/[^/]+/, '')} -> ${res.status}`);
  if (init.body) console.log(`      sent: ${String(init.body).slice(0, 600)}`);
  console.log(`      got:  ${text.slice(0, 900)}`);
  return res;
};

const office: DeliveryPoint = {
  placeId: 'smoke-from',
  lat: -26.1929,
  lng: 28.0305,
  formattedAddress: '1 Jan Smuts Avenue',
  suburb: 'Braamfontein',
  city: 'Johannesburg',
  postalCode: '2001',
  province: 'GP',
  contactName: 'ThabangVision Test',
  contactPhone: '0820000000',
  instructions: 'SANDBOX TEST, do not collect',
};
const renter: DeliveryPoint = {
  placeId: 'smoke-to',
  lat: -25.7461,
  lng: 28.1881,
  formattedAddress: '10 Church Street',
  suburb: 'Pretoria Central',
  city: 'Pretoria',
  postalCode: '0002',
  province: 'GP',
  contactName: 'Test Renter',
  contactPhone: '0830000000',
  instructions: null,
};
const items: ParcelItem[] = [
  { rentalId: 'smoke-rental', bookingId: 'smoke-booking', driverLabel: 'Camera equipment', replacementValueCents: 1_000_000, quantity: 1, weightGrams: 2000, containsLithium: false },
];
const window = { start: null, end: null };

function show(step: string, r: unknown): void {
  console.log(`\n=> ${step}: ${JSON.stringify(r)}\n`);
}

async function main(): Promise<void> {
  const book = process.argv.includes('--book');
  const bobgo = createBobgoAdapter({ mode: 'sandbox', apiKey: sandboxKey(), approvedServiceLevels: SANDBOX_SERVICE_LEVELS, fetchImpl: loggingFetch });
  const ref = `TV-SMOKE-${Date.now()}`;
  console.log(`Bob Go sandbox smoke test, merchant reference ${ref}${book ? ' (booking enabled)' : ' (read-only)'}`);

  show('1 serviceability (local checks only)', await bobgo.checkServiceability({ from: office, to: renter, window, items }));

  console.log('2 quote');
  const quote = await bobgo.quote({ from: office, to: renter, window, items, leg: 'outbound' });
  show('2 quote', quote);

  console.log('3 lookup by our reference, before any booking (expect "unknown", never "none")');
  show('3 lookup before', await bobgo.findByMerchantReference(ref));

  if (!book || !quote.ok) {
    if (book) console.log('Quote failed: not booking.');
    return;
  }

  const create = { merchantReference: ref, leg: 'outbound' as const, quote: quote.value, from: office, to: renter, items, window, requirements: { noLeaveAtDoor: true, recipientPin: null, declaredValueCents: null } };
  console.log('4 create');
  const first = await bobgo.createDelivery(create);
  show('4 create', first);

  console.log('5 lookup by our reference, after booking');
  show('5 lookup after', await bobgo.findByMerchantReference(ref));

  if (!first.ok) return;
  const id = first.value.providerReference;
  console.log('6 read shipment by Bob Go reference');
  show('6 read', await bobgo.getDelivery(id));
  console.log('7 tracking');
  show('7 tracking', await bobgo.getTracking(id));
  console.log('8 cancel');
  show('8 cancel', await bobgo.cancelDelivery(id, 'sandbox smoke test'));
  console.log('9 read after cancel');
  show('9 read after cancel', await bobgo.getDelivery(id));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
