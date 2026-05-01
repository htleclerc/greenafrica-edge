// ─────────────────────────────────────────────────────────────────────────────
// Tests for submitKycC action: KYC Level C submission, validation, and audit logging.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth/requireOwner', () => ({
    requireOwner: vi.fn(async () => ({
        userId: 'u-1',
        email: 'owner@test.com',
        shipowner: { id: 'so-1', name: 'Test Owner', account_state: 'ACTIVE' },
        supabase: {},
    })),
}));

vi.mock('@/services/kycService', () => ({
    encryptIban: vi.fn(async (s: string) => `enc:${s}`),
    isInsecureStrategy: vi.fn(() => false),
}));

const mockShipownersChain = {
    eq: vi.fn(async () => ({ error: null })),
};

const mockShipownersTable = {
    update: vi.fn(() => mockShipownersChain),
};

const mockAuditLogsTable = {
    insert: vi.fn(async () => ({ error: null })),
};

const mockSupabase = {
    from: vi.fn((table: string) => {
        if (table === 'shipowners') return mockShipownersTable;
        if (table === 'audit_logs') return mockAuditLogsTable;
        return {};
    }),
};

vi.mock('@supabase/supabase-js', () => ({
    createClient: vi.fn(() => mockSupabase),
}));

beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
});

const validInput = {
    billing_legal_name: 'Test Co',
    billing_address_line1: '1 Quay Rd',
    billing_city: 'Berbera',
    billing_postal_code: '01001',
    billing_country_code: 'SO',
    iban: 'GB82WEST12345698765432',
    swift_bic: 'BARCGB22',
    bank_name: 'Barclays',
    cgv_accepted: true as const,
};

