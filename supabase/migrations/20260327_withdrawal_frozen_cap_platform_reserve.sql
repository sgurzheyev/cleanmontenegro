-- Withdrawals: max = wallet_balance - frozen_balance; accumulate exit fee in platform_reserve

create table if not exists public.platform_reserve (
  id smallint primary key default 1 check (id = 1),
  balance_usd numeric not null default 0 check (balance_usd >= 0)
);

insert into public.platform_reserve (id, balance_usd)
values (1, 0)
on conflict (id) do nothing;

-- Sync reserve with historical platform_fee_exit ledger rows (one-time alignment)
update public.platform_reserve pr
set balance_usd = greatest(0, coalesce((
  select sum(amount)
  from public.platform_revenue_ledger
  where source = 'platform_fee_exit'
), 0))
where id = 1;

comment on table public.platform_reserve is 'Cumulative platform exit-tax (12%) and similar reserve; incremented on withdrawal, decremented on rejected exit-tax withdrawals.';

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
  v_frozen numeric;
  v_available numeric;
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

  select coalesce(wallet_balance, 0), coalesce(frozen_balance, 0)
    into v_balance, v_frozen
  from public.profiles
  where id = v_uid
  for update;

  v_available := round(v_balance - v_frozen, 2);

  if v_gross > v_available then
    raise exception 'Withdrawal exceeds available balance (wallet minus frozen security deposit)';
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

  insert into public.platform_revenue_ledger (transaction_id, user_id, mission_id, amount, fee_rate, source, created_at)
  values (v_tx_id, v_uid, null, v_fee, 0.12, 'platform_fee_exit', now());

  update public.platform_reserve
    set balance_usd = coalesce(balance_usd, 0) + v_fee
  where id = 1;

  return v_tx_id;
end;
$$;

grant execute on function public.process_withdrawal_request(numeric, text, text) to authenticated;

-- On reject: refund gross to user; remove ledger via cascade; roll back platform_reserve by recorded fee
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
  v_exit_fee numeric;
begin
  select user_id, status, coalesce(withdrawal_gross_usd, 0), coalesce(withdrawal_fee_usd, 0)
    into v_user_id, v_status, v_gross, v_exit_fee
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

    if coalesce(v_exit_fee, 0) > 0 then
      update public.platform_reserve
        set balance_usd = greatest(0, coalesce(balance_usd, 0) - v_exit_fee)
      where id = 1;
    end if;
  end if;

  delete from public.transactions
  where id = p_transaction_id;
end;
$$;

grant execute on function public.reject_withdrawal_request(uuid) to authenticated;
