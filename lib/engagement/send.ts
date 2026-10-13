import { STUDIO } from '@/lib/constants';
import { appUrl, envFlag } from '@/lib/app-url';
import { email as emailProvider } from '@/lib/email';
import { renderEmail, type EmailContent, type RenderedEmail } from './templates';
import { isUnsubscribeConfigured, unsubscribeHeaders, unsubscribePageUrl } from './unsubscribe';

/**
 * Sends one lifecycle email: brand layout, plain-text twin, signed
 * unsubscribe link and List-Unsubscribe headers.
 *
 * ENGAGEMENT_DRY_RUN=true logs what would go out (subject and stage only,
 * never the address) and sends nothing.
 */

export function isDryRun(): boolean {
  return envFlag(process.env.ENGAGEMENT_DRY_RUN);
}

export function renderLifecycle(userId: string, content: EmailContent, why: 'service' | 'marketing'): RenderedEmail {
  return renderEmail(content, { baseUrl: appUrl(STUDIO.meta.url), unsubscribeUrl: unsubscribePageUrl(userId), why });
}

export type SendOutcome = { ok: true; subject: string; dryRun: boolean } | { ok: false; retryable: boolean; message: string };

export async function sendLifecycleEmail(params: {
  userId: string;
  to: string;
  content: EmailContent;
  why: 'service' | 'marketing';
  dryRun?: boolean;
}): Promise<SendOutcome> {
  if (!isUnsubscribeConfigured()) {
    return { ok: false, retryable: true, message: 'ENGAGEMENT_SIGNING_SECRET is not set, so no unsubscribe link can be made' };
  }
  const rendered = renderLifecycle(params.userId, params.content, params.why);
  if (params.dryRun ?? isDryRun()) {
    console.log(`[engagement] dry run: would email "${rendered.subject}" (${params.why})`);
    return { ok: true, subject: rendered.subject, dryRun: true };
  }
  if (!emailProvider.isConfigured()) {
    return { ok: false, retryable: true, message: 'email is not set up on this site' };
  }
  try {
    await emailProvider.sendEmail({
      to: params.to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      headers: unsubscribeHeaders(params.userId),
    });
    return { ok: true, subject: rendered.subject, dryRun: false };
  } catch (err) {
    return { ok: false, retryable: true, message: err instanceof Error ? err.message.slice(0, 300) : 'email failed' };
  }
}
