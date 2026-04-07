-- Admin Panel Pro v1.1 support

-- 1) Ban flag
alter table public.profiles
  add column if not exists is_banned boolean not null default false;

-- 2) Low-cost financial metrics for dashboard cards
create or replace function public.admin_financial_metrics()
returns table (
  total_donated numeric,
  pending_payouts numeric,
  pending_withdrawals numeric
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce((
      select sum(t.amount)
      from public.transactions t
      where t.type in ('donation', 'deposit', 'wallet_topup', 'mission_reward')
    ), 0) as total_donated,
    coalesce((select sum(coalesce(p.frozen_balance, 0)) from public.profiles p), 0) as pending_payouts,
    coalesce((
      select sum(t.amount)
      from public.transactions t
      where t.type = 'withdrawal'
    ), 0) as pending_withdrawals;
$$;

grant execute on function public.admin_financial_metrics() to authenticated;

-- 3) Force-cancel mission with escrow refund (Admin action)
create or replace function public.force_cancel_mission(p_mission_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_creator_id uuid;
  v_status text;
  v_amount numeric;
  v_wallet numeric;
  v_frozen numeric;
begin
  -- Lock mission row
  select creator_id,
         status,
         coalesce(current_funding, amount_target)::numeric
    into v_creator_id, v_status, v_amount
  from public.missions
  where id = p_mission_id
  for update;

  if v_creator_id is null then
    raise exception 'Mission not found';
  end if;

  if v_status in ('completed', 'cancelled') then
    raise exception 'Mission cannot be cancelled from status %', v_status;
  end if;

  if v_amount is null then
    v_amount := 0;
  end if;

  -- Lock creator profile row
  select coalesce(wallet_balance, 0),
         coalesce(frozen_balance, 0)
    into v_wallet, v_frozen
  from public.profiles
  where id = v_creator_id
  for update;

  -- Move funds: frozen -> wallet
  if v_amount > 0 then
    if v_frozen < v_amount then
      raise exception 'Insufficient frozen balance for refund';
    end if;

    update public.profiles
      set frozen_balance = coalesce(frozen_balance, 0) - v_amount,
          wallet_balance = coalesce(wallet_balance, 0) + v_amount
    where id = v_creator_id;

    insert into public.transactions (user_id, mission_id, amount, type, gateway, created_at)
    values (v_creator_id, p_mission_id, v_amount, 'refund', 'internal', now());
  end if;

  -- Update mission status
  update public.missions
    set status = 'cancelled'
  where id = p_mission_id;
end;
$$;

grant execute on function public.force_cancel_mission(uuid) to authenticated;

