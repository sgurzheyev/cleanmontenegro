-- S-Class EGP Payout Logic (Fixed: No multipliers, strict escrow)
DROP FUNCTION IF EXISTS public.resolve_mission_dispute(uuid, text, text, boolean, uuid);

CREATE OR REPLACE FUNCTION public.resolve_mission_dispute(
  p_mission_id uuid,
  p_decision text,
  p_supervisor_comment text,
  p_supervisor_verified boolean default false,
  p_supervisor_user_id uuid default null
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mission record;
  v_funding numeric;
  v_escrow_debit numeric;
  v_cleaner_reward numeric;
  v_scout_reward numeric;
  v_supervisor_reward numeric;
  v_platform_company_half numeric;
  v_debug_note text;
  v_creator_frozen numeric;
  v_retry_count integer;
BEGIN
  -- 1. Блокируем миссию от двойных списаний
  SELECT * INTO v_mission
  FROM public.missions
  WHERE id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Mission not found'; END IF;
  IF v_mission.status = 'completed' THEN RAISE EXCEPTION 'Security Error: Mission already paid out.'; END IF;

  IF lower(coalesce(p_decision, '')) = 'approve' THEN
    IF v_mission.creator_id IS NULL OR v_mission.cleaner_id IS NULL THEN
      RAISE EXCEPTION 'Mission requires creator_id and cleaner_id for approve';
    END IF;

    -- 2. ЖЕСТКИЙ ФИКС БЮДЖЕТА: Берем наибольшее из (собрано донатов ИЛИ изначальная цель). Никаких делений на 100!
    v_funding := greatest(coalesce(v_mission.current_funding, 0), coalesce(v_mission.amount_target, 0))::numeric;

    IF v_funding <= 0 THEN
      RAISE EXCEPTION 'Invalid mission funding for approve: %', v_funding;
    END IF;

    -- Фиксируем целые числа
    v_escrow_debit := floor(v_funding);
    IF v_escrow_debit < 1 THEN v_escrow_debit := 1; END IF;

    -- 3. Чистая математика (90% Воркеру, 5.1% Скауту)
    v_cleaner_reward := floor(v_escrow_debit * 0.90);
    v_scout_reward := floor(v_escrow_debit * 0.051);

    IF coalesce(p_supervisor_verified, false) AND p_supervisor_user_id IS NOT NULL THEN
      v_supervisor_reward := floor(v_escrow_debit * 0.0245);
      v_platform_company_half := floor(v_escrow_debit * 0.0245);
    ELSE
      v_supervisor_reward := 0;
      v_platform_company_half := 0;
    END IF;

    v_debug_note := format('S-CLASS ESCROW: total=%s, cleaner=%s, scout=%s', v_escrow_debit, v_cleaner_reward, v_scout_reward);

    -- 4. Списание замороженных средств (Только если миссия не была профинансирована донатами на 100%)
    IF coalesce(v_mission.current_funding, 0) < v_escrow_debit THEN
      SELECT coalesce(frozen_balance, 0) INTO v_creator_frozen
      FROM public.profiles
      WHERE id = v_mission.creator_id
      FOR UPDATE;

      IF v_creator_frozen < v_escrow_debit THEN
        RAISE EXCEPTION 'Insufficient frozen_balance (%) for payout (%)', v_creator_frozen, v_escrow_debit;
      END IF;

      UPDATE public.profiles
      SET frozen_balance = frozen_balance - v_escrow_debit
      WHERE id = v_mission.creator_id;
    END IF;

    -- 5. Выплата вознаграждений
    UPDATE public.profiles SET wallet_balance = coalesce(wallet_balance, 0) + v_cleaner_reward
    WHERE id = v_mission.cleaner_id;

    UPDATE public.profiles SET wallet_balance = coalesce(wallet_balance, 0) + v_scout_reward
    WHERE id = v_mission.creator_id;

    IF v_supervisor_reward > 0 THEN
      UPDATE public.profiles SET wallet_balance = coalesce(wallet_balance, 0) + v_supervisor_reward
      WHERE id = p_supervisor_user_id;
    END IF;

    -- 6. Закрываем миссию навсегда
    UPDATE public.missions
    SET status = 'completed', rejection_reason = null
    WHERE id = p_mission_id;

    -- 7. Запись в историю транзакций
    INSERT INTO public.transactions (user_id, mission_id, amount, type, gateway, payout_details, created_at)
    VALUES (v_mission.cleaner_id, p_mission_id, v_cleaner_reward, 'worker_reward', 'internal', v_debug_note, now());

    INSERT INTO public.transactions (user_id, mission_id, amount, type, gateway, payout_details, created_at)
    VALUES (v_mission.creator_id, p_mission_id, v_scout_reward, 'scout_reward', 'internal', v_debug_note, now());

  ELSIF lower(coalesce(p_decision, '')) = 'reject' THEN
    UPDATE public.missions SET retry_count = coalesce(retry_count, 0) + 1
    WHERE id = p_mission_id RETURNING retry_count INTO v_retry_count;

    IF coalesce(v_retry_count, 0) < 3 THEN
      UPDATE public.missions
      SET status = 'in_progress', after_photo_urls = null,
          rejection_reason = nullif(trim(coalesce(p_supervisor_comment, '')), '')
      WHERE id = p_mission_id;
    ELSE
      UPDATE public.missions
      SET status = 'available', cleaner_id = null, after_photo_urls = null, rejection_reason = null, retry_count = 0
      WHERE id = p_mission_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid decision: %', p_decision;
  END IF;
END;
$$;