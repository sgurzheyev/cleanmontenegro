-- Supervisor 50/50 split of the 4.9% platform fee when Ahmed-Pro verifies.
-- Optional params on resolve_mission_dispute; admin_financial_metrics: supervisor bounties.

drop function if exists public.admin_financial_metrics();

drop function if exists public.resolve_mission_dispute(uuid, text, text);

create or replace function public.resolve_mission_dispute(
  p_mission_id uuid,
  p_decision text,
  p_supervisor_comment text,
  p_supervisor_verified boolean default false,
  p_supervisor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mission record;
  v_funding numeric;
  v_raw_current_funding numeric;
  v_raw_amount_target numeric;
  v_cleaner_reward numeric;
  v_scout_reward numeric;
  v_supervisor_reward numeric;
  v_debug_note text;
  v_creator_frozen numeric;
  v_retry_count integer;
begin
  select *
    into v_mission
  from public.missions
  where id = p_mission_id
  for update;

  if not found then
    raise exception 'Mission not found';
  end if;

  if v_mission.status = 'completed' then
    raise exception 'Security Error: Mission already paid out.';
  end if;

  if lower(coalesce(p_decision, '')) = 'approve' then
    if v_mission.creator_id is null or v_mission.cleaner_id is null then
      raise exception 'Mission requires creator_id and cleaner_id for approve';
    end if;

    v_raw_current_funding := coalesce(v_mission.current_funding, 0)::numeric;
    v_raw_amount_target := coalesce(v_mission.amount_target, 0)::numeric;
    v_funding := coalesce(v_mission.current_funding, v_mission.amount_target, 0)::numeric;

    if v_raw_current_funding > 0 and v_raw_amount_target > 0 then
      if v_raw_current_funding >= (v_raw_amount_target * 10) then
        v_funding := v_raw_current_funding / 100.0;
      elsif v_raw_amount_target >= (v_raw_current_funding * 10) then
        v_funding := v_raw_amount_target / 100.0;
      end if;
    elsif v_funding >= 1000 and v_funding = trunc(v_funding) then
      v_funding := v_funding / 100.0;
    end if;

    if v_funding <= 0 then
      raise exception 'Invalid mission funding for approve';
    end if;

    v_cleaner_reward := v_funding * 0.90;
    v_scout_reward := v_funding * 0.051;

    if coalesce(p_supervisor_verified, false) and p_supervisor_user_id is not null then
      v_supervisor_reward := v_funding * 0.0245;
      v_debug_note := format(
        'ESCROW_DEBUG funding_normalized=%s cleaner_reward=%s scout_reward=%s supervisor_bounty=%s platform_half=0.0245*funding raw_current_funding=%s raw_amount_target=%s mission_id=%s supervisor=%s',
        v_funding,
        v_cleaner_reward,
        v_scout_reward,
        v_supervisor_reward,
        v_raw_current_funding,
        v_raw_amount_target,
        p_mission_id,
        p_supervisor_user_id
      );
    else
      v_supervisor_reward := 0;
      v_debug_note := format(
        'ESCROW_DEBUG funding_normalized=%s cleaner_reward=%s scout_reward=%s platform_fee=%s raw_current_funding=%s raw_amount_target=%s mission_id=%s',
        v_funding,
        v_cleaner_reward,
        v_scout_reward,
        v_funding - v_cleaner_reward - v_scout_reward,
        v_raw_current_funding,
        v_raw_amount_target,
        p_mission_id
      );
    end if;

    select coalesce(frozen_balance, 0)
      into v_creator_frozen
    from public.profiles
    where id = v_mission.creator_id
    for update;

    if v_creator_frozen < v_funding then
      raise exception 'Insufficient creator frozen_balance for escrow payout';
    end if;

    update public.profiles
      set frozen_balance = coalesce(frozen_balance, 0) - v_funding
    where id = v_mission.creator_id;

    update public.profiles
      set wallet_balance = coalesce(wallet_balance, 0) + v_cleaner_reward
    where id = v_mission.cleaner_id;

    update public.profiles
      set wallet_balance = coalesce(wallet_balance, 0) + v_scout_reward
    where id = v_mission.creator_id;

    if coalesce(p_supervisor_verified, false) and p_supervisor_user_id is not null and v_supervisor_reward > 0 then
      update public.profiles
        set wallet_balance = coalesce(wallet_balance, 0) + v_supervisor_reward
      where id = p_supervisor_user_id;
    end if;

    update public.missions
      set status = 'completed',
          rejection_reason = null
    where id = p_mission_id;

    insert into public.transactions (user_id, mission_id, amount, type, gateway, payout_details, created_at)
    values (v_mission.cleaner_id, p_mission_id, v_cleaner_reward, 'mission_reward', 'internal', v_debug_note, now());

    insert into public.transactions (user_id, mission_id, amount, type, gateway, payout_details, created_at)
    values (v_mission.creator_id, p_mission_id, v_scout_reward, 'scout_reward', 'internal', v_debug_note, now());

    if coalesce(p_supervisor_verified, false) and p_supervisor_user_id is not null and v_supervisor_reward > 0 then
      insert into public.transactions (user_id, mission_id, amount, type, gateway, payout_details, created_at)
      values (p_supervisor_user_id, p_mission_id, v_supervisor_reward, 'supervisor_bounty', 'internal', v_debug_note, now());
    end if;

  elsif lower(coalesce(p_decision, '')) = 'reject' then
    update public.missions
      set retry_count = coalesce(retry_count, 0) + 1
    where id = p_mission_id
    returning retry_count into v_retry_count;

    if coalesce(v_retry_count, 0) < 3 then
      update public.missions
        set status = 'in_progress',
            after_photo_urls = null,
            rejection_reason = nullif(trim(coalesce(p_supervisor_comment, '')), ''),
            cleaner_id = coalesce(cleaner_id, v_mission.cleaner_id)
      where id = p_mission_id;
    else
      update public.missions
        set status = 'available',
            cleaner_id = null,
            after_photo_urls = null,
            rejection_reason = null,
            retry_count = 0
      where id = p_mission_id;
    end if;
  else
    raise exception 'Invalid decision: %', p_decision;
  end if;
end;
$$;

grant execute on function public.resolve_mission_dispute(uuid, text, text, boolean, uuid) to authenticated;

-- Keep 3-arg calls working via wrapper is not needed if PostgREST sends named args — clients still pass 3 args.
-- PostgreSQL resolves resolve_mission_dispute(uuid, text, text) to the function with defaults.

create or replace function public.admin_financial_metrics()
returns table (
  total_donated numeric,
  pending_payouts numeric,
  pending_withdrawals numeric,
  supervisor_bounties_total numeric
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
    ), 0) as pending_withdrawals,
    coalesce((
      select sum(t.amount)
      from public.transactions t
      where t.type = 'supervisor_bounty'
    ), 0) as supervisor_bounties_total;
$$;

grant execute on function public.admin_financial_metrics() to authenticated;
