-- Fix reject flow in resolve_mission_dispute:
-- do NOT require mission funding for reject; funding checks apply only to approve.

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
begin
  select *
    into v_mission
  from public.missions
  where id = p_mission_id
  for update;

  if not found then
    raise exception 'Mission not found';
  end if;

  if p_decision = 'approve' then
    v_funding := coalesce(v_mission.current_funding, v_mission.amount_target, 0);
    if v_funding <= 0 then
      raise exception 'Invalid mission funding for approve';
    end if;

    update public.profiles
      set frozen_balance = coalesce(frozen_balance, 0) - v_funding
    where id = v_mission.creator_id;

    update public.profiles
      set wallet_balance = coalesce(wallet_balance, 0) + v_funding
    where id = v_mission.cleaner_id;

    update public.missions
      set status = 'completed',
          rejection_reason = null
    where id = p_mission_id;

    insert into public.transactions (user_id, mission_id, amount, type, gateway)
    values (v_mission.cleaner_id, p_mission_id, v_funding, 'mission_reward', 'internal');

  elsif p_decision = 'reject' then
    -- No payout, no funding requirement here.
    -- Keep escrow/funding intact while retries are allowed.
    if coalesce(v_mission.retry_count, 0) < 2 then
      update public.missions
        set status = 'in_progress',
            after_photo_urls = null,
            rejection_reason = nullif(trim(coalesce(p_supervisor_comment, '')), ''),
            retry_count = coalesce(retry_count, 0) + 1
      where id = p_mission_id;
    else
      -- Fired (3 strikes): return mission to market.
      -- Funding remains with mission flow (no cleaner payout).
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

