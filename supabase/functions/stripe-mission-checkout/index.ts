import Stripe from 'https://esm.sh/stripe@14.23.0';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Max-Age': '86400',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isLikelyHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Creates a Stripe Checkout Session for city mission (Scout Stake) payment.
 * Body: { mission_id, amount_eur, success_url, cancel_url }
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      throw new Error('Missing STRIPE_SECRET_KEY in Supabase Secrets');
    }

    const raw = (await req.json()) as {
      mission_id?: unknown;
      amount_eur?: unknown;
      success_url?: unknown;
      cancel_url?: unknown;
    };

    const missionId = typeof raw.mission_id === 'string' ? raw.mission_id.trim() : '';
    if (!missionId) {
      return json(400, { error: 'Missing or invalid mission_id' });
    }

    const successUrl =
      typeof raw.success_url === 'string' ? raw.success_url.trim() : '';
    const cancelUrl = typeof raw.cancel_url === 'string' ? raw.cancel_url.trim() : '';
    if (!successUrl || !isLikelyHttpUrl(successUrl)) {
      return json(400, { error: 'Missing or invalid success_url' });
    }
    if (!cancelUrl || !isLikelyHttpUrl(cancelUrl)) {
      return json(400, { error: 'Missing or invalid cancel_url' });
    }

    if (raw.amount_eur === undefined || raw.amount_eur === null) {
      return json(400, { error: 'Missing amount_eur' });
    }

    const amountEur = Math.floor(
      Math.max(0, Number(raw.amount_eur)),
    );
    if (!Number.isFinite(amountEur) || amountEur <= 0) {
      return json(400, { error: 'Invalid amount_eur' });
    }

    /** Stripe amounts are in smallest currency unit (EUR → cents). */
    const unitAmountCents = amountEur * 100;
    if (unitAmountCents < 50) {
      return json(400, { error: 'Amount must be at least €0.50' });
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2022-11-15',
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        mission_id: missionId,
      },
      payment_intent_data: {
        metadata: {
          mission_id: missionId,
        },
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: unitAmountCents,
            product_data: {
              name: 'Clean Montenegro - Mission Funding',
            },
          },
        },
      ],
    });

    const url = session.url;
    if (!url) {
      throw new Error('Checkout Session did not return a redirect URL');
    }

    return json(200, { url });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('stripe-mission-checkout error:', message);
    return json(400, { error: message });
  }
});
