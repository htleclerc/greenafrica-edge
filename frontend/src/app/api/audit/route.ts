import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { writeAuditLog } from '@/services/auditService';
import { z } from 'zod';

const auditLogSchema = z.object({
    action: z.string().min(1).max(100),
    entity_type: z.string().min(1).max(50).optional(),
    entity_id: z.string().uuid().optional(),
    severity: z.enum(['info', 'warning', 'error', 'critical']).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
    try {
        const client = await createClient();

        const { data: { user } } = await client.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const parsed = auditLogSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid audit log payload' }, { status: 400 });
        }

        await writeAuditLog(client, {
            ...parsed.data,
            user_id: user.id,
            // TODO(rgpd): juridiction non résolue ici — endpoint générique
            // (client-side telemetry) sans contexte tenant résolu ; appeler
            // getServerJurisdictionId() serait fail-closed (throw) et casserait
            // ce best-effort logger pour tout staff sans cookie switcher actif.
            jurisdiction_id: null,
        });

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
