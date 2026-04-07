-- CleanMontenegro: Stripe wallet top-ups in EUR (1:1).
-- Never trust client wallet credit; Edge Function verifies Stripe and calls RPC (service_role).

-- ---------------------------------------------------------------------------
-- Public read helper (used by SQL and optionally by PostgREST).
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Stripe wallet credit: called only by Edge Function (service_role).
-- Credits integer EUR, idempotent per PaymentIntent id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_wallet_topup_stripe_eur(
  p_user_id uuid,
  p_eur_charged numeric,
  p_payment_intent_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eur bigint;
  v_existing integer;
  v_ref text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid user';
  END IF;
  IF p_payment_intent_id IS NULL OR length(trim(p_payment_intent_id)) < 3 THEN
    RAISE EXCEPTION 'Invalid payment intent';
  END IF;
  IF p_eur_charged IS NULL OR p_eur_charged <= 0 OR p_eur_charged > 500000 THEN
    RAISE EXCEPTION 'Invalid EUR amount';
  END IF;

  v_ref := 'stripe_pi:' || trim(p_payment_intent_id);

  SELECT t.amount::integer INTO v_existing
  FROM public.transactions t
  WHERE t.user_id = p_user_id
    AND t.type = 'wallet_topup'
    AND t.gateway = 'stripe'
    AND t.payout_details = v_ref
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_eur := floor(p_eur_charged)::bigint;

  IF v_eur <= 0 THEN
    RAISE EXCEPTION 'Computed credit is zero';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  UPDATE public.profiles
  SET wallet_balance = coalesce(wallet_balance, 0) + v_eur
  WHERE id = p_user_id;

  INSERT INTO public.transactions (
    user_id,
    mission_id,
    amount,
    type,
    gateway,
    payout_details
  )
  VALUES (
    p_user_id,
    NULL,
    v_eur,
    'wallet_topup',
    'stripe',
    v_ref
  );

  RETURN v_eur::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_wallet_topup_stripe_eur(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_wallet_topup_stripe_eur(uuid, numeric, text) TO service_role;

COMMENT ON FUNCTION public.credit_wallet_topup_stripe_eur IS 'Edge Function only: credit EUR from verified Stripe charge (1:1).';

-- ---------------------------------------------------------------------------
-- Admin-only manual EGP credit (replaces insecure top_up_wallet for Profile admin UI).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_credit_wallet_eur(p_amount bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_tg text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 100000000 THEN
    RAISE EXCEPTION 'Invalid amount';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  SELECT lower(coalesce(telegram_username, '')) INTO v_tg FROM public.profiles WHERE id = auth.uid();

  IF NOT (
    v_email = 'sgurzheyev@gmail.com'
    OR v_email ILIKE '%tg_6618910143%'
    OR v_tg = 'sergiogurgini'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.profiles
  SET wallet_balance = coalesce(wallet_balance, 0) + p_amount
  WHERE id = auth.uid();

  INSERT INTO public.transactions (user_id, mission_id, amount, type, gateway, payout_details)
  VALUES (auth.uid(), NULL, p_amount, 'wallet_topup', 'admin_manual', 'admin_credit_wallet_eur');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_credit_wallet_eur(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_credit_wallet_eur(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- Remove legacy client-trusted top_up_wallet (if present).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.top_up_wallet(integer);
DROP FUNCTION IF EXISTS public.top_up_wallet(bigint);
DROP FUNCTION IF EXISTS public.top_up_wallet(numeric);
