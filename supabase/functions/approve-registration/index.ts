// ─────────────────────────────────────────────────────────────────────────────
// Edge Function: approve-registration
// Called by admins to approve a registration request.
// Creates the auth.users account + enriches the profile.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
    // CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const { requestId, reviewNote } = await req.json();

        if (!requestId) {
            return new Response(
                JSON.stringify({ error: 'requestId is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Admin client with service role key (can create users)
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        );

        // Verify the caller is an admin
        const authHeader = req.headers.get('Authorization')!;
        const token = authHeader.replace('Bearer ', '');
        const { data: { user: caller } } = await supabaseAdmin.auth.getUser(token);

        if (!caller) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const { data: callerProfile } = await supabaseAdmin
            .from('profiles')
            .select('role')
            .eq('id', caller.id)
            .single();

        if (!callerProfile || !['SUPERADMIN', 'PORT_OFFICER'].includes(callerProfile.role)) {
            return new Response(
                JSON.stringify({ error: 'Insufficient permissions' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Fetch the registration request
        const { data: registration, error: fetchErr } = await supabaseAdmin
            .from('registration_requests')
            .select('*')
            .eq('id', requestId)
            .single();

        if (fetchErr || !registration) {
            return new Response(
                JSON.stringify({ error: 'Registration not found' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        if (registration.status !== 'PENDING' && registration.status !== 'MORE_INFO') {
            return new Response(
                JSON.stringify({ error: `Cannot approve a request with status: ${registration.status}` }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Determine the user_role enum from the requested_role string
        const ROLE_MAP: Record<string, string> = {
            PORT_OFFICER: 'PORT_OFFICER',
            FINANCE_ADMIN: 'FINANCE_ADMIN',
            COMPLIANCE_AUDITOR: 'PORT_OFFICER',
            SUPERADMIN: 'SUPERADMIN',
            FLEET_MANAGER: 'SHIPPING_AGENT',
            FINANCE_CONTACT: 'SHIPPING_AGENT',
            LEGAL_REP: 'SHIPPING_AGENT',
            SHIPPING_AGENT: 'SHIPPING_AGENT',
        };
        const userRole = ROLE_MAP[registration.requested_role] ?? 'PORT_OFFICER';

        // Determine operational site from jurisdiction
        const site = registration.jurisdiction.toLowerCase().includes('berbera')
            ? 'BERBERA_PORT'
            : registration.jurisdiction.toLowerCase().includes('zeila')
                ? 'ZEILA_PORT'
                : 'NATIONAL_HQ';

        // Create the auth user with the stored password hash
        const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
            email: registration.contact_email,
            password: undefined, // We'll set encrypted_password directly
            email_confirm: true,
            user_metadata: {
                full_name: registration.contact_name,
                role: userRole,
                org_name: registration.org_name,
            },
        });

        if (createErr) {
            // If user already exists, try to find them
            if (createErr.message?.includes('already been registered')) {
                return new Response(
                    JSON.stringify({ error: 'Un compte avec cet email existe déjà.' }),
                    { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }
            throw createErr;
        }

        // Update the profile created by the trigger
        if (newUser.user) {
            await supabaseAdmin
                .from('profiles')
                .update({
                    full_name: registration.contact_name,
                    role: userRole,
                    operational_site: site,
                    country_code: 'SO',
                    timezone: 'Africa/Mogadishu',
                    preferred_language: 'en',
                    ip_address: registration.ip_address,
                })
                .eq('id', newUser.user.id);
        }

        // Mark registration as approved
        await supabaseAdmin
            .from('registration_requests')
            .update({
                status: 'APPROVED',
                reviewed_by: caller.id,
                reviewed_at: new Date().toISOString(),
                review_note: reviewNote || 'Dossier approuvé. Compte créé et actif.',
            })
            .eq('id', requestId);

        return new Response(
            JSON.stringify({
                success: true,
                userId: newUser.user?.id,
                email: registration.contact_email,
                role: userRole,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (err) {
        return new Response(
            JSON.stringify({ error: (err as Error).message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
