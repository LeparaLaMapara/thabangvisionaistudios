// ─── Email Provider Abstraction ──────────────────────────────────────────────

export type SendEmailOptions = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type ContactNotificationParams = {
  name: string;
  email: string;
  subject: string;
  message: string;
  phone?: string;
};

export type VerificationApprovedParams = {
  email: string;
  displayName: string;
};

export type VerificationRejectedParams = {
  email: string;
  displayName: string;
  reason: string;
};

export type BookingConfirmationParams = {
  email: string;
  rentalTitle: string;
  startDate: string;
  endDate: string;
  total: number;
  currency: string;
};

/**
 * Unified email provider interface.
 *
 * Each provider implements these methods. The active provider is
 * selected via `EMAIL_PROVIDER` env var in `lib/email/index.ts`.
 */
export interface EmailProvider {
  /** Provider identifier (e.g., 'gmail', 'resend') */
  readonly name: string;

  /** Whether the provider has valid credentials configured. */
  isConfigured(): boolean;

  /** Send a raw email. */
  sendEmail(options: SendEmailOptions): Promise<void>;

  /** Send a contact form notification to the studio inbox. */
  sendContactNotification(params: ContactNotificationParams): Promise<void>;

  /** Notify a user their verification was approved. */
  sendVerificationApproved(params: VerificationApprovedParams): Promise<void>;

  /** Notify a user their verification was rejected. */
  sendVerificationRejected(params: VerificationRejectedParams): Promise<void>;

  /** Send a booking confirmation to the customer. */
  sendBookingConfirmation(params: BookingConfirmationParams): Promise<void>;
}
