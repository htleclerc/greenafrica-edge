// ─────────────────────────────────────────────────────────────────────────────
// Equasis proposals — admin-side read helpers
// ─────────────────────────────────────────────────────────────────────────────
//
// Reads equasis_scrape_proposals joined with vessel and current shipowner
// state so the review UI can show the diff at apply time.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js';

export type ProposalSource = 'manual' | 'fixture' | 'scraper';

export interface EquasisProposal {
    id: string;
    imo_number: string;
    shipowner_id: string | null;
    proposed_owner_name: string | null;
    proposed_manager: string | null;
    proposed_email: string | null;
    proposed_country: string | null;
    source: ProposalSource;
    scraped_at: string;
    applied: boolean;
    reviewed_at: string | null;
    reviewed_by: string | null;
    rejected_reason: string | null;
    /** Snapshot of the linked shipowner so the UI can render a diff at review time. */
    shipowner: {
        id: string;
        name: string;
        country_code: string | null;
        official_email: string | null;
        official_email_source: string | null;
        account_state: string;
    } | null;
}

export async function listPendingProposals(db: SupabaseClient): Promise<EquasisProposal[]> {
    const { data, error } = await db
        .from('equasis_scrape_proposals')
        .select(
            `id, imo_number, shipowner_id, proposed_owner_name, proposed_manager,
             proposed_email, proposed_country, source, scraped_at,
             applied, reviewed_at, reviewed_by, rejected_reason,
             shipowner:shipowners (id, name, country_code, official_email, official_email_source, account_state)`,
        )
        .is('reviewed_at', null)
        .order('scraped_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as unknown as EquasisProposal[];
}

export async function listResolvedProposals(
    db: SupabaseClient,
    daysWindow: number = 30,
): Promise<EquasisProposal[]> {
    const cutoff = new Date(Date.now() - daysWindow * 24 * 3600 * 1000).toISOString();
    const { data, error } = await db
        .from('equasis_scrape_proposals')
        .select(
            `id, imo_number, shipowner_id, proposed_owner_name, proposed_manager,
             proposed_email, proposed_country, source, scraped_at,
             applied, reviewed_at, reviewed_by, rejected_reason,
             shipowner:shipowners (id, name, country_code, official_email, official_email_source, account_state)`,
        )
        .not('reviewed_at', 'is', null)
        .gte('reviewed_at', cutoff)
        .order('reviewed_at', { ascending: false })
        .limit(50);
    if (error) throw error;
    return (data ?? []) as unknown as EquasisProposal[];
}
