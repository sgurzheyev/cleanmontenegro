-- platform_fee_exit (rename from withdrawal_exit_tax), mission_id on ledger, supervisor split rows in ledger

alter table public.platform_revenue_ledger
  add column if not exists mission_id uuid references public.missions(id) on delete set null;

create index if not exists platform_revenue_ledger_mission_id_idx on public.platform_revenue_ledger (mission_id);

update public.platform_revenue_ledger
set source = 'platform_fee_exit'
where source = 'withdrawal_exit_tax';

-- Withdrawal: record 12% as platform_fee_exit
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

  insert into public.platform_revenue_ledger (transaction_id, user_id, mission_id, amount, fee_rate, source, created_at)
  values (v_tx_id, v_uid, null, v_fee, 0.12, 'platform_fee_exit', now());

  return v_tx_id;
end;
$$;

grant execute on function public.process_withdrawal_request(numeric, text, text) to authenticated;

-- Mission payout: Ahmed-Pro split — ledger mirrors company half + supervisor half (4.9% total split 50/50)
drop function if exists public.resolve_mission_dispute(uuid, text, text, boolean, uuid);

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
  v_platform_company_half numeric;
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
      v_supervisor_reward := round(v_funding * 0.0245, 2);
      v_platform_company_half := round(v_funding * 0.0245, 2);
      v_debug_note := format(
        'ESCROW_DEBUG funding_normalized=%s cleaner_reward=%s scout_reward=%s supervisor_bounty=%s platform_company_half=%s raw_current_funding=%s raw_amount_target=%s mission_id=%s supervisor=%s',
        v_funding,
        v_cleaner_reward,
        v_scout_reward,
        v_supervisor_reward,
        v_platform_company_half,
        v_raw_current_funding,
        v_raw_amount_target,
        p_mission_id,
        p_supervisor_user_id
      );
    else
      v_supervisor_reward := 0;
      v_platform_company_half := 0;
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

      insert into public.platform_revenue_ledger (transaction_id, user_id, mission_id, amount, fee_rate, source, created_at)
      values (null, null, p_mission_id, v_platform_company_half, 0.0245, 'platform_fee_mission', now());

      insert into public.platform_revenue_ledger (transaction_id, user_id, mission_id, amount, fee_rate, source, created_at)
      values (null, p_supervisor_user_id, p_mission_id, v_supervisor_reward, 0.0245, 'supervisor_bounty', now());
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
