import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { sendPartnershipConfirmationEmail } from '@/services/emailService';

const partnershipSchema = z.object({
    partnershipType: z.enum([
        'sovereign_deployment',
        'port_authority',
        'carbon_credits',
        'technology',
        'institutional',
    ]),
    orgName: z.string().min(2).max(200),
    country: z.string().min(2).max(100),
    contactName: z.string().min(2).max(100),
    contactEmail: z.email(),
    contactRole: z.string().max(100).optional().default(''),
    message: z.string().min(10).max(5000),
});

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const parsed = partnershipSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
        }

        const adminClient = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
        );

        const { data: inserted, error } = await adminClient
            .from('partnership_requests')
            .insert({
                partnership_type: parsed.data.partnershipType,
                org_name: parsed.data.orgName,
                country: parsed.data.country,
                contact_name: parsed.data.contactName,
                contact_email: parsed.data.contactEmail,
                contact_role: parsed.data.contactRole,
                message: parsed.data.message,
            })
            .select('id')
            .single();

        if (error) {
            // Table might not exist yet — log but don't fail for the user
            console.error('[Partnership] DB insert failed:', error.message);
        }

        // Send confirmation email to the requester (best-effort)
        const requestId = inserted?.id ? `PR-${inserted.id.toString().slice(0, 8).toUpperCase()}` : 'PR-PENDING';
        const emailResult = await sendPartnershipConfirmationEmail({
            to: parsed.data.contactEmail,
            contactName: parsed.data.contactName,
            organizationName: parsed.data.orgName,
            partnershipType: parsed.data.partnershipType,
            requestId,
        });

        if (!emailResult.success) {
            console.error('[Partnership] Email failed:', emailResult.error);
        }

        return NextResponse.json({ success: true, requestId, email: emailResult });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
