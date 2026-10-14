export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { createPayoutRecipient, payoutRecipientsConfigured } from '@/lib/payments/payout';
import { logEvent } from '@/lib/data/events';
import { identityPort } from '@/lib/payments/ports';
import { email as emailProvider } from '@/lib/email';
import { STUDIO } from '@/lib/constants';
import { formatRand } from '@/lib/format/money';

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data } = await supabase
      .from('banking_details')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (!data) return NextResponse.json(null);

    // Fall back to deriving the last four from the legacy column for records
    // saved before migration 039. Never return the full number either way.
    const legacy = data.account_number as string | null;
    const last4 = (data.account_last4 as string | null) ?? (legacy ? legacy.slice(-4) : null);

    const { account_number: _dropped, ...safe } = data;
    void _dropped;

    return NextResponse.json({
      ...safe,
      account_last4: last4,
      account_number_masked: last4 ? `•••• ${last4}` : null,
    });
  } catch (err) {
    console.error('[banking GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!(await checkRateLimit(`banking:${user.id}`, 3, 60_000))) {
      return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
    }

    const body = await req.json();
    const { bank_name, bank_code, account_number, account_type, account_holder, id_number } = body;

    if (!bank_name || !bank_code || !account_number || !account_type || !account_holder) {
      return NextResponse.json({ error: 'All banking fields are required' }, { status: 400 });
    }

    if (!['cheque', 'savings'].includes(account_type)) {
      return NextResponse.json({ error: 'Account type must be cheque or savings' }, { status: 400 });
    }

    // Only digits, 7-13 characters for South African banks.
    if (!/^\d{7,13}$/.test(account_number)) {
      return NextResponse.json({ error: 'Invalid account number' }, { status: 400 });
    }

    if (!payoutRecipientsConfigured()) {
      console.error('[banking] Payout provider not configured');
      return NextResponse.json(
        { error: 'Payouts are not configured on this environment. Please contact support.' },
        { status: 503 },
      );
    }

    // The recipient code IS the stored credential — it is the only thing
    // lib/payments/payout.ts needs to pay this person. So it has to succeed
    // before we save anything. Previously a failure here still saved the
    // record, leaving a creator with banking details that could never be paid
    // and no sign of it until a payout failed weeks later.
    //
    // It doubles as validation: the provider checks the account number against
    // the bank, so a typo is caught here rather than at payout time. The
    // account number goes to the provider only; it is never logged.
    const recipient = await createPayoutRecipient({
      name: account_holder,
      accountNumber: account_number,
      bankCode: bank_code,
    });

    if (!recipient.success) {
      if (recipient.unreachable) {
        return NextResponse.json(
          { error: 'We could not reach our payment provider. Please try again in a moment.' },
          { status: 502 },
        );
      }
      return NextResponse.json(
        { error: `${recipient.error} Please check the account number and bank, then try again.` },
        { status: 400 },
      );
    }
    const recipientCode = recipient.recipientCode;

    // Bank account validation (IdentityPort, spec §7.10): does this account
    // belong to this person? It needs the account holder's SA ID number, which
    // is sent to the provider for this check only. It is never stored or
    // logged. Without it, or if the names don't match the verified profile,
    // the account is saved but not marked validated. That caps the renter's
    // trust tier and keeps owner payouts on hold until a person reviews it.
    // Changing bank details always clears an earlier validation.
    let validated = false;
    let validationMessage: string | null = null;
    const admin = createAdminClient();
    const { data: profile } = await admin
      .from('profiles')
      .select('first_name, last_name, verification_status')
      .eq('id', user.id)
      .maybeSingle();
    const norm = (v: string) => v.toLowerCase().replace(/[^a-z]/g, '');
    const legalName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
    const nameMatches = Boolean(legalName) && norm(String(account_holder)) === norm(legalName);
    if (typeof id_number === 'string' && /^\d{13}$/.test(id_number) && profile?.verification_status === 'verified' && nameMatches) {
      const check = await identityPort.validateBankAccount({
        bankCode: String(bank_code),
        accountNumber: String(account_number),
        accountName: String(account_holder),
        accountType: 'personal',
        documentType: 'identityNumber',
        documentNumber: id_number,
      });
      if (check.ok) {
        validated = check.value.verified;
        validationMessage = check.value.verified ? null : 'The bank could not confirm this account belongs to you.';
      } else {
        validationMessage = 'We could not validate the account just now. It is saved; you can try again later.';
      }
    } else if (!nameMatches) {
      validationMessage = 'The account holder must match the name on your verified ID for the account to be validated.';
    } else if (profile?.verification_status !== 'verified') {
      validationMessage = 'Complete identity verification first; then the account can be validated.';
    } else {
      validationMessage = 'Add your SA ID number to validate the account.';
    }

    // Store the token and the last four digits. The full account number is
    // deliberately NOT persisted — Paystack holds it against the recipient
    // code, and nothing in this codebase reads it back. See migration 039.
    //
    // Written with the service role, scoped to the signed-in user's own row:
    // paystack_recipient_code and account_holder are server-only columns
    // (migration 067 rejects user-session writes to them).
    const { error } = await admin
      .from('banking_details')
      .upsert({
        user_id: user.id,
        bank_name,
        bank_code,
        account_last4: String(account_number).slice(-4),
        account_type,
        account_holder,
        paystack_recipient_code: recipientCode,
        is_verified: validated,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('[banking] Save error:', error.message);
      // A denial from the column guard (migration 067) is logged as a separate
      // statement; the failed write itself rolled back. No PII, no account numbers.
      if (error.code === '42501' || error.code === 'P0001') {
        logEvent({
          eventType: 'security_write_denied',
          eventCategory: 'security',
          userId: user.id,
          metadata: { table: 'banking_details', code: error.code },
        });
      }
      return NextResponse.json({ error: 'Failed to save banking details' }, { status: 500 });
    }

    // Someone whose card refund was refused was asked to add this account
    // (refund_failed): tell the owner straight away so it can be paid.
    await alertOwnerIfRefundWaiting(admin, user.id, user.email ?? null, { bank_name, last4: String(account_number).slice(-4), validated });

    logEvent({ eventType: validated ? 'bank_account_validated' : 'bank_account_saved_unvalidated', eventCategory: 'payout', userId: user.id, metadata: { provider: identityPort.provider } });
    return NextResponse.json({ success: true, has_recipient: true, validated, message: validationMessage });
  } catch (err) {
    console.error('[banking POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function alertOwnerIfRefundWaiting(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  userEmail: string | null,
  bank: { bank_name: string; last4: string; validated: boolean },
): Promise<void> {
  try {
    const { data } = await admin
      .from('refund_obligations')
      .select('amount_cents')
      .eq('user_id', userId)
      .in('state', ['failed', 'needs_attention']);
    const waiting = (data ?? []) as { amount_cents: number }[];
    if (waiting.length === 0) return;
    const total = waiting.reduce((sum, r) => sum + r.amount_cents, 0);
    await emailProvider.sendEmail({
      to: STUDIO.ownerAlertsTo,
      subject: `[Refund] ${userEmail ?? 'A renter'} added bank details: ${formatRand(total / 100)} to pay`,
      text: [
        `${userEmail ?? 'A renter'} added a bank account for the refund their card refused.`,
        '',
        `Bank: ${bank.bank_name}, account ending ${bank.last4}${bank.validated ? ' (validated)' : ' (NOT validated: check the name with them first)'}.`,
        `To pay: ${formatRand(total / 100)} (${waiting.length} refund${waiting.length === 1 ? '' : 's'}).`,
        '',
        `Rental ops shows the Paystack recipient to pay: ${STUDIO.meta.url}/admin/rental-ops`,
      ].join('\n'),
    });
  } catch (err) {
    console.error('[banking] refund owner alert failed:', err instanceof Error ? err.message : err);
  }
}

