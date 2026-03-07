import nodemailer from 'nodemailer';

// ─── Configuration ──────────────────────────────────────────────────────────

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

/**
 * Returns true if Gmail SMTP credentials are configured.
 */
export function isEmailConfigured(): boolean {
  return !!(
    GMAIL_USER &&
    GMAIL_APP_PASSWORD &&
    !GMAIL_APP_PASSWORD.includes('your_') &&
    GMAIL_APP_PASSWORD.length > 6
  );
}

/**
 * Creates a reusable Nodemailer transporter for Gmail SMTP.
 */
function createTransporter() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // TLS via STARTTLS
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });
}

// ─── Core send function ─────────────────────────────────────────────────────

type SendEmailOptions = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/**
 * Sends an email via Gmail SMTP.
 * If credentials are not configured, logs a warning and returns silently.
 */
export async function sendEmail({ to, subject, text, html }: SendEmailOptions): Promise<void> {
  if (!isEmailConfigured()) {
    console.warn('[email] GMAIL_USER or GMAIL_APP_PASSWORD not set — email not sent.');
    return;
  }

  const transporter = createTransporter();

  await transporter.sendMail({
    from: `ThabangVision AI Studios <${GMAIL_USER}>`,
    to,
    subject,
    text,
    html,
  });
}

// ─── Template functions ─────────────────────────────────────────────────────

type ContactNotificationParams = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

/**
 * Sends a contact form notification to the studio inbox (GMAIL_USER).
 */
export async function sendContactNotification({
  name,
  email,
  subject,
  message,
}: ContactNotificationParams): Promise<void> {
  const emailSubject = subject
    ? `[Contact] ${subject}`
    : `[Contact] Message from ${name}`;

  const text = `Name: ${name}\nEmail: ${email}\nSubject: ${subject || '(none)'}\n\n${message}`;

  const html = `
    <h2>New Contact Form Submission</h2>
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(email)}</p>
    <p><strong>Subject:</strong> ${escapeHtml(subject || '(none)')}</p>
    <hr />
    <p>${escapeHtml(message).replace(/\n/g, '<br />')}</p>
  `;

  await sendEmail({
    to: GMAIL_USER!,
    subject: emailSubject,
    text,
    html,
  });
}

type VerificationApprovedParams = {
  email: string;
  displayName: string;
};

/**
 * Notifies a user that their identity verification has been approved.
 */
export async function sendVerificationApproved({
  email,
  displayName,
}: VerificationApprovedParams): Promise<void> {
  const greeting = displayName || 'there';

  await sendEmail({
    to: email,
    subject: 'Your identity has been verified — ThabangVision AI Studios',
    text: `Hi ${greeting},\n\nGreat news! Your identity verification has been approved. You now have full access to all platform features.\n\nThank you for being part of our creative community.\n\n— ThabangVision AI Studios`,
    html: `
      <h2>Identity Verified</h2>
      <p>Hi ${escapeHtml(greeting)},</p>
      <p>Great news! Your identity verification has been <strong>approved</strong>. You now have full access to all platform features.</p>
      <p>Thank you for being part of our creative community.</p>
      <br />
      <p>— ThabangVision AI Studios</p>
    `,
  });
}

type VerificationRejectedParams = {
  email: string;
  displayName: string;
  reason: string;
};

/**
 * Notifies a user that their identity verification was rejected, with a reason.
 */
export async function sendVerificationRejected({
  email,
  displayName,
  reason,
}: VerificationRejectedParams): Promise<void> {
  const greeting = displayName || 'there';

  await sendEmail({
    to: email,
    subject: 'Identity verification update — ThabangVision AI Studios',
    text: `Hi ${greeting},\n\nUnfortunately, your identity verification could not be approved at this time.\n\nReason: ${reason}\n\nPlease review the feedback and resubmit your documents when ready.\n\n— ThabangVision AI Studios`,
    html: `
      <h2>Verification Update</h2>
      <p>Hi ${escapeHtml(greeting)},</p>
      <p>Unfortunately, your identity verification could not be approved at this time.</p>
      <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
      <p>Please review the feedback and resubmit your documents when ready.</p>
      <br />
      <p>— ThabangVision AI Studios</p>
    `,
  });
}

type BookingConfirmationParams = {
  email: string;
  rentalTitle: string;
  startDate: string;
  endDate: string;
  total: number;
  currency: string;
};

/**
 * Sends a booking confirmation email to the customer.
 */
export async function sendBookingConfirmation({
  email,
  rentalTitle,
  startDate,
  endDate,
  total,
  currency,
}: BookingConfirmationParams): Promise<void> {
  const formattedTotal = `${currency} ${total.toFixed(2)}`;

  await sendEmail({
    to: email,
    subject: `Booking Confirmed — ${rentalTitle}`,
    text: `Your booking has been confirmed!\n\nEquipment: ${rentalTitle}\nDates: ${startDate} — ${endDate}\nTotal: ${formattedTotal}\n\nThank you for choosing ThabangVision AI Studios.\n\n— ThabangVision AI Studios`,
    html: `
      <h2>Booking Confirmed</h2>
      <p>Your booking has been confirmed!</p>
      <table style="border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Equipment</td><td>${escapeHtml(rentalTitle)}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Dates</td><td>${escapeHtml(startDate)} — ${escapeHtml(endDate)}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Total</td><td>${escapeHtml(formattedTotal)}</td></tr>
      </table>
      <p>Thank you for choosing ThabangVision AI Studios.</p>
      <br />
      <p>— ThabangVision AI Studios</p>
    `,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
