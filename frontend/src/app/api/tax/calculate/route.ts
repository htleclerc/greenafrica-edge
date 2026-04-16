import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVesselById, getVesselPositionHistory } from '@/services/vesselService';
import { getTaxConfigurations } from '@/services/taxService';
import { computeFullTaxPipeline } from '@/domain/tax/taxCalculationPipeline';
import { writeAuditLog } from '@/services/auditService';
import { z } from 'zod';

const taxCalcSchema = z.object({
    vesselId: z.string().uuid(),
    since: z.string().datetime().optional(),
});

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

export async function POST(request: NextRequest) {
    try {
        const client = await createClient();

        const { data: { user } } = await client.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // RBAC check
        const { data: profile } = await client
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (!profile || !ALLOWED_ROLES.includes(profile.role)) {
            return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
        }

        // Validate input
        const body = await request.json();
        const parsed = taxCalcSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
        }

        const { vesselId, since } = parsed.data;

        // Fetch vessel data
        const vessel = await getVesselById(client, vesselId);
        if (!vessel) {
            return NextResponse.json({ error: 'Vessel not found' }, { status: 404 });
        }

        // Fetch position history (default: last 30 days)
        const sinceDate = since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const positions = await getVesselPositionHistory(client, vesselId, sinceDate);

        // Fetch active tax configurations
        const taxConfigs = await getTaxConfigurations(client);
        const activeConfigs = taxConfigs.filter((tc) => tc.status === 'ACTIVE');

        // Run the full calculation pipeline
        const breakdown = computeFullTaxPipeline(positions, vessel, activeConfigs);

        // Audit log
        await writeAuditLog(client, {
            action: 'TAX_CALCULATED',
            entity_type: 'vessel',
            entity_id: vesselId,
            user_id: user.id,
            severity: 'info',
            details: {
                vessel_name: vessel.name,
                total_tax_usd: breakdown.totalTaxUsd,
                positions_analyzed: positions.length,
            },
        });

        return NextResponse.json(breakdown);
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
