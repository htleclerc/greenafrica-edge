import { redirect } from 'next/navigation';

import { requirePrincipal } from '@/lib/auth/requirePrincipal';
import { getServerActiveMode, modeFilter } from '@/lib/auth/activeMode';
import { getVisionCounters } from '@/services/visionService';
import { VisionBoard } from '@/components/dashboard/vision/VisionBoard';

export const dynamic = 'force-dynamic';

export default async function VisionPage() {
    const principal = await requirePrincipal();

    // Only staff may access the vision board.
    if (principal.kind !== 'staff') {
        redirect('/dashboard');
    }

    const mode = await getServerActiveMode();
    const counters = await getVisionCounters(principal.supabase, {
        mode: modeFilter(mode),
    });

    return <VisionBoard counters={counters} mode={mode} />;
}
