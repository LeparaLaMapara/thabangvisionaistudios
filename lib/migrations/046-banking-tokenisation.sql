-- 039 — Stop storing full bank account numbers
--
-- banking_details.account_number held complete account numbers in readable
-- form. Nothing needed them: payouts run entirely off
-- paystack_recipient_code (lib/payments/payout.ts), and the only other use was
-- masking the value down to its last four digits for display.
--
-- So we keep the last four digits and throw the rest away. Paystack holds the
-- real number against the recipient code, which is what a token is for.
--
-- SAFE TO RUN BEFORE OR AFTER DEPLOYING THE MATCHING CODE.
--   Before: old code writes a fresh account_number on the next save, but every
--           number already stored is cleared now.
--   After:  new code never writes the column at all.
--
-- The column itself is dropped by a later migration, once no deployed build
-- references it. Dropping it here would break any instance still running the
-- previous build.

-- 1. Somewhere to keep the display value.
alter table public.banking_details
  add column if not exists account_last4 text;

-- 2. Preserve what the UI actually shows, before we destroy the source.
update public.banking_details
   set account_last4 = right(account_number, 4)
 where account_last4 is null
   and account_number is not null;

-- 3. The column was NOT NULL, which would reject an insert that omits it.
alter table public.banking_details
  alter column account_number drop not null;

-- 4. The point of the exercise: remove the stored numbers.
update public.banking_details
   set account_number = null
 where account_number is not null;

comment on column public.banking_details.account_last4 is
  'Last four digits only, for display. The full account number is never stored — Paystack holds it against paystack_recipient_code.';
comment on column public.banking_details.account_number is
  'DEPRECATED and always null. Retained only so an older deployed build does not error. Dropped in a later migration.';
