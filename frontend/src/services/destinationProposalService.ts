import { createPlatformClient } from '@/lib/supabase/tenant';

export type DestinationProposal = {
    id: string;
    mmsi: string;
    imo_number: string | null;
    vessel_name: string | null;
    raw_destination: string;
    normalized: string;
    matched_port_guess: string | null;
    fuzzy_score: number;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    created_at: string;
};

export async function listPendingDestinationProposals(): Promise<DestinationProposal[]> {
    // Admin review queue. destination_match_proposals is a global table (not
    // tenant-scoped in the v8 foundation) → UNSCOPED platform client.
    const admin = createPlatformClient();
    const { data, error } = await admin
        .from('destination_match_proposals')
        .select(
            'id, mmsi, imo_number, vessel_name, raw_destination, normalized, matched_port_guess, fuzzy_score, status, created_at',
        )
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
        .limit(100);
    if (error) throw error;
    return data as DestinationProposal[];
}
