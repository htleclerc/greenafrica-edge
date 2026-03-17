import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { writeAuditLog } from '@/services/auditService';

export async function POST(request: NextRequest) {
    try {
        const client = await createClient();

        const { data: { user } } = await client.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json() as Record<string, unknown>;

        await writeAuditLog(client, {
            ...body,
            user_id: user.id,
        });

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
