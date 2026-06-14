// ─────────────────────────────────────────────────────────────────────────────
// GET /api/me/modes — modes enabled for the active jurisdiction + current mode
// ─────────────────────────────────────────────────────────────────────────────
//
// Returns the transport modes enabled for the currently-active jurisdiction and
// the mode the user has selected (from the gg-active-mode cookie). Used by
// ModeSwitcher to decide whether to render a dropdown (>1 enabled) or nothing.
//
// Response:
//   { enabled: ('MARITIME' | 'AIR')[], active: ActiveMode }
//
// RLS note: jurisdiction_mode_config has a public SELECT policy ("anyone reads
// mode config"), so the session client can read it without elevated privileges.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import { getServerActiveMode } from '@/lib/auth/activeMode';

export const dynamic = 'force-dynamic';

export async function GET() {
    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let enabled: ('MARITIME' | 'AIR')[] = [];

    const jurisdictionId = await getServerJurisdictionId().catch(() => null);
    if (jurisdictionId) {
        const { data } = await supabase
            .from('jurisdiction_mode_config')
            .select('mode, enabled')
            .eq('jurisdiction_id', jurisdictionId)
            .eq('enabled', true);
        enabled = (data ?? []).map((r) => r.mode as 'MARITIME' | 'AIR');
    }

    const active = await getServerActiveMode();

    return NextResponse.json({ enabled, active });
}
