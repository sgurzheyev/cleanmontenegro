import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^14.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Creates a Stripe PaymentIntent for wallet top-up.
 * Accepts integer EUR only; charges EUR directly (1:1) and credits EUR server-side.
 * Client must not send trusted final wallet credit.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      throw new Error('Missing STRIPE_SECRET_KEY in Supabase Secrets');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceKey) {
      throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as { amount_eur?: unknown; user_id?: unknown };
    const userId = typeof body.user_id === 'string' ? body.user_id : '';
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing user_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.amount_eur === undefined || body.amount_eur === null) {
      return new Response(JSON.stringify({ error: 'Missing amount_eur' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await supabaseUser.auth.getUser();
    if (userErr || !user || user.id !== userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rawEur = Number(body.amount_eur);
    const amountEur = Math.floor(Math.max(0, rawEur));
    if (!Number.isFinite(amountEur) || amountEur <= 0) {
      return new Response(JSON.stringify({ error: 'Invalid amount_eur' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (amountEur > 250_000) {
      return new Response(JSON.stringify({ error: 'Amount too large' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const cents = amountEur * 100;
    if (cents < 50) {
      return new Response(JSON.stringify({ error: 'Minimum charge is €0.50' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2022-11-15',
    });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: cents,
      currency: 'eur',
      metadata: {
        user_id: userId,
        purpose: 'wallet_top_up',
        amount_eur_intent: String(amountEur),
      },
      automatic_payment_methods: { enabled: true },
    });

    return new Response(
      JSON.stringify({ clientSecret: paymentIntent.client_secret }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('stripe-intent error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    );
  }
});
