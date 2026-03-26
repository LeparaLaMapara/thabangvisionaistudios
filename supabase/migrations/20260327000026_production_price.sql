-- Migration 026: Add price to smart_productions

alter table smart_productions
  add column if not exists price integer,
  add column if not exists currency text not null default 'ZAR';
