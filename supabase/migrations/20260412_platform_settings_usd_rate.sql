-- Singleton platform settings (USD → EGP for Stripe / wallet conversion display).
-- Default row: 55 EGP per 1 USD (adjust via Admin Dashboard).

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  usd_to_egp_rate numeric NOT NULL CHECK (usd_to_egp_rate > 0 AND usd_to_egp_rate <= 1000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_settings (id, usd_to_egp_rate, updated_at)
VALUES (1, 55, now())
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_settings_select_all" ON public.platform_settings;

CREATE POLICY "platform_settings_select_all"
ON public.platform_settings
FOR SELECT
USING (true);

GRANT SELECT ON public.platform_settings TO anon, authenticated;

COMMENT ON TABLE public.platform_settings IS 'Platform-wide settings; row id=1 only.';

-- Admins update via RPC (matches AdminDashboard client-side admin checks).
CREATE OR REPLACE FUNCTION public.set_usd_to_egp_rate(p_rate numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_tg text;
BEGIN
  IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 1000 THEN
    RAISE EXCEPTION 'Invalid rate';
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

  UPDATE public.platform_settings
  SET usd_to_egp_rate = p_rate, updated_at = now()
  WHERE id = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.set_usd_to_egp_rate(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_usd_to_egp_rate(numeric) TO authenticated;
