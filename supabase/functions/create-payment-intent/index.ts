import Stripe from 'npm:stripe@^14.0.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // 1. Сразу обрабатываем CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Проверяем наличие ключа
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) {
      throw new Error("Missing STRIPE_SECRET_KEY in Supabase Secrets!");
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: '2022-11-15',
    });

    // 3. Читаем данные запроса
    const { amount } = await req.json();
    console.log(`Processing payment for amount: ${amount}`);

    // 4. Создаем PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
    });

    console.log("Success: PaymentIntent created!");

    return new Response(JSON.stringify({ clientSecret: paymentIntent.client_secret }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error("CRITICAL ERROR:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});