describe('submitKycC', () => {
    describe('validation', () => {
        it('rejects when billing_legal_name is too short', async () => {
            const { submitKycC } = await import('./submitKycC');
            await expect(
                submitKycC({ ...validInput, billing_legal_name: 'A' }),
            ).rejects.toThrow();
        });

        it('rejects when address line 1 is too short', async () => {
            const { submitKycC } = await import('./submitKycC');
            await expect(
                submitKycC({ ...validInput, billing_address_line1: 'X' }),
            ).rejects.toThrow();
        });

        it('rejects when city is too short', async () => {
            const { submitKycC } = await import('./submitKycC');
            await expect(
                submitKycC({ ...validInput, billing_city: 'X' }),
            ).rejects.toThrow();
        });

        it('rejects when postal code is too short', async () => {
            const { submitKycC } = await import('./submitKycC');
            await expect(
                submitKycC({ ...validInput, billing_postal_code: '1' }),
            ).rejects.toThrow();
        });

        it('rejects when country code is not exactly 2 chars', async () => {
            const { submitKycC } = await import('./submitKycC');
            await expect(
                submitKycC({ ...validInput, billing_country_code: 'USA' }),
            ).rejects.toThrow();
        });

        it('rejects when IBAN format is invalid', async () => {
            const { submitKycC } = await import('./submitKycC');
            await expect(
                submitKycC({ ...validInput, iban: 'short' }),
            ).rejects.toThrow();
        });

        it('rejects when IBAN has lowercase letters', async () => {
            const { submitKycC } = await import('./submitKycC');
            await expect(
                submitKycC({ ...validInput, iban: 'gb82west12345698765432' }),
            ).rejects.toThrow();
        });

        it('rejects when SWIFT/BIC is too short', async () => {
            const { submitKycC } = await import('./submitKycC');
            await expect(
                submitKycC({ ...validInput, swift_bic: 'BARC' }),
            ).rejects.toThrow();
        });

        it('rejects when SWIFT/BIC has lowercase letters', async () => {
            const { submitKycC } = await import('./submitKycC');
            await expect(
                submitKycC({ ...validInput, swift_bic: 'barcgb22' }),
            ).rejects.toThrow();
        });

        it('rejects when bank name is too short', async () => {
            const { submitKycC } = await import('./submitKycC');
            await expect(
                submitKycC({ ...validInput, bank_name: 'B' }),
            ).rejects.toThrow();
        });

        it('rejects when cgv_accepted is not literal true', async () => {
            const { submitKycC } = await import('./submitKycC');
            // @ts-expect-error Testing invalid input
            await expect(submitKycC({ ...validInput, cgv_accepted: false })).rejects.toThrow();
        });
    });

    describe('encryption', () => {
        it('encrypts IBAN before persisting', async () => {
            const { submitKycC } = await import('./submitKycC');
            const { encryptIban } = await import('@/services/kycService');

            await submitKycC(validInput);

            expect(encryptIban).toHaveBeenCalledWith('GB82WEST12345698765432');
        });

        it('passes encrypted IBAN to database', async () => {
            const { submitKycC } = await import('./submitKycC');

            await submitKycC(validInput);

            expect(mockShipownersTable.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    iban: 'enc:GB82WEST12345698765432',
                }),
            );
        });
    });

    describe('persistence', () => {
        it('updates shipowner with all KYC Level C fields', async () => {
            const { submitKycC } = await import('./submitKycC');

            await submitKycC(validInput);

            expect(mockShipownersTable.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    billing_legal_name: 'Test Co',
                    billing_address_line1: '1 Quay Rd',
                    billing_city: 'Berbera',
                    billing_postal_code: '01001',
                    billing_country_code: 'SO',
                    swift_bic: 'BARCGB22',
                    bank_name: 'Barclays',
                    iban: 'enc:GB82WEST12345698765432',
                }),
            );
        });

        it('sets kyc_level_c_completed_at to current time', async () => {
            const { submitKycC } = await import('./submitKycC');

            await submitKycC(validInput);

            const call = mockShipownersTable.update.mock.calls[0][0];
            expect(call.kyc_level_c_completed_at).toBeTruthy();
            expect(new Date(call.kyc_level_c_completed_at).getTime()).toBeLessThanOrEqual(
                Date.now(),
            );
        });

        it('filters to correct shipowner by ID', async () => {
            const { submitKycC } = await import('./submitKycC');

            await submitKycC(validInput);

            expect(mockShipownersChain.eq).toHaveBeenCalledWith('id', 'so-1');
        });

        it('sets address line 2 to null when not provided', async () => {
            const { submitKycC } = await import('./submitKycC');

            await submitKycC(validInput);

            expect(mockShipownersTable.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    billing_address_line2: null,
                }),
            );
        });

        it('includes address line 2 when provided', async () => {
            const { submitKycC } = await import('./submitKycC');

            await submitKycC({ ...validInput, billing_address_line2: 'Apt 2' });

            expect(mockShipownersTable.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    billing_address_line2: 'Apt 2',
                }),
            );
        });

        it('sets vat_number to null when not provided', async () => {
            const { submitKycC } = await import('./submitKycC');

            await submitKycC(validInput);

            expect(mockShipownersTable.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    vat_number: null,
                }),
            );
        });

        it('includes vat_number when provided', async () => {
            const { submitKycC } = await import('./submitKycC');

            await submitKycC({ ...validInput, vat_number: 'SO1234567' });

            expect(mockShipownersTable.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    vat_number: 'SO1234567',
                }),
            );
        });
    });

    describe('audit logging', () => {
        it('logs SHIPOWNER_KYC_C_COMPLETED event', async () => {
            const { submitKycC } = await import('./submitKycC');

            await submitKycC(validInput);

            expect(mockAuditLogsTable.insert).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'TRANSACTION_UPDATED',
                    severity: 'INFO',
                    entity_type: 'Shipowner',
                    entity_id: 'so-1',
                    details_json: expect.objectContaining({
                        event: 'SHIPOWNER_KYC_C_COMPLETED',
                    }),
                }),
            );
        });

        it('flags insecure encryption in audit log when applicable', async () => {
            const { submitKycC } = await import('./submitKycC');
            const { isInsecureStrategy } = await import('@/services/kycService');

            (isInsecureStrategy as any).mockReturnValue(true);

            await submitKycC(validInput);

            expect(mockAuditLogsTable.insert).toHaveBeenCalledWith(
                expect.objectContaining({
                    details_json: expect.objectContaining({
                        iban_encryption: 'INSECURE_DEBT',
                    }),
                }),
            );
        });

        it('flags encrypted IBAN in audit log when vault is used', async () => {
            const { submitKycC } = await import('./submitKycC');
            const { isInsecureStrategy } = await import('@/services/kycService');

            (isInsecureStrategy as any).mockReturnValue(false);

            await submitKycC(validInput);

            expect(mockAuditLogsTable.insert).toHaveBeenCalledWith(
                expect.objectContaining({
                    details_json: expect.objectContaining({
                        iban_encryption: 'ENCRYPTED',
                    }),
                }),
            );
        });

        it('records current user info in audit log', async () => {
            const { submitKycC } = await import('./submitKycC');

            await submitKycC(validInput);

            expect(mockAuditLogsTable.insert).toHaveBeenCalledWith(
                expect.objectContaining({
                    user_id: 'u-1',
                    user_full_name: 'Test Owner',
                }),
            );
        });

        it('records cgv acceptance timestamp in audit log', async () => {
            const { submitKycC } = await import('./submitKycC');

            await submitKycC(validInput);

            const call = mockAuditLogsTable.insert.mock.calls[0][0];
            expect(call.details_json.cgv_accepted_at).toBeTruthy();
            expect(new Date(call.details_json.cgv_accepted_at).getTime()).toBeLessThanOrEqual(
                Date.now(),
            );
        });
    });

    describe('happy path', () => {
        it('returns ok: true on successful submission', async () => {
            const { submitKycC } = await import('./submitKycC');

            const result = await submitKycC(validInput);

            expect(result).toEqual({ ok: true });
        });

        it('completes all operations without error', async () => {
            const { submitKycC } = await import('./submitKycC');

            // Should not throw
            await expect(submitKycC(validInput)).resolves.toEqual({ ok: true });

            // Both DB operations should have been called
            expect(mockShipownersTable.update).toHaveBeenCalled();
            expect(mockAuditLogsTable.insert).toHaveBeenCalled();
        });
    });
});
