import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@12.6.0?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2022-11-15',
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { vesselId, amountUsd } = await req.json();
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Validate the vessel exists
    const { data: vessel, error } = await supabase
      .from('vessels')
      .select('name, imo_number, tax_liability_usd')
      .eq('id', vesselId)
      .single();

    if (error || !vessel) throw new Error('Vessel not found');

    // Create a checkout session
    const sessionUrl = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Carbon Tax Clearance: ${vessel.name}`,
              description: `IMO: ${vessel.imo_number} - Somaliland EEZ Transit`,
            },
            unit_amount: Math.round(amountUsd * 100), // convert to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${Deno.env.get('PUBLIC_SITE_URL') || 'http://localhost:3300'}/dashboard/vessels?payment=success`,
      cancel_url: `${Deno.env.get('PUBLIC_SITE_URL') || 'http://localhost:3300'}/dashboard/vessels?payment=cancel`,
      metadata: {
        vesselId,
      },
    });

    return new Response(JSON.stringify({ url: sessionUrl.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
