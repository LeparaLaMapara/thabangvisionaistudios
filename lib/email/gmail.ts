import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { STUDIO } from '@/lib/constants';
import { SIGNATURE_HTML, SIGNATURE_TEXT, withHtmlSignature, withTextSignature } from './signature';
import type {
  EmailProvider,
  SendEmailOptions,
  ContactNotificationParams,
  VerificationApprovedParams,
  VerificationRejectedParams,
  BookingConfirmationParams,
  AccountSuspendedParams,
  AccountReinstatedParams,
  DisputeFiledParams,
  DisputeResolvedParams,
} from './types';

// ─── Gmail / Nodemailer Provider ────────────────────────────────────────────

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

/**
 * SMTP transport options. `disableFileAccess` / `disableUrlAccess` are set at
 * the transport level, which nodemailer forces onto every message: no `path`
 * or `href` content source (html/text/attachments) can ever make the server
 * read a local file or fetch a URL, whatever a caller passes (D-79 / R-80).
 */
export function gmailTransportOptions(): SMTPTransport.Options {
  return {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // TLS via STARTTLS
    requireTLS: true,
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

function createTransporter() {
  return nodemailer.createTransport(gmailTransportOptions());
}

/**
 * Builds the nodemailer message. Only plain strings are accepted for the
 * address, subject and bodies: an object such as `{ path }` or `{ href }`
 * would be a nodemailer content source, so it is rejected here as well as by
 * the transport's access policy. No attachments are ever sent.
 */
export function buildGmailMessage(
  { to, subject, text, html, headers }: SendEmailOptions,
  fromAddress: string,
): SMTPTransport.MailOptions {
  const fields: Record<string, unknown> = { to, subject, text };
  if (html !== undefined) fields.html = html;
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'string') {
      throw new TypeError(`[email] ${key} must be a string`);
    }
  }
  const extraHeaders = headers === undefined ? undefined : checkedHeaders(headers);

  return {
    // Address object, not a template string: nodemailer quotes / encodes the
    // display name itself, so a name with punctuation or non-ASCII cannot
    // break the header.
    from: { name: STUDIO.name, address: fromAddress },
    to,
    subject,
    // Every email ends with the one signature (lib/email/signature.ts). A
    // template that already has it is left alone; an old sign-off at the
    // end of a text body is replaced, never doubled.
    text: withTextSignature(text),
    ...(html !== undefined ? { html: withHtmlSignature(html) } : {}),
    ...(extraHeaders ? { headers: extraHeaders } : {}),
  };
}

/** Header names allowed through: plain tokens, never one nodemailer sets itself. */
const RESERVED_HEADERS = new Set(['from', 'to', 'cc', 'bcc', 'subject', 'reply-to', 'sender', 'content-type']);

