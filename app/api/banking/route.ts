export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const PAYSTACK_API = 'https://api.paystack.com';

function getPaystackKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error('PAYSTACK_SECRET_KEY not configured');
  return key;
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

    // Mask account number for security (show last 4 digits only)
    return NextResponse.json({
      ...data,
      account_number: '****' + (data.account_number as string).slice(-4),
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

    if (!checkRateLimit(`banking:${user.id}`, 3, 60_000)) {
      return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
    }

    const body = await req.json();
    const { bank_name, bank_code, account_number, account_type, account_holder } = body;

    // Validate required fields
    if (!bank_name || !bank_code || !account_number || !account_type || !account_holder) {
      return NextResponse.json({ error: 'All banking fields are required' }, { status: 400 });
    }

    if (!['cheque', 'savings'].includes(account_type)) {
      return NextResponse.json({ error: 'Account type must be cheque or savings' }, { status: 400 });
    }

    // Validate account number (only digits, 7-13 chars for SA banks)
    if (!/^\d{7,13}$/.test(account_number)) {
      return NextResponse.json({ error: 'Invalid account number' }, { status: 400 });
    }

    // Create Paystack transfer recipient
    let recipientCode: string | null = null;
    try {
      const res = await fetch(`${PAYSTACK_API}/transferrecipient`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getPaystackKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'nuban',
          name: account_holder,
          account_number: account_number,
          bank_code: bank_code,
          currency: 'ZAR',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.status && data.data?.recipient_code) {
          recipientCode = data.data.recipient_code as string;
        }
      }
    } catch (err) {
      console.error('[banking] Paystack recipient creation failed:', err);
      // Don't block — we can create the recipient later
    }

    // Upsert banking details
    const { error } = await supabase
      .from('banking_details')
      .upsert({
        user_id: user.id,
        bank_name,
        bank_code,
        account_number,
        account_type,
        account_holder,
        paystack_recipient_code: recipientCode,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('[banking] Save error:', error.message);
      return NextResponse.json({ error: 'Failed to save banking details' }, { status: 500 });
    }

    return NextResponse.json({ success: true, has_recipient: !!recipientCode });
  } catch (err) {
    console.error('[banking POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
