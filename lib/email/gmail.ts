import nodemailer from 'nodemailer';
import { STUDIO } from '@/lib/constants';
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

  async sendEmail({ to, subject, text, html }: SendEmailOptions): Promise<void> {
    if (!this.isConfigured()) {
      console.warn('[email] GMAIL_USER or GMAIL_APP_PASSWORD not set — email not sent.');
      return;
    }

    const transporter = createTransporter();
    await transporter.sendMail({
      from: `${STUDIO.name} <${GMAIL_USER}>`,
      to,
      subject,
      text,
      html,
    });
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
      text: `Hi ${greeting},\n\nGreat news! Your identity verification has been approved. You now have full access to all platform features.\n\nThank you for being part of our creative community.\n\n— ${STUDIO.name}`,
      html: `
        <h2>Identity Verified</h2>
        <p>Hi ${escapeHtml(greeting)},</p>
        <p>Great news! Your identity verification has been <strong>approved</strong>. You now have full access to all platform features.</p>
        <p>Thank you for being part of our creative community.</p>
        <br />
        <p>— ${STUDIO.name}</p>
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
      text: `Hi ${greeting},\n\nUnfortunately, your identity verification could not be approved at this time.\n\nReason: ${reason}\n\nPlease review the feedback and resubmit your documents when ready.\n\n— ${STUDIO.name}`,
      html: `
        <h2>Verification Update</h2>
        <p>Hi ${escapeHtml(greeting)},</p>
        <p>Unfortunately, your identity verification could not be approved at this time.</p>
        <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
        <p>Please review the feedback and resubmit your documents when ready.</p>
        <br />
        <p>— ${STUDIO.name}</p>
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
      text: `Your booking has been confirmed!\n\nEquipment: ${rentalTitle}\nDates: ${startDate} — ${endDate}\nTotal: ${formattedTotal}\n\nThank you for choosing ${STUDIO.name}.\n\n— ${STUDIO.name}`,
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
        <p>— ${STUDIO.name}</p>
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
      text: `Hi ${greeting},\n\nYour account on ${STUDIO.name} has been suspended.\n\nReason: ${reason}\n\n${duration}\n\nYou can still log in to view your history, but you cannot make new transactions.\n\nTo appeal, contact ${supportEmail}.\n\n— ${STUDIO.name}`,
      html: `
        <h2>Account Suspended</h2>
        <p>Hi ${escapeHtml(greeting)},</p>
        <p>Your account on ${STUDIO.name} has been <strong>suspended</strong>.</p>
        <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
        <p>${escapeHtml(duration)}</p>
        <p>You can still log in to view your history, but you cannot make new transactions.</p>
        <p>To appeal, contact <a href="mailto:${escapeHtml(supportEmail)}">${escapeHtml(supportEmail)}</a>.</p>
        <br />
        <p>— ${STUDIO.name}</p>
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
      text: `Hi ${greeting},\n\nGreat news! Your account on ${STUDIO.name} has been reinstated. You now have full access to all platform features again.\n\nPlease review and republish any listings that were deactivated during your suspension.\n\nThank you.\n\n— ${STUDIO.name}`,
      html: `
        <h2>Account Reinstated</h2>
        <p>Hi ${escapeHtml(greeting)},</p>
        <p>Great news! Your account on ${STUDIO.name} has been <strong>reinstated</strong>. You now have full access to all platform features again.</p>
        <p>Please review and republish any listings that were deactivated during your suspension.</p>
        <p>Thank you.</p>
        <br />
        <p>— ${STUDIO.name}</p>
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
      text: `Hi ${greeting},\n\n${roleMessage}\n\nDispute Reference: ${ref}\nType: ${typeLabel}\n\nYou can view the dispute details and add comments in your dashboard.\n\n— ${STUDIO.name}`,
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
        <p>— ${STUDIO.name}</p>
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
      text: `Hi ${greeting},\n\nYour ${typeLabel} dispute has been resolved.\n\nResolution: ${resolutionLabel}${refundLine}${notesLine}\n\nIf you have any questions about this resolution, please contact our support team.\n\n— ${STUDIO.name}`,
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
        <p>— ${STUDIO.name}</p>
      `,
    });
  },
};
