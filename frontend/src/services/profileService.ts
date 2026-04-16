import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export interface ProfileSummary {
    id: string;
    email: string;
    fullName: string;
    role: string;
    operationalSite: string;
    countryCode: string;
}

/**
 * Fetch a single profile by ID. Used by pro-forma generation to embed
 * the real shipping agent contact info on the invoice.
 */
export async function getProfileById(client: Client, id: string): Promise<ProfileSummary | null> {
    const { data, error } = await client
        .from('profiles')
        .select('id, email, full_name, role, operational_site, country_code')
        .eq('id', id)
        .maybeSingle();

    if (error || !data) return null;

    return {
        id: data.id,
        email: data.email,
        fullName: data.full_name,
        role: data.role,
        operationalSite: data.operational_site,
        countryCode: data.country_code,
    };
}
