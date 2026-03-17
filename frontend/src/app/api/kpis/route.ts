import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getDashboardKpis } from '@/services/kpiService';

export async function GET() {
    try {
        const client = await createClient();

        const { data: { user } } = await client.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const kpis = await getDashboardKpis(client);
        return NextResponse.json(kpis);
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
