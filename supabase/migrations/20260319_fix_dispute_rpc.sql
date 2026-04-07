-- Fix function overload ambiguity for resolve_mission_dispute

-- Drop both possible signatures to clear the ambiguity
drop function if exists public.resolve_mission_dispute(text, uuid, text);
drop function if exists public.resolve_mission_dispute(uuid, text, text);

-- Create the definitive version
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
  -- Fetch mission
  select *
    into v_mission
  from public.missions
  where id = p_mission_id
  for update;

  if not found then
    raise exception 'Mission not found';
  end if;

  v_funding := coalesce(v_mission.current_funding, v_mission.amount_target);
  if v_funding is null or v_funding <= 0 then
    raise exception 'Invalid mission funding';
  end if;

  if p_decision = 'approve' then
    -- Escrow Payout Logic
    update public.profiles
      set frozen_balance = coalesce(frozen_balance, 0) - v_funding
    where id = v_mission.creator_id;

    update public.profiles
      set wallet_balance = coalesce(wallet_balance, 0) + v_funding
    where id = v_mission.cleaner_id;

    update public.missions
      set status = 'completed'
    where id = p_mission_id;

    insert into public.transactions (user_id, mission_id, amount, type, gateway)
    values (v_mission.cleaner_id, p_mission_id, v_funding, 'mission_reward', 'internal');

  elsif p_decision = 'reject' then
    -- 3 Strikes Logic
    if coalesce(v_mission.retry_count, 0) < 2 then
      update public.missions
        set status = 'in_progress',
            after_photo_urls = null,
            rejection_reason = p_supervisor_comment,
            retry_count = coalesce(retry_count, 0) + 1
      where id = p_mission_id;
    else
      -- Fired (3 strikes)
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

