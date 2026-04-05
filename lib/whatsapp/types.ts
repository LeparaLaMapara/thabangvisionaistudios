// ─── WhatsApp Provider Abstraction ──────────────────────────────────────────

export type WhatsAppMessage = {
  from: string;
  body: string;
  profileName?: string;
  messageId?: string;
  timestamp?: string;
};

export type SendWhatsAppOptions = {
  to: string;
  body: string;
};

export interface WhatsAppProvider {
  readonly name: string;
  isConfigured(): boolean;
  sendMessage(options: SendWhatsAppOptions): Promise<{ success: boolean; messageId?: string }>;
  parseIncoming(body: unknown): WhatsAppMessage | null;
  validateWebhook(headers: Record<string, string>, body: string): boolean;
}
