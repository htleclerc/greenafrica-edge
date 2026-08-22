import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_AUDIENCE, type StaffNotificationKind } from './staffNotificationService';

/**
 * Garde de couverture des émetteurs.
 *
 * Une table de notifications sans émetteur reste vide, et rien dans le code ne
 * le signale : la cloche est simplement muette. Ce test lit les actions et
 * vérifie que chaque type déclaré a bien un point d'émission — c'est la seule
 * chose qui casse si l'on ajoute un type à l'enum en oubliant de l'émettre.
 *
 * Il lit le source plutôt que d'exécuter les actions : chacune demande une
 * session, un client Supabase et un flux métier complet, que leurs propres
 * tests couvrent déjà. Ici on ne vérifie qu'une chose — le branchement existe.
 */
const ACTIONS_DIR = join(process.cwd(), 'src', 'actions');

/** Où chaque type est censé être émis. */
const EMITTERS: Record<StaffNotificationKind, string> = {
    VALIDATION_PENDING:     'createEquasisProposal.ts',
    REGISTRATION_SUBMITTED: 'registerShipowner.ts',
    COLLECTION_ESCALATED:   'escalateCollection.ts',
    DEBTOR_RESPONDED:       'recordDebtorResponse.ts',
    CASH_PAYMENT_RECORDED:  'recordManualPayment.ts',
    DISPUTE_OPENED:         'createOwnerDispute.ts',
};

const sourceOf = (file: string) => readFileSync(join(ACTIONS_DIR, file), 'utf8');

describe('émetteurs de notifications staff', () => {
    it('couvre chaque type déclaré — un type sans émetteur laisse la cloche muette', () => {
        const declared = Object.keys(DEFAULT_AUDIENCE).sort();
        expect(Object.keys(EMITTERS).sort()).toEqual(declared);
    });

    for (const [kind, file] of Object.entries(EMITTERS)) {
        it(`${kind} est émis depuis ${file}`, () => {
            const src = sourceOf(file);
            expect(src).toContain('notifyStaffSafe');
            expect(src).toContain(`kind: '${kind}'`);
        });
    }

    // L'émission ne doit jamais pouvoir faire échouer le geste qu'elle accompagne :
    // une escalade qui a réussi reste un succès même si la cloche n'a pas pu
    // être remplie. D'où notifyStaffSafe partout, jamais notifyStaff nu.
    it('passe toujours par la variante à échec doux', () => {
        for (const file of Object.values(EMITTERS)) {
            const src = sourceOf(file);
            expect(src, file).not.toMatch(/\bawait notifyStaff\(/);
        }
    });

    // Une notification mal routée est pire qu'absente : elle avertit la mauvaise
    // équipe. Chaque émetteur doit donc lire une juridiction, jamais la supposer.
    it('route sur une juridiction lue, jamais supposée', () => {
        for (const file of Object.values(EMITTERS)) {
            const src = sourceOf(file);
            expect(src, file).toContain('jurisdictionId');
            expect(src, file).not.toMatch(/jurisdictionId:\s*'[0-9a-f-]{8}/i);
        }
    });
});
