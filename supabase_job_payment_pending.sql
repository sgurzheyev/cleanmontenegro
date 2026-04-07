-- Table for linking Paymob orders to job creation.
-- Run in Supabase SQL Editor. Webhook inserts into jobs after successful payment.

CREATE TABLE IF NOT EXISTS job_payment_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paymob_order_id text UNIQUE,
  creator_id uuid NOT NULL,
  task_type text NOT NULL CHECK (task_type IN ('city', 'home')),
  amount numeric NOT NULL,
  location_lat numeric NOT NULL,
  location_lng numeric NOT NULL,
  description text,
  creator_photos text[],
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_payment_pending_paymob ON job_payment_pending(paymob_order_id);

ALTER TABLE job_payment_pending ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON job_payment_pending
  FOR ALL USING (false) WITH CHECK (false);
