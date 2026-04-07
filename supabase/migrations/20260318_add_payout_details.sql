-- Ensure manual payout columns exist (used by withdrawal UI)

alter table public.transactions
  add column if not exists payout_method text;

alter table public.transactions
  add column if not exists payout_details text;

