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
 * Body (preferred): { mission_id, amount_eur, success_url, cancel_url }
 * Body (mobile-safe shorthand): { missionId } or { mission_id } — success/cancel derived from Origin.
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
      missionId?: unknown;
      amount_eur?: unknown;
      amountEur?: unknown;
      success_url?: unknown;
      successUrl?: unknown;
      cancel_url?: unknown;
      cancelUrl?: unknown;
    };

    const missionId =
      typeof raw.mission_id === 'string'
        ? raw.mission_id.trim()
        : typeof raw.missionId === 'string'
          ? raw.missionId.trim()
          : '';
    if (!missionId) {
      return json(400, { error: 'Missing or invalid mission_id' });
    }

    const origin = req.headers.get('origin') || '';

    const successUrl =
      typeof raw.success_url === 'string'
        ? raw.success_url.trim()
        : typeof raw.successUrl === 'string'
          ? raw.successUrl.trim()
          : origin
            ? `${origin}/?stripe_mission=success&mission_id=${encodeURIComponent(missionId)}`
            : '';
    const cancelUrl =
      typeof raw.cancel_url === 'string'
        ? raw.cancel_url.trim()
        : typeof raw.cancelUrl === 'string'
          ? raw.cancelUrl.trim()
          : origin
            ? `${origin}/?stripe_mission=cancel`
            : '';
    if (!successUrl || !isLikelyHttpUrl(successUrl)) {
      return json(400, { error: 'Missing or invalid success_url' });
    }
    if (!cancelUrl || !isLikelyHttpUrl(cancelUrl)) {
      return json(400, { error: 'Missing or invalid cancel_url' });
    }

    const amountRaw =
      raw.amount_eur ?? raw.amountEur ?? 1;

    const amountEur = Math.floor(Math.max(0, Number(amountRaw)));
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
