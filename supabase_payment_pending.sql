-- Таблица для связи Paymob-заказа с депозитом рабочего (worker_deposit).
-- Выполни в Supabase SQL Editor, чтобы вебхук мог проставлять worker_id после оплаты депозита.

CREATE TABLE IF NOT EXISTS payment_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paymob_order_id text NOT NULL UNIQUE,
  pyramid_id uuid NOT NULL REFERENCES pyramids(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'worker_deposit',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_pending_paymob_order_id ON payment_pending(paymob_order_id);

-- RLS (опционально): разрешить только service role записывать/читать.
ALTER TABLE payment_pending ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON payment_pending
  FOR ALL USING (false) WITH CHECK (false);

-- Если используешь только service role из API — политика выше запрещает клиентский доступ.
-- Серверный Supabase client с service_role_key обходит RLS.
