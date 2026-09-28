-- 064: close the gear loop (take back and settle the deposit).
--
-- damage_fee             what was kept from the deposit for damage or loss.
-- deposit_refund_method  how the released deposit went back: 'card' (refunded
--                        through the payment provider), 'eft' or 'cash' (paid
--                        back by hand), or 'none'.
-- Payments taken by hand (EFT, cash, a card link) are recorded with a
-- payment reference starting "manual:" (lib/payments/routing.ts).
-- Additive. Apply on dev, then production.

alter table public.equipment_bookings
  add column if not exists damage_fee numeric not null default 0,
  add column if not exists deposit_refund_method text;
