import { createAdminClient } from '@/lib/supabase/server';

export interface PlatformEvent {
  eventType: string;
  eventCategory: string;
  userId?: string | null;
  sessionId?: string | null;
  pageUrl?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Log a platform event to the platform_events table.
 * Fire-and-forget — never throws, never blocks the caller.
 *
 * Usage:
 *   logEvent({ eventType: 'booking_created', eventCategory: 'booking', userId: user.id, metadata: { reference, total } });
 */
export function logEvent(event: PlatformEvent): void {
  // Fire-and-forget — don't await
  _insertEvent(event).catch((err) => {
    console.error('[logEvent] Failed to log event:', event.eventType, err);
  });
}

async function _insertEvent(event: PlatformEvent): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase.from('platform_events').insert({
    event_type: event.eventType,
    event_category: event.eventCategory,
    user_id: event.userId ?? null,
    session_id: event.sessionId ?? null,
    page_url: event.pageUrl ?? null,
    metadata: event.metadata ?? {},
  });

  if (error) {
    // Log but don't throw — events should never break the app
    console.error('[logEvent] Insert error:', error.message);
  }
}
