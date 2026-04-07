-- Dispute resolution + 3-strikes retries for failed verification

alter table public.missions
  add column if not exists retry_count integer not null default 0;

alter table public.missions
  add column if not exists rejection_reason text;

-- Resolve mission dispute / review.
-- p_decision:
-- - 'approve': payout from creator frozen_balance to cleaner wallet_balance, mark completed
-- - 'reject': increment retry_count; if <3 -> back to in_progress + clear after photos + set rejection_reason
--            if >=3 -> fired: back to available + clear cleaner_id/after photos/rejection_reason
create or replace function public.resolve_mission_dispute(
  p_decision text,
  p_mission_id uuid,
  p_supervisor_comment text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_decision text;
  v_creator_id uuid;
  v_cleaner_id uuid;
  v_amount numeric;
  v_retry_count integer;
  v_creator_frozen numeric;
begin
  v_decision := lower(coalesce(p_decision, ''));
  if v_decision not in ('approve', 'reject') then
    raise exception 'Invalid decision: %', p_decision;
  end if;

  -- Lock mission row
  select creator_id,
         cleaner_id,
         coalesce(current_funding, amount_target, 0),
         coalesce(retry_count, 0)
    into v_creator_id, v_cleaner_id, v_amount, v_retry_count
  from public.missions
  where id = p_mission_id
  for update;

  if v_creator_id is null then
    raise exception 'Mission not found';
  end if;

  if v_cleaner_id is null then
    raise exception 'Mission has no cleaner assigned';
  end if;

  if v_amount is null or v_amount <= 0 then
    raise exception 'Invalid mission amount';
  end if;

  if v_decision = 'approve' then
    -- Lock creator + cleaner profiles and move escrow
    select coalesce(frozen_balance, 0)
      into v_creator_frozen
    from public.profiles
    where id = v_creator_id
    for update;

    if v_creator_frozen < v_amount then
      raise exception 'Insufficient creator frozen_balance';
    end if;

    perform 1 from public.profiles where id = v_cleaner_id for update;

    update public.profiles
      set frozen_balance = coalesce(frozen_balance, 0) - v_amount
    where id = v_creator_id;

    update public.profiles
      set wallet_balance = coalesce(wallet_balance, 0) + v_amount
    where id = v_cleaner_id;

    update public.missions
      set status = 'completed',
          rejection_reason = null
    where id = p_mission_id;

    insert into public.transactions (user_id, mission_id, amount, type, gateway)
    values (v_cleaner_id, p_mission_id, v_amount, 'payout', 'internal');

    return;
  end if;

  -- REJECT path: increment retries first
  update public.missions
    set retry_count = coalesce(retry_count, 0) + 1
  where id = p_mission_id
  returning retry_count into v_retry_count;

  if v_retry_count < 3 then
    update public.missions
      set status = 'in_progress',
          after_photo_urls = null,
          rejection_reason = nullif(trim(coalesce(p_supervisor_comment, '')), ''),
          is_disputed = false
    where id = p_mission_id;
  else
    -- Fired: send mission back to marketplace
    update public.missions
      set status = 'available',
          cleaner_id = null,
          after_photo_urls = null,
          rejection_reason = null,
          is_disputed = false
    where id = p_mission_id;
  end if;
end;
$$;

grant execute on function public.resolve_mission_dispute(text, uuid, text) to authenticated;