/** Extra headers, refused when a name is not a token or a value spans lines. */
function checkedHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || RESERVED_HEADERS.has(name.toLowerCase())) {
      throw new TypeError(`[email] header name not allowed: ${name}`);
    }
    if (typeof value !== 'string' || /[\r\n]/.test(value) || value.length > 2000) {
      throw new TypeError(`[email] header ${name} must be a one-line string`);
    }
    out[name] = value;
  }
  return out;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const gmail: EmailProvider = {
  name: 'gmail',

  isConfigured(): boolean {
    return !!(
      GMAIL_USER &&
      GMAIL_APP_PASSWORD &&
      !GMAIL_APP_PASSWORD.includes('your_') &&
      GMAIL_APP_PASSWORD.length > 6
    );
  },

  async sendEmail(options: SendEmailOptions): Promise<void> {
    if (!this.isConfigured()) {
      console.warn('[email] GMAIL_USER or GMAIL_APP_PASSWORD not set — email not sent.');
      return;
    }

    const message = buildGmailMessage(options, GMAIL_USER!);
    const transporter = createTransporter();
    await transporter.sendMail(message);
  },

  async sendContactNotification({
    name,
    email,
    subject,
    message,
    phone,
  }: ContactNotificationParams): Promise<void> {
    const emailSubject = subject
      ? `[Contact] ${subject}`
      : `[Contact] Message from ${name}`;

    const phoneLine = phone ? `\nPhone: ${phone}` : '';
    const text = `Name: ${name}\nEmail: ${email}${phoneLine}\nSubject: ${subject || '(none)'}\n\n${message}`;
    const phoneHtml = phone ? `<p><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : '';
    const html = `
      <h2>New Contact Form Submission</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      ${phoneHtml}
      <p><strong>Subject:</strong> ${escapeHtml(subject || '(none)')}</p>
      <hr />
      <p>${escapeHtml(message).replace(/\n/g, '<br />')}</p>
    `;

    await this.sendEmail({ to: GMAIL_USER!, subject: emailSubject, text, html });
  },

  async sendVerificationApproved({
    email,
    displayName,
  }: VerificationApprovedParams): Promise<void> {
    const greeting = displayName || 'there';

    await this.sendEmail({
      to: email,
      subject: `Your identity has been verified — ${STUDIO.name}`,
      text: `Hi ${greeting},\n\nGreat news! Your identity verification has been approved. You now have full access to all platform features.\n\nThank you for being part of our creative community.\n\n${SIGNATURE_TEXT}`,
      html: `
        <h2>Identity Verified</h2>
        <p>Hi ${escapeHtml(greeting)},</p>
        <p>Great news! Your identity verification has been <strong>approved</strong>. You now have full access to all platform features.</p>
        <p>Thank you for being part of our creative community.</p>
        <br />
        ${SIGNATURE_HTML}
      `,
    });
  },

  async sendVerificationRejected({
    email,
    displayName,
    reason,
  }: VerificationRejectedParams): Promise<void> {
    const greeting = displayName || 'there';

    await this.sendEmail({
      to: email,
      subject: `Identity verification update — ${STUDIO.name}`,
      text: `Hi ${greeting},\n\nUnfortunately, your identity verification could not be approved at this time.\n\nReason: ${reason}\n\nPlease review the feedback and resubmit your documents when ready.\n\n${SIGNATURE_TEXT}`,
      html: `
        <h2>Verification Update</h2>
        <p>Hi ${escapeHtml(greeting)},</p>
        <p>Unfortunately, your identity verification could not be approved at this time.</p>
        <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
        <p>Please review the feedback and resubmit your documents when ready.</p>
        <br />
        ${SIGNATURE_HTML}
      `,
    });
  },

  async sendBookingConfirmation({
    email,
    rentalTitle,
    startDate,
    endDate,
    total,
    currency,
  }: BookingConfirmationParams): Promise<void> {
    const formattedTotal = `${currency} ${total.toFixed(2)}`;

    await this.sendEmail({
      to: email,
      subject: `Booking Confirmed — ${rentalTitle}`,
      text: `Your booking has been confirmed!\n\nEquipment: ${rentalTitle}\nDates: ${startDate} — ${endDate}\nTotal: ${formattedTotal}\n\nThank you for choosing ${STUDIO.name}.\n\n${SIGNATURE_TEXT}`,
      html: `
        <h2>Booking Confirmed</h2>
        <p>Your booking has been confirmed!</p>
        <table style="border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Equipment</td><td>${escapeHtml(rentalTitle)}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Dates</td><td>${escapeHtml(startDate)} — ${escapeHtml(endDate)}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Total</td><td>${escapeHtml(formattedTotal)}</td></tr>
        </table>
        <p>Thank you for choosing ${STUDIO.name}.</p>
        <br />
        ${SIGNATURE_HTML}
      `,
    });
  },

  async sendAccountSuspended({
    email,
    displayName,
    reason,
    expiresAt,
    supportEmail,
  }: AccountSuspendedParams): Promise<void> {
    const greeting = displayName || 'there';
    const duration = expiresAt
      ? `Your suspension is effective until ${new Date(expiresAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })}.`
      : 'This suspension is effective immediately and has no set end date.';

    await this.sendEmail({
      to: email,
      subject: `Account Suspended — ${STUDIO.name}`,
      text: `Hi ${greeting},\n\nYour account on ${STUDIO.name} has been suspended.\n\nReason: ${reason}\n\n${duration}\n\nYou can still log in to view your history, but you cannot make new transactions.\n\nTo appeal, contact ${supportEmail}.\n\n${SIGNATURE_TEXT}`,
      html: `
        <h2>Account Suspended</h2>
        <p>Hi ${escapeHtml(greeting)},</p>
        <p>Your account on ${STUDIO.name} has been <strong>suspended</strong>.</p>
        <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
        <p>${escapeHtml(duration)}</p>
        <p>You can still log in to view your history, but you cannot make new transactions.</p>
        <p>To appeal, contact <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a>.</p>
        <br />
        ${SIGNATURE_HTML}
      `,
    });
  },

  async sendAccountReinstated({
    email,
    displayName,
  }: AccountReinstatedParams): Promise<void> {
    const greeting = displayName || 'there';

    await this.sendEmail({
      to: email,
      subject: `Account Reinstated — ${STUDIO.name}`,
      text: `Hi ${greeting},\n\nGreat news! Your account on ${STUDIO.name} has been reinstated. You now have full access to all platform features again.\n\nPlease review and republish any listings that were deactivated during your suspension.\n\nThank you.\n\n${SIGNATURE_TEXT}`,
      html: `
        <h2>Account Reinstated</h2>
        <p>Hi ${escapeHtml(greeting)},</p>
        <p>Great news! Your account on ${STUDIO.name} has been <strong>reinstated</strong>. You now have full access to all platform features again.</p>
        <p>Please review and republish any listings that were deactivated during your suspension.</p>
        <p>Thank you.</p>
        <br />
        ${SIGNATURE_HTML}
      `,
    });
  },

  async sendDisputeFiled({
    email,
    displayName,
    disputeType,
    disputeId,
    role,
  }: DisputeFiledParams): Promise<void> {
    const greeting = displayName || 'there';
    const typeLabel = disputeType.replace(/_/g, ' ');
    const ref = disputeId.slice(0, 8).toUpperCase();

    const roleMessage = role === 'filer'
      ? 'Your dispute has been submitted and our team will review it shortly.'
      : role === 'admin'
      ? `A new ${typeLabel} dispute (${ref}) requires your review.`
      : `A ${typeLabel} dispute (${ref}) has been filed on a booking you are part of. Our team will review it and keep you informed.`;

    await this.sendEmail({
      to: email,
      subject: `Dispute Filed — ${ref} — ${STUDIO.name}`,
      text: `Hi ${greeting},\n\n${roleMessage}\n\nDispute Reference: ${ref}\nType: ${typeLabel}\n\nYou can view the dispute details and add comments in your dashboard.\n\n${SIGNATURE_TEXT}`,
      html: `
        <h2>Dispute Filed</h2>
        <p>Hi ${escapeHtml(greeting)},</p>
        <p>${escapeHtml(roleMessage)}</p>
        <table style="border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Reference</td><td>${ref}</td></tr>
          <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Type</td><td>${escapeHtml(typeLabel)}</td></tr>
        </table>
        <p>You can view the dispute details and add comments in your dashboard.</p>
        <br />
        ${SIGNATURE_HTML}
      `,
    });
  },

  async sendDisputeResolved({
    email,
    displayName,
    disputeType,
    resolution,
    resolutionNotes,
    refundAmount,
  }: DisputeResolvedParams): Promise<void> {
    const greeting = displayName || 'there';
    const typeLabel = disputeType.replace(/_/g, ' ');
    const resolutionLabel = resolution.replace(/_/g, ' ');
    const refundLine = refundAmount && refundAmount > 0
      ? `\nRefund Amount: R${refundAmount.toLocaleString('en-ZA')}`
      : '';
    const notesLine = resolutionNotes ? `\nNotes: ${resolutionNotes}` : '';

    await this.sendEmail({
      to: email,
      subject: `Dispute Resolved — ${STUDIO.name}`,
      text: `Hi ${greeting},\n\nYour ${typeLabel} dispute has been resolved.\n\nResolution: ${resolutionLabel}${refundLine}${notesLine}\n\nIf you have any questions about this resolution, please contact our support team.\n\n${SIGNATURE_TEXT}`,
      html: `
        <h2>Dispute Resolved</h2>
        <p>Hi ${escapeHtml(greeting)},</p>
        <p>Your <strong>${escapeHtml(typeLabel)}</strong> dispute has been resolved.</p>
        <table style="border-collapse: collapse; margin: 16px 0;">
          <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Resolution</td><td>${escapeHtml(resolutionLabel)}</td></tr>
          ${refundAmount && refundAmount > 0 ? `<tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Refund</td><td>R${refundAmount.toLocaleString('en-ZA')}</td></tr>` : ''}
          ${resolutionNotes ? `<tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Notes</td><td>${escapeHtml(resolutionNotes)}</td></tr>` : ''}
        </table>
        <p>If you have any questions about this resolution, please contact our support team.</p>
        <br />
        ${SIGNATURE_HTML}
      `,
    });
  },
};
