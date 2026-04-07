-- Enforce wallet vs trust deposit when inserting mission_bids (mirrors app logic in trustDeposit.ts)

CREATE OR REPLACE FUNCTION public.enforce_mission_bid_security_deposit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet numeric;
  v_frozen numeric;
  v_cat text;
  v_target numeric;
  v_required_egp numeric;
  v_rate constant numeric := 47.5;
  v_frozen_egp numeric;
  v_shortfall_egp numeric;
  v_shortfall_usd numeric;
  v_avail numeric;
BEGIN
  IF NEW.cleaner_id IS NULL THEN
    RAISE EXCEPTION 'cleaner_id required';
  END IF;

  SELECT coalesce(p.wallet_balance, 0), coalesce(p.frozen_balance, 0)
    INTO v_wallet, v_frozen
  FROM public.profiles p
  WHERE p.id = NEW.cleaner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF v_frozen > v_wallet + 0.01 THEN
    RAISE EXCEPTION 'Invalid balance: frozen deposit exceeds wallet';
  END IF;

  SELECT lower(coalesce(m.category::text, '')), coalesce(m.amount_target, 0)
    INTO v_cat, v_target
  FROM public.missions m
  WHERE m.id = NEW.mission_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mission not found';
  END IF;

  IF v_target IS NULL OR v_target <= 0 THEN
    v_required_egp := 100;
  ELSIF v_cat IN ('public', 'street', 'city') THEN
    v_required_egp := 100;
  ELSIF v_target > 4 THEN
    v_required_egp := greatest(100::numeric, round((v_target * 0.5 * v_rate)::numeric, 2));
  ELSE
    v_required_egp := 100;
  END IF;

  v_frozen_egp := v_frozen * v_rate;

  IF v_frozen_egp >= v_required_egp - 0.01 THEN
    RETURN NEW;
  END IF;

  v_shortfall_egp := v_required_egp - v_frozen_egp;
  v_shortfall_usd := v_shortfall_egp / v_rate;
  v_avail := v_wallet - v_frozen;

  IF v_avail < v_shortfall_usd - 0.01 THEN
    RAISE EXCEPTION 'Insufficient funds for security deposit. Please top up your wallet first.';
  END IF;

  RETURN NEW;
END;
$$;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'mission_bids'
  ) THEN
    DROP TRIGGER IF EXISTS trg_mission_bid_security_deposit ON public.mission_bids;
    CREATE TRIGGER trg_mission_bid_security_deposit
      BEFORE INSERT ON public.mission_bids
      FOR EACH ROW
      EXECUTE PROCEDURE public.enforce_mission_bid_security_deposit();
  END IF;
END
$migration$;
