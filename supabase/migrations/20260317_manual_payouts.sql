-- Admin Payout Dashboard: pending withdrawals queue + approval RPC

alter table public.transactions
  add column if not exists status text not null default 'completed',
  add column if not exists payout_method text,
  add column if not exists payout_details text;

-- Optional safety: limit allowed status values
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transactions_status_check'
  ) then
    alter table public.transactions
      add constraint transactions_status_check
      check (status in ('pending', 'completed', 'failed'));
  end if;
end $$;

-- Approve a pending manual payout:
-- - validates transaction exists and is pending
-- - validates user has sufficient wallet_balance
-- - deducts wallet_balance
-- - marks transaction completed
create or replace function public.approve_manual_payout(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_amount numeric;
  v_status text;
  v_balance numeric;
begin
  select user_id, amount, status
    into v_user_id, v_amount, v_status
  from public.transactions
  where id = p_transaction_id
    and type = 'withdrawal'
  for update;

  if v_user_id is null then
    raise exception 'Transaction not found';
  end if;

  if v_status <> 'pending' then
    raise exception 'Transaction is not pending';
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'Invalid transaction amount';
  end if;

  select coalesce(wallet_balance, 0)
    into v_balance
  from public.profiles
  where id = v_user_id
  for update;

  if v_balance < v_amount then
    raise exception 'Insufficient funds';
  end if;

  update public.profiles
    set wallet_balance = coalesce(wallet_balance, 0) - v_amount
  where id = v_user_id;

  update public.transactions
    set status = 'completed'
  where id = p_transaction_id;
end;
$$;

grant execute on function public.approve_manual_payout(uuid) to authenticated;

