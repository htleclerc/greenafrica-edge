import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@12.6.0?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  apiVersion: '2022-11-15',
  httpClient: Stripe.createFetchHttpClient(),
});

const endpointSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';

serve(async (req) => {
  const signature = req.headers.get('stripe-signature');

  if (!signature) {
    return new Response('No signature', { status: 400 });
  }

  try {
    const body = await req.text();
    const event = stripe.webhooks.constructEvent(body, signature, endpointSecret);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const vesselId = session.metadata.vesselId;

      if (vesselId) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseKey);

        // Update Vessel Compliance Status
        await supabase
          .from('vessels')
          .update({
             compliance_status: 'COMPLIANT',
             tax_liability_usd: 0
           })
          .eq('id', vesselId);

        // Also update any pending transactions for this vessel to PAID
        await supabase
          .from('transactions')
          .update({
              status: 'PAID',
              paid_at: new Date().toISOString()
          })
          .eq('vessel_id', vesselId)
          .eq('status', 'PENDING');
      }
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.log(`Webhook Error: ${err.message}`);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }
});
