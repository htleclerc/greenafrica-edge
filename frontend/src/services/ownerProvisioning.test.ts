import { describe, it, expect, vi } from 'vitest';
import { provisionOwnerAccount } from './ownerProvisioning';

/**
 * Création SILENCIEUSE d'un compte armateur.
 *
 * Deux exigences non négociables :
 *   — aucun e-mail ne part. La décision PO est que l'accès passe par la
 *     relance suivante, dont le lien fonctionne enfin. `inviteUserByEmail`
 *     déclencherait un envoi par le SMTP de Supabase : il est proscrit.
 *   — l'opération est rejouable. Le script tourne sur 36 dossiers et sera
 *     relancé après le moindre incident.
 */
function admin(opts: { existing?: { id: string; email: string } } = {}) {
    const createUser = vi.fn(async () => (opts.existing
        ? { data: null, error: { code: 'email_exists', message: 'already registered' } }
        : { data: { user: { id: 'new-user' } }, error: null }));
    const listUsers = vi.fn(async () => ({
        data: { users: opts.existing ? [opts.existing] : [] },
        error: null,
    }));
    const inviteUserByEmail = vi.fn();
    const upsert = vi.fn(async () => ({ error: null }));

    return {
        client: {
            auth: { admin: { createUser, listUsers, inviteUserByEmail } },
            from: () => ({ upsert }),
        } as never,
        createUser, listUsers, inviteUserByEmail, upsert,
    };
}

describe('provisionOwnerAccount', () => {
    it('crée le compte sans envoyer la moindre invitation', async () => {
        const a = admin();
        const r = await provisionOwnerAccount(a.client, {
            email: 'coral@nets.example', fullName: 'CORAL TECHNICAL SERVICES',
        });
        expect(r).toEqual({ profileId: 'new-user', created: true });
        expect(a.inviteUserByEmail).not.toHaveBeenCalled();
    });

    it('confirme l’adresse d’office', async () => {
        const a = admin();
        await provisionOwnerAccount(a.client, { email: 'coral@nets.example', fullName: 'CORAL' });
        // Aucun courriel de confirmation ne partira : sans email_confirm le
        // compte resterait non confirmé et le lien magique échouerait.
        expect(a.createUser).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'coral@nets.example', email_confirm: true }),
        );
    });

    it('reprend le compte existant sans le recréer', async () => {
        const a = admin({ existing: { id: 'old-user', email: 'coral@nets.example' } });
        const r = await provisionOwnerAccount(a.client, {
            email: 'coral@nets.example', fullName: 'CORAL',
        });
        expect(r).toEqual({ profileId: 'old-user', created: false });
    });

    it('normalise l’adresse en minuscules', async () => {
        const a = admin();
        await provisionOwnerAccount(a.client, { email: '  CORAL@nets.example ', fullName: 'CORAL' });
        expect(a.createUser).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'coral@nets.example' }),
        );
    });

    it('retrouve un compte existant quelle que soit la casse stockée', async () => {
        const a = admin({ existing: { id: 'old-user', email: 'CORAL@NETS.EXAMPLE' } });
        const r = await provisionOwnerAccount(a.client, {
            email: 'coral@nets.example', fullName: 'CORAL',
        });
        expect(r.profileId).toBe('old-user');
    });

    it('écrit le profil au rôle SHIPOWNER et actif', async () => {
        const a = admin();
        await provisionOwnerAccount(a.client, { email: 'coral@nets.example', fullName: 'CORAL' });
        expect(a.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ role: 'SHIPOWNER', is_active: true }),
            expect.objectContaining({ onConflict: 'id' }),
        );
    });

    it('échoue clairement quand le compte existe mais reste introuvable', async () => {
        const a = admin({ existing: { id: 'x', email: 'autre@ailleurs.com' } });
        await expect(provisionOwnerAccount(a.client, {
            email: 'coral@nets.example', fullName: 'CORAL',
        })).rejects.toThrow(/introuvable/i);
    });
});
