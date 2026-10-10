import { STUDIO } from '@/lib/constants';
import { systemClock } from '@/lib/core/ports';
import type { DeliveryDeps } from '@/lib/core/delivery/repository';
import { getFlag } from '@/lib/features';
import { createAdminClient } from '@/lib/supabase/server';
import type { InboxDeps } from './inbox';
import { SupabaseDeliveryOrigins } from './origins';
import { deliveryInsurance, deliveryProviders } from './ports';
import {
  SupabaseDeliveryAddresses,
  SupabaseDeliveryBookings,
  SupabaseDeliveryInbox,
  SupabaseDeliveryRepository,
  SupabaseManualTaskStore,
  SupabaseRenterTrust,
} from './repos';

/**
 * The production wiring for the delivery use cases (lib/core/delivery/use-cases.ts).
 * Routes, jobs, the admin console and Ubunye call the use cases with these
 * deps; none of them builds an adapter itself. Server only (service role).
 */
export async function deliveryDeps(): Promise<DeliveryDeps> {
  const db = createAdminClient();
  const courierEnabled = await getFlag('delivery_courier');
  return {
    repo: new SupabaseDeliveryRepository(db),
    bookings: new SupabaseDeliveryBookings(db),
    trust: new SupabaseRenterTrust(db),
    addresses: new SupabaseDeliveryAddresses(db),
    providers: deliveryProviders(new SupabaseManualTaskStore(db)),
    insurance: deliveryInsurance,
    clock: systemClock,
    flags: { courierEnabled, ownFleetEnabled: STUDIO.fulfilment.delivery.enabled },
    newId: () => crypto.randomUUID(),
    origins: new SupabaseDeliveryOrigins(db),
  };
}

/** Deps for the provider webhook inbox (route and retry job). */
export async function deliveryInboxDeps(): Promise<InboxDeps> {
  const deps = await deliveryDeps();
  return { store: new SupabaseDeliveryInbox(createAdminClient()), useCases: deps };
}
