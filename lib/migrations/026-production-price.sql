-- Migration 026: Add price to smart_productions
-- Allows admin to set a price per production project.

alter table smart_productions
  add column if not exists price integer,
  add column if not exists currency text not null default 'ZAR';

comment on column smart_productions.price is 'Price in cents-free integer (e.g. 15000 = R15,000)';
comment on column smart_productions.currency is 'ISO 4217 currency code, default ZAR';
