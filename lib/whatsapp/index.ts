// ─── WhatsApp Provider Abstraction ──────────────────────────────────────────
// Active provider controlled by WHATSAPP_PROVIDER env var.
// Currently only Twilio is supported. Add more providers as needed.

import { twilio } from './twilio';
import type { WhatsAppProvider } from './types';

export type { WhatsAppProvider, WhatsAppMessage, SendWhatsAppOptions } from './types';

const providers: Record<string, WhatsAppProvider> = {
  twilio,
};

const providerName = process.env.WHATSAPP_PROVIDER ?? 'twilio';

export const whatsapp: WhatsAppProvider = providers[providerName] ?? twilio;
