-- Close funding at/above goal, deduct bid from wallet, assign current user as cleaner, move mission to in_progress.
-- Replaces "pending bid only" when (current_funding + bid) >= amount_target.

CREATE OR REPLACE FUNCTION public.complete_funding_and_assign(
  p_mission_id uuid,
  p_bid_amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mission record;
  v_wallet numeric;
  v_frozen numeric;
  v_avail numeric;
  v_target numeric;
  v_funding numeric;
  v_total numeric;
  v_amt numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_amt := round(coalesce(p_bid_amount, 0)::numeric, 2);

  IF v_amt <= 0 THEN
    RAISE EXCEPTION 'Bid amount must be positive';
  END IF;

  SELECT *
  INTO v_mission
  FROM public.missions m
  WHERE m.id = p_mission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF v_mission.creator_id IS NOT NULL AND v_mission.creator_id = v_uid THEN
    RAISE EXCEPTION 'Cannot assign your own mission';
  END IF;

  IF lower(coalesce(v_mission.status::text, '')) = 'completed' THEN
    RAISE EXCEPTION 'Mission already completed';
  END IF;

  IF v_mission.cleaner_id IS NOT NULL AND v_mission.cleaner_id <> v_uid THEN
    RAISE EXCEPTION 'Mission already assigned to another worker';
  END IF;

  v_target := round(coalesce(v_mission.amount_target, 0)::numeric, 2);
  v_funding := round(coalesce(v_mission.current_funding, 0)::numeric, 2);
  v_total := v_funding + v_amt;

  IF v_total + 0.01 < v_target THEN
    RAISE EXCEPTION 'Funding does not reach mission goal; use a pending bid instead';
  END IF;

  SELECT coalesce(wallet_balance, 0), coalesce(frozen_balance, 0)
  INTO v_wallet, v_frozen
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  v_avail := v_wallet - v_frozen;

  IF v_avail + 0.01 < v_amt THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  UPDATE public.profiles
  SET wallet_balance = round((coalesce(wallet_balance, 0) - v_amt)::numeric, 2)
  WHERE id = v_uid;

  UPDATE public.missions
  SET
    current_funding = round((coalesce(current_funding, 0) + v_amt)::numeric, 2),
    cleaner_id = v_uid,
    status = 'in_progress'
  WHERE id = p_mission_id;

  DELETE FROM public.mission_bids
  WHERE mission_id = p_mission_id
    AND lower(coalesce(status::text, '')) = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.complete_funding_and_assign(uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_funding_and_assign(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_funding_and_assign(uuid, numeric) TO service_role;
