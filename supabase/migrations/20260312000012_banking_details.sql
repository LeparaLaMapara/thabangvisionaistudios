-- Banking details for creators (needed for payouts)
CREATE TABLE IF NOT EXISTS banking_details (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  bank_code text NOT NULL,
  account_number text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('cheque', 'savings')),
  account_holder text NOT NULL,
  paystack_recipient_code text,
  is_verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- RLS
ALTER TABLE banking_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own banking details" ON banking_details FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own banking details" ON banking_details FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own banking details" ON banking_details FOR UPDATE USING (auth.uid() = user_id);

-- Add financial columns to crew_requests
ALTER TABLE crew_requests ADD COLUMN IF NOT EXISTS quoted_rate numeric;
ALTER TABLE crew_requests ADD COLUMN IF NOT EXISTS estimated_hours numeric;
ALTER TABLE crew_requests ADD COLUMN IF NOT EXISTS deposit_amount numeric;
ALTER TABLE crew_requests ADD COLUMN IF NOT EXISTS total_amount numeric;
ALTER TABLE crew_requests ADD COLUMN IF NOT EXISTS commission_amount numeric;
