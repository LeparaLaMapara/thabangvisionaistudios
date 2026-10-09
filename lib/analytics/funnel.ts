import { logEvent } from '@/lib/data/events';
import { funnelEventType, sanitiseFunnelMeta, type FunnelMeta, type FunnelStage } from '@/lib/core/analytics/funnel';

/**
 * Record that someone reached a funnel stage (spec §9.6). Fire-and-forget,
 * like logEvent. Only ids and codes are kept (sanitiseFunnelMeta); the user id
 * is the opaque account id, never an email. Never pass names, contact,
 * address, bank or payment details.
 */
export function trackFunnel(stage: FunnelStage, p: { userId?: string | null; meta?: FunnelMeta } = {}): void {
  logEvent({
    eventType: funnelEventType(stage),
    eventCategory: 'funnel',
    userId: p.userId ?? null,
    metadata: sanitiseFunnelMeta(p.meta as Record<string, unknown> | undefined),
  });
}
