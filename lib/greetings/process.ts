import { createAdminClient } from '@/lib/supabase/server';
import { generateWithFallback } from '@/lib/ai/resilient';
import { logTokenUsage } from '@/lib/ai/tracked';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { checkRateLimit } from '@/lib/auth';
import { sendLifecycleEmail } from '@/lib/engagement/send';
import { contentFromText } from '@/lib/engagement/templates';
import { withTextSignature } from '@/lib/email/signature';
import { isUnsubscribeConfigured } from '@/lib/engagement/unsubscribe';
import {
  describeActivity,
  firstNameFrom,
  isInternalAccount,
  isSafeDraft,
  welcomePrompt,
  welcomeSubject,
  welcomeTemplate,
  type SignupActivity,
  type WelcomeContext,
} from '@/lib/greetings/welcome';

type Admin = ReturnType<typeof createAdminClient>;

async function countRows(admin: Admin, table: string, column: string, userId: string): Promise<number> {
  const { count } = await admin.from(table).select('id', { count: 'exact', head: true }).eq(column, userId);
  return count ?? 0;
}

/** Reads what a person has done on the site. Counts only. */
export async function loadWelcomeContext(
  admin: Admin,
  userId: string,
): Promise<{ email: string | null; ctx: WelcomeContext; marketingOptIn: boolean } | null> {
  const { data: auth } = await admin.auth.admin.getUserById(userId);
  const user = auth?.user;
  if (!user) return null;

  const { data: profile } = await admin
    .from('profiles')
    .select('first_name, display_name, verification_status, marketing_opt_in')
    .eq('id', userId)
    .maybeSingle();

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const intentRaw = meta.intent;
  const intent: SignupActivity['intent'] =
    intentRaw === 'rent' || intentRaw === 'hire' || intentRaw === 'list' || intentRaw === 'supply' || intentRaw === 'browse' ? intentRaw : null;
  const status = profile?.verification_status;

  const [cartItems, gearBookings, serviceBookings, ubunyeChats] = await Promise.all([
    countRows(admin, 'cart_items', 'user_id', userId),
    countRows(admin, 'equipment_bookings', 'user_id', userId),
    countRows(admin, 'bookings', 'client_id', userId),
    countRows(admin, 'chat_conversations', 'user_id', userId),
  ]);

  return {
    email: user.email ?? null,
    marketingOptIn: Boolean(profile?.marketing_opt_in),
    ctx: {
      firstName: firstNameFrom([
        profile?.first_name,
        meta.first_name as string | undefined,
        meta.given_name as string | undefined,
        meta.full_name as string | undefined,
        meta.name as string | undefined,
        profile?.display_name,
      ]),
      method: user.app_metadata?.provider === 'google' ? 'google' : 'email',
      activity: {
        intent,
        emailConfirmed: Boolean(user.email_confirmed_at),
        verification:
          status === 'pending' || status === 'verified' || status === 'rejected' ? status : 'none',
        cartItems,
        gearBookings,
        serviceBookings,
        ubunyeChats,
      },
    },
  };
}

/** Ubunye's draft, or the plain template when no AI provider answers. */
export async function draftWelcome(ctx: WelcomeContext): Promise<{ subject: string; body: string; draftedBy: string }> {
  try {
    if (!(await checkRateLimit('signup-ai-draft', STUDIO.welcomes.aiDraftsPerHour, 3_600_000))) {
      throw new Error('hourly AI draft cap reached');
    }
    const { system, prompt } = welcomePrompt(ctx);
    const out = await generateWithFallback({ ref: 'fast', system, prompt, maxOutputTokens: 400, temperature: 0.6 });
    logTokenUsage({ agentId: 'welcome', provider: out.servedBy, model: out.modelId, usage: out.usage });
    const body = out.text.trim();
    // The one signature, in place of any sign-off the model wrote anyway.
    if (isSafeDraft(body)) return { subject: welcomeSubject(ctx), body: withTextSignature(body), draftedBy: `ai:${out.servedBy}` };
    console.warn('[welcome] AI draft rejected by the safety check; using the template');
  } catch (err) {
    console.error('[welcome] AI draft failed; using the template:', err instanceof Error ? err.message : err);
  }
  const t = welcomeTemplate(ctx);
  return { ...t, draftedBy: 'template' };
}

/**
 * Handles one signup: drafts the welcome into the queue (once per person, the
 * table's primary key is the user id) and tells the owner. Safe to call twice.
 *
 * Only once the email is confirmed: anyone can create accounts with made-up
 * addresses, and each draft costs an AI call and an owner email. The
 * database calls the webhook again when the email is confirmed (088), and
 * the daily sweep catches anything missed.
 */
