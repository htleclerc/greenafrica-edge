import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVesselById, getVesselPositionHistory } from '@/services/vesselService';
import { getTaxConfigurations } from '@/services/taxService';
import { computeFullTaxPipeline } from '@/domain/tax/taxCalculationPipeline';

export async function POST(request: NextRequest) {
    try {
        const client = await createClient();

        // Verify auth
        const { data: { user } } = await client.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { vesselId, since } = body as { vesselId: string; since?: string };

        if (!vesselId) {
            return NextResponse.json({ error: 'vesselId is required' }, { status: 400 });
        }

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

        return NextResponse.json(breakdown);
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
