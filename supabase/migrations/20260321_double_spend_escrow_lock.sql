-- CRITICAL: Prevent double-spend / duplicate payouts for the same mission.
-- If mission is already paid out (status='completed'), block any further approve calls.

drop function if exists public.resolve_mission_dispute(uuid, text, text);

create or replace function public.resolve_mission_dispute(
  p_mission_id uuid,
  p_decision text,
  p_supervisor_comment text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mission record;
  v_funding numeric;
  v_cleaner_reward numeric;
  v_scout_reward numeric;
  v_creator_frozen numeric;
  v_retry_count integer;
begin
  -- Lock mission row to serialize approve/reject calls.
  select *
    into v_mission
  from public.missions
  where id = p_mission_id
  for update;

  if not found then
    raise exception 'Mission not found';
  end if;

  -- SECURITY GUARD: do not allow payout logic to run again.
  if v_mission.status = 'completed' then
    raise exception 'Security Error: Mission already paid out.';
  end if;

  if lower(coalesce(p_decision, '')) = 'approve' then
    if v_mission.creator_id is null or v_mission.cleaner_id is null then
      raise exception 'Mission requires creator_id and cleaner_id for approve';
    end if;

    v_funding := coalesce(v_mission.current_funding, v_mission.amount_target, 0)::numeric;
    if v_funding <= 0 then
      raise exception 'Invalid mission funding for approve';
    end if;

    v_cleaner_reward := v_funding * 0.90;
    v_scout_reward := v_funding * 0.051;

    select coalesce(frozen_balance, 0)
      into v_creator_frozen
    from public.profiles
    where id = v_mission.creator_id
    for update;

    if v_creator_frozen < v_funding then
      raise exception 'Insufficient creator frozen_balance for escrow payout';
    end if;

    -- Move full escrow out of creator frozen_balance (wallet updates)
    update public.profiles
      set frozen_balance = coalesce(frozen_balance, 0) - v_funding
    where id = v_mission.creator_id;

    update public.profiles
      set wallet_balance = coalesce(wallet_balance, 0) + v_cleaner_reward
    where id = v_mission.cleaner_id;

    update public.profiles
      set wallet_balance = coalesce(wallet_balance, 0) + v_scout_reward
    where id = v_mission.creator_id;

    -- REQUIRED: Immediately mark the mission as completed within the same transaction,
    -- after wallet balances are updated (before transaction inserts).
    update public.missions
      set status = 'completed',
          rejection_reason = null
    where id = p_mission_id;

    -- Record specific rewards (platform keeps remaining 4.9% implicitly)
    insert into public.transactions (user_id, mission_id, amount, type, gateway, created_at)
    values (v_mission.cleaner_id, p_mission_id, v_cleaner_reward, 'mission_reward', 'internal', now());

    insert into public.transactions (user_id, mission_id, amount, type, gateway, created_at)
    values (v_mission.creator_id, p_mission_id, v_scout_reward, 'scout_reward', 'internal', now());

  elsif lower(coalesce(p_decision, '')) = 'reject' then
    -- 3 Strikes logic: payout is not handled here.
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

grant execute on function public.resolve_mission_dispute(uuid, text, text) to authenticated;

