-- 061: payment_confirmations, one row per provider payment reference.
--
-- Written only by a signature-verified payment webhook (service role). It is
-- how a Yoco payment is confirmed, because Yoco has no "look up a checkout"
-- call; lib/payments/routing.ts verifyPayment reads it for "ch_" references.
-- Nobody else can read or write it (RLS on, no policies).

create table if not exists public.payment_confirmations (
  reference   text primary key,
  provider    text not null,
  payment_id  text,
  amount      numeric not null default 0,
  status      text not null,
  event_type  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.payment_confirmations enable row level security;
