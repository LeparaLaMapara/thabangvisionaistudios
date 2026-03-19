import { createClient } from '@/lib/supabase/server';

export type BankingDetails = {
  id: string;
  user_id: string;
  bank_name: string;
  bank_code: string;
  account_number: string;
  account_type: string;
  account_holder: string;
  paystack_recipient_code: string | null;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
};

export async function getBankingDetails(userId: string): Promise<BankingDetails | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('banking_details')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[getBankingDetails]', error.message);
  }
  return (data as BankingDetails) ?? null;
}
