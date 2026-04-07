-- Internal economy: store wallet/mission amounts in EGP (was USD in app prior to this migration).
-- Conversion factor applied once to existing rows.

DO $$
DECLARE
  r constant numeric := 48.5;
BEGIN
  UPDATE public.profiles
  SET
    wallet_balance = round(coalesce(wallet_balance, 0) * r * 100) / 100,
    frozen_balance = round(coalesce(frozen_balance, 0) * r * 100) / 100
  WHERE true;

  UPDATE public.missions
  SET
    amount_target = round(coalesce(amount_target, 0) * r * 100) / 100,
    current_funding = round(coalesce(current_funding, 0) * r * 100) / 100
  WHERE true;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mission_bids'
  ) THEN
    UPDATE public.mission_bids
    SET bid_amount = round(coalesce(bid_amount, 0) * r * 100) / 100
    WHERE true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'transactions'
  ) THEN
    UPDATE public.transactions
    SET amount = round(coalesce(amount, 0) * r * 100) / 100
    WHERE amount IS NOT NULL;
  END IF;
END $$;

-- Mission bid security: amounts in EGP; home/office > 200 EGP requires max(100, 50% price); street 100 EGP.
-- Home/office also requires cleaner ID verification.
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
  v_shortfall_egp numeric;
  v_avail numeric;
  v_verified boolean;
BEGIN
  IF NEW.cleaner_id IS NULL THEN
    RAISE EXCEPTION 'cleaner_id required';
  END IF;

  SELECT coalesce(p.wallet_balance, 0), coalesce(p.frozen_balance, 0), coalesce(p.is_verified, false)
    INTO v_wallet, v_frozen, v_verified
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

  IF v_cat IN ('home', 'office') AND NOT v_verified THEN
    RAISE EXCEPTION 'ID verification required for home missions';
  END IF;

  IF v_target IS NULL OR v_target <= 0 THEN
    v_required_egp := 100;
  ELSIF v_cat IN ('public', 'street', 'city') THEN
    v_required_egp := 100;
  ELSIF v_cat IN ('home', 'office') AND v_target > 200 THEN
    v_required_egp := greatest(100::numeric, round((v_target * 0.5)::numeric, 2));
  ELSE
    v_required_egp := 100;
  END IF;

  IF v_frozen >= v_required_egp - 0.01 THEN
    RETURN NEW;
  END IF;

  v_shortfall_egp := v_required_egp - v_frozen;
  v_avail := v_wallet - v_frozen;

  IF v_avail < v_shortfall_egp - 0.01 THEN
    RAISE EXCEPTION 'Insufficient funds for security deposit. Please top up your wallet first.';
  END IF;

  RETURN NEW;
END;
$$;