export async function processSignup(
  userId: string,
  options: { notifyOwner: boolean } = { notifyOwner: true },
): Promise<{ status: 'drafted' | 'exists' | 'internal' | 'missing' | 'unconfirmed' }> {
  const admin = createAdminClient();

  const { data: existing } = await admin.from('welcome_messages').select('user_id').eq('user_id', userId).maybeSingle();
  if (existing) return { status: 'exists' };

  const loaded = await loadWelcomeContext(admin, userId);
  if (!loaded) return { status: 'missing' };
  if (isInternalAccount(loaded.email)) return { status: 'internal' };
  if (!loaded.ctx.activity.emailConfirmed) return { status: 'unconfirmed' };

  const draft = await draftWelcome(loaded.ctx);
  const { error } = await admin.from('welcome_messages').insert({
    user_id: userId,
    email: loaded.email,
    first_name: loaded.ctx.firstName,
    signup_method: loaded.ctx.method,
    activity: loaded.ctx.activity,
    subject: draft.subject,
    body: draft.body,
    drafted_by: draft.draftedBy,
    status: 'draft',
  });
  // 23505: another call drafted it first. One welcome per person.
  if (error) {
    if (error.code === '23505') return { status: 'exists' };
    throw new Error(`welcome insert failed: ${error.message}`);
  }

  const ownerNote =
    options.notifyOwner && (await checkRateLimit('signup-owner-note', STUDIO.welcomes.ownerNotesPerHour, 3_600_000));
  if (options.notifyOwner && !ownerNote) console.warn('[welcome] hourly owner-note cap reached; note skipped for', userId);
  if (ownerNote) {
    const name = loaded.ctx.firstName ?? 'Someone';
    await emailProvider
      .sendEmail({
        to: STUDIO.ownerAlertsTo,
        subject: `[Signup] ${name} joined ${STUDIO.name}`,
        text: [
          `${name} (${loaded.email}) signed up with ${loaded.ctx.method === 'google' ? 'Google' : 'email'}.`,
          '',
          'So far:',
          ...describeActivity(loaded.ctx.activity).map((l) => `- ${l}`),
          '',
          STUDIO.welcomes.autoSendAfterHours === null
            ? `Ubunye has drafted a welcome for them. Read, edit and send it at ${STUDIO.meta.url}/admin/welcomes`
            : `Ubunye has drafted a welcome for them. It goes out by itself once their email is confirmed. See it at ${STUDIO.meta.url}/admin/welcomes`,
        ].join('\n'),
      })
      .catch((err) => console.error('[welcome] owner note failed:', err));
  }

  return { status: 'drafted' };
}

/**
 * Sends a queued welcome. Only a draft is ever sent, and only once. With the
 * lifecycle signing secret set, it goes in the brand layout with an
 * unsubscribe link (lib/engagement/send.ts); without it, as plain text.
 */
export async function sendWelcome(
  userId: string,
  sentBy: string | null,
  options: { dryRun?: boolean } = {},
): Promise<{ ok: boolean; error?: string; subject?: string }> {
  // With no email set up the provider skips the send without an error, so the
  // welcome would be marked sent although nobody got it. Say so instead.
  if (!options.dryRun && !emailProvider.isConfigured()) {
    return { ok: false, error: 'Email is not set up on this site, so nothing was sent. The welcome stays a draft.' };
  }
  const admin = createAdminClient();

  if (options.dryRun) {
    const { data } = await admin.from('welcome_messages').select('subject, status').eq('user_id', userId).maybeSingle();
    if (data?.status !== 'draft') return { ok: false, error: 'Not a draft (already sent or discarded).' };
    console.log(`[engagement] dry run: would send the welcome "${data.subject}"`);
    return { ok: true, subject: data.subject };
  }

  // Claim it first, so two clicks cannot send two emails.
  const { data: claimed } = await admin
    .from('welcome_messages')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('status', 'draft')
    .select('email, subject, body')
    .maybeSingle();
  if (!claimed?.email) return { ok: false, error: 'Not a draft (already sent or discarded).' };

  try {
    if (isUnsubscribeConfigured()) {
      const sent = await sendLifecycleEmail({
        userId,
        to: claimed.email,
        content: contentFromText(claimed.subject, claimed.body),
        why: 'service',
        dryRun: false,
      });
      if (!sent.ok) throw new Error(sent.message);
    } else {
      await emailProvider.sendEmail({ to: claimed.email, subject: claimed.subject, text: claimed.body });
    }
  } catch (err) {
    await admin.from('welcome_messages').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('user_id', userId);
    return { ok: false, error: err instanceof Error ? err.message : 'Email failed' };
  }

  await admin
    .from('welcome_messages')
    .update({ status: 'sent', sent_by: sentBy, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  return { ok: true, subject: claimed.subject };
}

/**
 * Sends drafts older than the configured hours (STUDIO.welcomes.autoSendAfterHours).
 * With 0 (send straight away) this does nothing: the lifecycle engine
 * (lib/engagement) sends welcomes, with the caps, consent and unsubscribe rules.
 */
export async function autoSendWelcomes(afterHours: number | null): Promise<number> {
  if (afterHours === null || afterHours <= 0) return 0;
  const cutoff = new Date(Date.now() - afterHours * 3_600_000).toISOString();
  const { data } = await createAdminClient()
    .from('welcome_messages')
    .select('user_id')
    .eq('status', 'draft')
    .lt('created_at', cutoff)
    .limit(50);
  let sent = 0;
  for (const row of data ?? []) {
    if ((await sendWelcome(row.user_id, null)).ok) sent++;
  }
  return sent;
}

/** Drafts a welcome for everyone who has none yet (the backfill, and the daily safety net). */
export async function draftMissingWelcomes(options: { sinceDays?: number; notifyOwner: boolean }): Promise<Record<string, number>> {
  const admin = createAdminClient();
  const since = options.sinceDays ? Date.now() - options.sinceDays * 86_400_000 : 0;
  const tally: Record<string, number> = {};

  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users ?? [];
    for (const u of users) {
      if (since && new Date(u.created_at).getTime() < since) continue;
      const { status } = await processSignup(u.id, { notifyOwner: options.notifyOwner });
      tally[status] = (tally[status] ?? 0) + 1;
    }
    if (users.length < 200) break;
  }
  return tally;
}
