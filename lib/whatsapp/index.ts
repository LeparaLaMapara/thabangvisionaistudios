// ─── WhatsApp Provider Abstraction ──────────────────────────────────────────
// Active provider controlled by WHATSAPP_PROVIDER ("meta" or "twilio").
// Unset: "meta" once WHATSAPP_APP_SECRET is set (Meta Cloud API, see
// docs/operations/whatsapp-setup.md), otherwise the older Twilio gateway.

import { twilio } from './twilio';
import { meta } from './meta';
import type { WhatsAppProvider } from './types';

export type { WhatsAppProvider, WhatsAppMessage, SendWhatsAppOptions } from './types';

const providers: Record<string, WhatsAppProvider> = {
  twilio,
  meta,
};

/** The provider name for the given environment (read at call time, for tests). */
export function whatsappProviderName(env: Record<string, string | undefined> = process.env): string {
  const chosen = (env.WHATSAPP_PROVIDER ?? '').trim().toLowerCase();
  if (chosen && providers[chosen]) return chosen;
  return (env.WHATSAPP_APP_SECRET ?? '').trim() ? 'meta' : 'twilio';
}

export const whatsapp: WhatsAppProvider = providers[whatsappProviderName()] ?? twilio;
