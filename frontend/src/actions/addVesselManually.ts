'use server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceRole } from '@supabase/supabase-js';

// Manual vessel entry: armateurs register a vessel they own (e.g. before AIS
// detection); staff can register on behalf without an owner. Auth role decides
// whether the new row gets an owner_id and which compliance_status it lands in.
//
// Optional fields (engine_power_kw, design_speed_knots) carry sane defaults so
// the form stays short — values can be refined later via the detail drawer.

const inputSchema = z.object({
    imoNumber: z.string().regex(/^\d{7}$/, 'IMO must be exactly 7 digits'),
    mmsi:      z.string().regex(/^\d{9}$/, 'MMSI must be exactly 9 digits'),
    name:      z.string().trim().min(1, 'Name is required').max(120),
    callSign:  z.string().trim().min(1, 'Call sign is required').max(16),
    flagCode:  z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Flag must be a 2-letter ISO code'),
    category:  z.enum(['CONTAINER', 'CARGO', 'TANKER', 'BULK_CARRIER', 'FERRY', 'NAVAL', 'SCIENTIFIC']),
    grossTonnageDwt: z.number().int().positive().max(1_000_000),
});

export type AddVesselInput = z.input<typeof inputSchema>;

export async function addVesselManually(
    raw: unknown,
): Promise<{ ok: true; vesselId: string } | { ok: false; reason: string }> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) {
        return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    }
    const v = parsed.data;

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile) return { ok: false, reason: 'profile not found' };

    const isArmateur = profile.role === 'SHIPPING_AGENT';
    const isStaff = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN', 'MANAGER'].includes(profile.role);
    if (!isArmateur && !isStaff) {
        return { ok: false, reason: 'role not allowed to register vessels' };
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        return { ok: false, reason: 'supabase service role not configured' };
    }
    const admin = createServiceRole(supabaseUrl, serviceKey, {
        auth: { persistSession: false },
    });

    const { data: existing } = await admin
        .from('vessels')
        .select('id, owner_id')
        .eq('imo_number', v.imoNumber)
        .maybeSingle();
    if (existing) {
        return { ok: false, reason: `vessel with IMO ${v.imoNumber} already exists` };
    }

    const { data: inserted, error } = await admin
        .from('vessels')
        .insert({
            imo_number: v.imoNumber,
            mmsi: v.mmsi,
            name: v.name,
            call_sign: v.callSign,
            flag_code: v.flagCode,
            category: v.category,
            gross_tonnage_dwt: v.grossTonnageDwt,
            engine_power_kw: Math.max(2000, Math.round(v.grossTonnageDwt * 0.35)),
            design_speed_knots: 14.0,
            compliance_status: 'APPROACHING',
            owner_id: isArmateur ? auth.user.id : null,
            pro_forma_generated: false,
        })
        .select('id')
        .single();

    if (error || !inserted) {
        return { ok: false, reason: error?.message ?? 'insert failed' };
    }
    return { ok: true, vesselId: inserted.id };
}
