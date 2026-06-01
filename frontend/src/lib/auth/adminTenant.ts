/**
 * Admin-entity jurisdiction gate for GreenGate v8.
 *
 * Admin money actions (executeRefund, approveRefund, adjustWalletManually, …) operate on
 * a specific target entity (a refund, a wallet, a payment) that carries a jurisdiction_id.
 * This decides whether the acting admin may act on that entity and returns the jurisdiction
 * to scope the write with (always the ENTITY's jurisdiction, so the stamp is correct):
 *
 *   • SUPERADMIN (Solide central): may act on any jurisdiction → returns the entity's.
 *   • Any other admin (FINANCE_ADMIN, …): confined to their own jurisdiction. Acting on an
 *     entity in another jurisdiction throws (staff isolation).
 *
 * Usage:
 *   const platform = createPlatformClient();
 *   const refund = await getRefundById(platform, id);          // find regardless of tenant
 *   const jid = await assertAdminCanActOn(auth.user, refund.jurisdiction_id);
 *   const admin = createTenantClient(jid);                     // scoped + correct stamp
 */
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import { UserRole, type SecureUser } from '@/types/secure';

export async function assertAdminCanActOn(
    user: SecureUser,
    entityJurisdictionId: string,
): Promise<string> {
    if (user.role === UserRole.SUPERADMIN) {
        return entityJurisdictionId;
    }
    const adminJurisdictionId = await getServerJurisdictionId();
    if (adminJurisdictionId !== entityJurisdictionId) {
        throw new Error('forbidden: target entity belongs to another jurisdiction');
    }
    return entityJurisdictionId;
}
