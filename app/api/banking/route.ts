export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const PAYSTACK_API = 'https://api.paystack.com';

function getPaystackKey(): string | null {
  return process.env.PAYSTACK_SECRET_KEY ?? null;
}

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
    const { bank_name, bank_code, account_number, account_type, account_holder } = body;

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

    const secretKey = getPaystackKey();
    if (!secretKey) {
      console.error('[banking] PAYSTACK_SECRET_KEY not configured');
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
    // It doubles as validation: Paystack checks the account number against the
    // bank, so a typo is caught here rather than at payout time.
    let recipientCode: string | null = null;
    try {
      const res = await fetch(`${PAYSTACK_API}/transferrecipient`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'nuban',
          name: account_holder,
          account_number,
          bank_code,
          currency: 'ZAR',
        }),
      });

      const data = await res.json().catch(() => null);

      if (res.ok && data?.status && data?.data?.recipient_code) {
        recipientCode = data.data.recipient_code as string;
      } else {
        const reason = typeof data?.message === 'string'
          ? data.message
          : 'Your bank could not verify these details.';
        return NextResponse.json(
          { error: `${reason} Please check the account number and bank, then try again.` },
          { status: 400 },
        );
      }
    } catch (err) {
      console.error('[banking] Paystack recipient creation failed:', err);
      return NextResponse.json(
        { error: 'We could not reach our payment provider. Please try again in a moment.' },
        { status: 502 },
      );
    }

    // Store the token and the last four digits. The full account number is
    // deliberately NOT persisted — Paystack holds it against the recipient
    // code, and nothing in this codebase reads it back. See migration 039.
    const { error } = await supabase
      .from('banking_details')
      .upsert({
        user_id: user.id,
        bank_name,
        bank_code,
        account_last4: String(account_number).slice(-4),
        account_type,
        account_holder,
        paystack_recipient_code: recipientCode,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('[banking] Save error:', error.message);
      return NextResponse.json({ error: 'Failed to save banking details' }, { status: 500 });
    }

    return NextResponse.json({ success: true, has_recipient: true });
  } catch (err) {
    console.error('[banking POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
