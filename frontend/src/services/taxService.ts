import type { SupabaseClient } from '@supabase/supabase-js';
import type { TaxConfiguration } from '@/types/secure';
import type { TaxConfigurationRow } from '@/types/database';
import { VesselCategory, JurisdictionZone } from '@/types/secure';
import { rowToTaxConfiguration } from '@/types/secure/mappers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any>;

export async function getTaxConfigurations(client: Client): Promise<TaxConfiguration[]> {
    const { data } = await client
        .from('tax_configurations')
        .select('*')
        .order('effective_date', { ascending: false });
    return ((data ?? []) as TaxConfigurationRow[]).map(rowToTaxConfiguration);
}

export async function getActiveTaxRate(
    client: Client,
    zone: JurisdictionZone,
    category: VesselCategory,
): Promise<TaxConfiguration | null> {
    const { data } = await client
        .from('tax_configurations')
        .select('*')
        .eq('jurisdiction_zone', zone)
        .eq('vessel_category', category)
        .eq('status', 'ACTIVE')
        .order('effective_date', { ascending: false })
        .limit(1)
        .single();
    return data ? rowToTaxConfiguration(data as TaxConfigurationRow) : null;
}

export async function createTaxConfiguration(
    client: Client,
    input: Record<string, unknown>,
): Promise<TaxConfiguration | null> {
    const { data } = await client.from('tax_configurations').insert(input).select().single();
    return data ? rowToTaxConfiguration(data as TaxConfigurationRow) : null;
}

export async function updateTaxConfiguration(
    client: Client,
    id: string,
    update: Record<string, unknown>,
): Promise<TaxConfiguration | null> {
    const { data } = await client.from('tax_configurations').update(update).eq('id', id).select().single();
    return data ? rowToTaxConfiguration(data as TaxConfigurationRow) : null;
}
