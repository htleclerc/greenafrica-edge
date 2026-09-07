import { NextRequest, NextResponse } from 'next/server';
import { listAdminPayments, type AdminPaymentFilters } from '@/services/paymentService';
import { requireRole } from '@/lib/auth/requireRole';
import { UserRole } from '@/types/secure';
import { clampStatusesForPaymentsOnly } from '@/lib/auth/paymentsOnly';

const ADMIN_ROLES = [UserRole.SUPERADMIN, UserRole.FINANCE_ADMIN];
const VALID_STATUSES = new Set(['INITIATED', 'PROCESSING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'REFUNDED']);
const VALID_RAILS = new Set(['STRIPE','PAYPAL','WIRE_TRANSFER','CASH','CHEQUE','LETTER_OF_CREDIT','NETTING','THIRD_PARTY','MOBILE_MONEY','BANK_GUARANTEE','WALLET']);

function parseList(raw: string | null, allowed: Set<string>): string[] {
    if (!raw) return [];
    return raw.split(',').map((s) => s.trim()).filter((s) => allowed.has(s));
}

export async function GET(req: NextRequest) {
    const auth = await requireRole(ADMIN_ROLES);
    if (auth.error) return auth.error;

    const url = new URL(req.url);
    const requestedStatuses = parseList(url.searchParams.get('status'), VALID_STATUSES);
    // Encaissements seulement (mig 154) : quoi que demande le client, jamais
    // une déclaration non confirmée — c'est de l'argent non reçu.
    const statuses = auth.user.paymentsOnly ? clampStatusesForPaymentsOnly(requestedStatuses) : requestedStatuses;
    const filters: AdminPaymentFilters = {
        status: statuses as AdminPaymentFilters['status'],
        rail:   parseList(url.searchParams.get('rail'),   VALID_RAILS)    as AdminPaymentFilters['rail'],
        from:   url.searchParams.get('from'),
        to:     url.searchParams.get('to'),
        q:      url.searchParams.get('q'),
    };

    try {
        const payments = await listAdminPayments(auth.supabase, filters);
        return NextResponse.json({ payments });
    } catch {
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
