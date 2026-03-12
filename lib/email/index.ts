import type { EmailProvider } from './types';
import { gmail } from './gmail';

// Re-export types for convenience
export type {
  EmailProvider,
  SendEmailOptions,
  ContactNotificationParams,
  VerificationApprovedParams,
  VerificationRejectedParams,
  BookingConfirmationParams,
} from './types';

// ─── Provider Registry ───────────────────────────────────────────────────────

const providers: Record<string, EmailProvider> = {
  gmail,
};

// ─── Active Provider ─────────────────────────────────────────────────────────

const providerName = (process.env.EMAIL_PROVIDER ?? 'gmail').toLowerCase();

if (!providers[providerName]) {
  console.warn(
    `[email] Unknown EMAIL_PROVIDER="${providerName}". Falling back to gmail. ` +
    `Valid options: ${Object.keys(providers).join(', ')}`,
  );
}

/**
 * The active email provider, determined by `EMAIL_PROVIDER` env var.
 * Defaults to Gmail (Nodemailer) if not set or unrecognized.
 */
export const email: EmailProvider = providers[providerName] ?? gmail;

// ─── Convenience re-exports ─────────────────────────────────────────────────
// Backward-compatible function exports that delegate to the active provider.

export function isEmailConfigured(): boolean {
  return email.isConfigured();
}

export function sendContactNotification(
  ...args: Parameters<EmailProvider['sendContactNotification']>
): ReturnType<EmailProvider['sendContactNotification']> {
  return email.sendContactNotification(...args);
}

export function sendVerificationApproved(
  ...args: Parameters<EmailProvider['sendVerificationApproved']>
): ReturnType<EmailProvider['sendVerificationApproved']> {
  return email.sendVerificationApproved(...args);
}

export function sendVerificationRejected(
  ...args: Parameters<EmailProvider['sendVerificationRejected']>
): ReturnType<EmailProvider['sendVerificationRejected']> {
  return email.sendVerificationRejected(...args);
}

export function sendBookingConfirmation(
  ...args: Parameters<EmailProvider['sendBookingConfirmation']>
): ReturnType<EmailProvider['sendBookingConfirmation']> {
  return email.sendBookingConfirmation(...args);
}
