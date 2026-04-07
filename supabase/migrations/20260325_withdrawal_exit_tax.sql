-- 12% exit tax on manual withdrawals: process_withdrawal_request + platform_revenue_ledger

-- Ledger for platform fees (withdrawal exit tax, etc.)
create table if not exists public.platform_revenue_ledger (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid references public.transactions(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  amount numeric not null check (amount >= 0),
  fee_rate numeric,
  source text not null,
  created_at timestamptz not null default now()
);

create index if not exists platform_revenue_ledger_user_id_idx on public.platform_revenue_ledger (user_id);
create index if not exists platform_revenue_ledger_created_at_idx on public.platform_revenue_ledger (created_at desc);

alter table public.transactions
  add column if not exists withdrawal_gross_usd numeric,
  add column if not exists withdrawal_fee_usd numeric,
  add column if not exists withdrawal_net_usd numeric;

comment on column public.transactions.withdrawal_gross_usd is 'Full amount deducted from wallet at request time (before 12% fee)';
comment on column public.transactions.withdrawal_fee_usd is '12% platform exit tax';
comment on column public.transactions.withdrawal_net_usd is 'Amount user receives after fee';

-- Process payout request: deduct gross from wallet, record fee in ledger, insert pending withdrawal (amount = net to pay).
create or replace function public.process_withdrawal_request(
  p_requested_amount numeric,
  p_payout_method text,
  p_payout_details text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_gross numeric;
  v_fee numeric;
  v_net numeric;
  v_balance numeric;
  v_tx_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  v_gross := round(coalesce(p_requested_amount, 0)::numeric, 2);
  if v_gross <= 0 then
    raise exception 'Invalid withdrawal amount';
  end if;

  v_fee := round(v_gross * 0.12, 2);
  v_net := round(v_gross - v_fee, 2);
  if v_net < 0 then
    raise exception 'Invalid net amount after fee';
  end if;

  if p_payout_details is null or length(trim(p_payout_details)) = 0 then
    raise exception 'Payout details are required';
  end if;

  select coalesce(wallet_balance, 0)
    into v_balance
  from public.profiles
  where id = v_uid
  for update;

  if v_balance < v_gross then
    raise exception 'Insufficient wallet balance';
  end if;

  update public.profiles
    set wallet_balance = coalesce(wallet_balance, 0) - v_gross
  where id = v_uid;

  insert into public.transactions (
    user_id,
    mission_id,
    amount,
    type,
    gateway,
    status,
    payout_method,
    payout_details,
    withdrawal_gross_usd,
    withdrawal_fee_usd,
    withdrawal_net_usd,
    created_at
  )
  values (
    v_uid,
    null,
    v_net,
    'withdrawal',
    'manual',
    'pending',
    nullif(trim(coalesce(p_payout_method, '')), ''),
    trim(p_payout_details),
    v_gross,
    v_fee,
    v_net,
    now()
  )
  returning id into v_tx_id;

  insert into public.platform_revenue_ledger (transaction_id, user_id, amount, fee_rate, source, created_at)
  values (v_tx_id, v_uid, v_fee, 0.12, 'withdrawal_exit_tax', now());

  return v_tx_id;
end;
$$;

grant execute on function public.process_withdrawal_request(numeric, text, text) to authenticated;

-- Approve: if wallet was already debited at request, only mark completed; else legacy deduct-on-approve.
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
  v_gross numeric;
begin
  select user_id, amount, status, coalesce(withdrawal_gross_usd, 0)
    into v_user_id, v_amount, v_status, v_gross
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

  if coalesce(v_gross, 0) > 0 then
    -- Exit-tax flow: funds already deducted in process_withdrawal_request
    update public.transactions
      set status = 'completed'
    where id = p_transaction_id;
    return;
  end if;

  -- Legacy: deduct full tx.amount from wallet on approval
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

-- Caller is admin (JWT email) or the withdrawal owner (self-cancel).
create or replace function public.is_withdrawal_admin_caller()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce(trim(auth.jwt() ->> 'email'), '') = 'sgurzheyev@gmail.com'
    or coalesce(trim(auth.jwt() ->> 'email'), '') like '%tg_6618910143%'
  );
$$;

-- Reject: refund gross to wallet if exit-tax flow; remove ledger via cascade on tx delete
create or replace function public.reject_withdrawal_request(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_status text;
  v_gross numeric;
begin
  select user_id, status, coalesce(withdrawal_gross_usd, 0)
    into v_user_id, v_status, v_gross
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

  if v_user_id is distinct from auth.uid() and not public.is_withdrawal_admin_caller() then
    raise exception 'Not authorized';
  end if;

  if coalesce(v_gross, 0) > 0 then
    update public.profiles
      set wallet_balance = coalesce(wallet_balance, 0) + v_gross
    where id = v_user_id;
  end if;

  delete from public.transactions
  where id = p_transaction_id;
end;
$$;

grant execute on function public.reject_withdrawal_request(uuid) to authenticated;
