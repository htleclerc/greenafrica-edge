import { describe, it, expect, vi } from 'vitest';
import {
    notifyStaff, notifyStaffSafe, titleKeyFor, bodyKeyFor, DEFAULT_AUDIENCE,
    type StaffNotificationKind,
} from './staffNotificationService';

/** Client minimal : capture la ligne insérée et rend l'issue demandée. */
function stubDb(outcome: { data?: unknown; error?: { code?: string; message: string } } = {}) {
    const inserted: Record<string, unknown>[] = [];
    const db = {
        inserted,
        from: () => ({
            insert: (row: Record<string, unknown>) => {
                inserted.push(row);
                return {
                    select: () => ({
                        maybeSingle: async () => ({
                            data: outcome.error ? null : (outcome.data ?? { id: 'n1' }),
                            error: outcome.error ?? null,
                        }),
                    }),
                };
            },
        }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return db as any;
}

const base = { jurisdictionId: 'j1', kind: 'COLLECTION_ESCALATED' as StaffNotificationKind };

describe('notifyStaff — la ligne émise', () => {
    it('pose les clés i18n dérivées du type, jamais du texte traduit', async () => {
        const db = stubDb();
        await notifyStaff(db, base);
        expect(db.inserted[0]).toMatchObject({
            title_key: 'StaffNotifications.kind.COLLECTION_ESCALATED.title',
            body_key: 'StaffNotifications.kind.COLLECTION_ESCALATED.body',
        });
    });

    it('applique l’audience par défaut du type', async () => {
        const db = stubDb();
        await notifyStaff(db, base);
        expect(db.inserted[0].audience_roles).toEqual(['FINANCE_ADMIN', 'PORT_OFFICER']);
    });

    it('accepte une audience explicite quand le cas le justifie', async () => {
        const db = stubDb();
        await notifyStaff(db, { ...base, audience: ['MANAGER'] });
        expect(db.inserted[0].audience_roles).toEqual(['MANAGER']);
    });

    it('porte la juridiction — une notification ne fuit pas d’un pays à l’autre', async () => {
        const db = stubDb();
        await notifyStaff(db, base);
        expect(db.inserted[0].jurisdiction_id).toBe('j1');
    });

    it('normalise les champs optionnels plutôt que de les omettre', async () => {
        const db = stubDb();
        await notifyStaff(db, base);
        expect(db.inserted[0]).toMatchObject({ body_params: {}, deep_link: null, dedup_key: null });
    });
});

describe('notifyStaff — dédup et échecs', () => {
    // C'est l'intérêt de la clé : rejouer une action ne doit pas empiler les faits.
    it('traite la violation d’unicité comme un succès dédupliqué', async () => {
        const db = stubDb({ error: { code: '23505', message: 'duplicate key' } });
        const result = await notifyStaff(db, { ...base, dedupKey: 'tx-1' });
        expect(result).toEqual({ ok: true, id: null, deduped: true });
    });

    it('rapporte une vraie erreur de base', async () => {
        const db = stubDb({ error: { code: '42501', message: 'permission denied' } });
        const result = await notifyStaff(db, base);
        expect(result).toEqual({ ok: false, reason: 'permission denied' });
    });

    it('refuse d’émettre sans destinataire, plutôt que d’écrire une ligne que personne ne verra', async () => {
        const db = stubDb();
        const result = await notifyStaff(db, { ...base, audience: [] });
        expect(result.ok).toBe(false);
        expect(db.inserted).toHaveLength(0);
    });
});

describe('notifyStaffSafe', () => {
    // Une escalade qui a réussi ne doit pas être rapportée en échec parce que la
    // cloche n'a pas pu être remplie.
    it('ne lève jamais, même si l’insertion explose', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const db = {
            from: () => ({ insert: () => { throw new Error('réseau coupé'); } }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
        await expect(notifyStaffSafe(db, base)).resolves.toBeUndefined();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('journalise un refus sans le propager', async () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const db = stubDb({ error: { code: '42501', message: 'permission denied' } });
        await expect(notifyStaffSafe(db, base)).resolves.toBeUndefined();
        expect(spy).toHaveBeenCalledWith('[notifyStaff]', 'COLLECTION_ESCALATED', 'permission denied');
        spy.mockRestore();
    });
});

describe('audience par défaut', () => {
    it('n’inscrit jamais SUPERADMIN — la policy le rend destinataire de tout', () => {
        for (const roles of Object.values(DEFAULT_AUDIENCE)) {
            expect(roles).not.toContain('SUPERADMIN');
        }
    });

    // Le MANAGER est hors du rail monétaire (arbitrage recouvrement) : lui
    // pousser une escalade l'enverrait sur un écran vide.
    it('tient le MANAGER hors du rail monétaire', () => {
        expect(DEFAULT_AUDIENCE.COLLECTION_ESCALATED).not.toContain('MANAGER');
        expect(DEFAULT_AUDIENCE.CASH_PAYMENT_RECORDED).not.toContain('MANAGER');
        expect(DEFAULT_AUDIENCE.DEBTOR_RESPONDED).not.toContain('MANAGER');
    });

    it('donne un destinataire à chaque type', () => {
        for (const [kind, roles] of Object.entries(DEFAULT_AUDIENCE)) {
            expect(roles.length, kind).toBeGreaterThan(0);
        }
    });

    it('dérive title et body du même type', () => {
        expect(titleKeyFor('DISPUTE_OPENED')).toBe('StaffNotifications.kind.DISPUTE_OPENED.title');
        expect(bodyKeyFor('DISPUTE_OPENED')).toBe('StaffNotifications.kind.DISPUTE_OPENED.body');
    });
});
