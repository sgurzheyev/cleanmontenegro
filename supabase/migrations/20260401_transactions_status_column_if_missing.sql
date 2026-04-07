-- Fixes PostgREST: "column transactions.status does not exist" when older DBs skipped
-- manual_payouts migration. Safe to run multiple times.

alter table public.transactions
  add column if not exists status text default 'completed';

update public.transactions
set status = coalesce(status, 'completed')
where status is null;
