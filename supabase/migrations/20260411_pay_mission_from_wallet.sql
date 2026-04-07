-- Pay for a mission from creator wallet (Phantom Pin / deferred Paymob checkout). Sets mission to 'available'. No Paymob.

create or replace function public.pay_mission_from_wallet(p_mission_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_mission record;
  v_cost integer;
  v_balance numeric;
  n int;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_mission from public.missions where id = p_mission_id for update;
  if not found then
    raise exception 'Mission not found';
  end if;

  if v_mission.creator_id is distinct from uid then
    raise exception 'Forbidden';
  end if;

  if v_mission.status is distinct from 'pending_payment' then
    raise exception 'Mission is not awaiting payment';
  end if;

  v_cost := floor(coalesce(v_mission.amount_target, 0)::numeric);
  if v_cost < 1 then
    raise exception 'Invalid mission amount';
  end if;

  select coalesce(wallet_balance, 0) into v_balance
  from public.profiles
  where id = uid
  for update;

  if not found then
    raise exception 'Profile not found';
  end if;

  if v_balance < v_cost then
    raise exception 'Insufficient wallet balance';
  end if;

  update public.profiles
  set wallet_balance = v_balance - v_cost
  where id = uid;

  update public.missions
  set status = 'available'
  where id = p_mission_id;

  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Failed to update mission';
  end if;

  insert into public.transactions (user_id, mission_id, amount, type, gateway, created_at)
  values (uid, p_mission_id, v_cost, 'payment', 'internal_wallet', now());
end;
$$;

revoke all on function public.pay_mission_from_wallet(uuid) from public;
grant execute on function public.pay_mission_from_wallet(uuid) to authenticated;
