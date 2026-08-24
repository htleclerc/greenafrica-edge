import { describe, it, expect } from 'vitest';
import { buildContactsSubmission } from './ArmateurDetail';

// ─────────────────────────────────────────────────────────────────────────────
// buildContactsSubmission — round de correction 1 (Task 8).
//
// Le formulaire de contacts est complet (8 champs affichés et édités), mais il
// ne doit PLUS envoyer les 8 à chaque sauvegarde : un envoi systématique
// neutralise la protection par présence de updateArmateurContacts.ts et ouvre
// une mise à jour perdue face à un second écrivain sur ces mêmes colonnes
// (updateOwnerKycProfile.ts, self-service armateur). Ce fichier verrouille la
// règle : seul un champ qui diffère RÉELLEMENT de la valeur chargée au montage
// (`baseline`, l'instantané `detail`) apparaît dans l'appel. officialEmail est
// le seul champ toujours envoyé (seul requis par le schéma de l'action).
// ─────────────────────────────────────────────────────────────────────────────

const BASELINE = {
    official_email: 'owner@example.com',
    billing_cc_emails: ['cc1@x.com', 'cc2@x.com'],
    ops_email: 'ops@x.com',
    finance_email: 'finance@x.com',
    phone_e164: '+25277123456',
    address: '12 Port Road',
    preferred_language: 'fr',
    notes: 'VIP',
};

const UNCHANGED_STATE = {
    officialEmail: BASELINE.official_email,
    ccEmails: [...BASELINE.billing_cc_emails],
    opsEmail: BASELINE.ops_email,
    financeEmail: BASELINE.finance_email,
    phoneE164: BASELINE.phone_e164,
    address: BASELINE.address,
    preferredLanguage: 'fr' as const,
    notes: BASELINE.notes,
};

describe('buildContactsSubmission — rien de touché', () => {
    it("n'envoie que officialEmail quand aucun champ n'a changé", () => {
        const out = buildContactsSubmission(UNCHANGED_STATE, BASELINE);
        expect(out).toEqual({ officialEmail: BASELINE.official_email });
    });

    it('la liste de copies inchangée (même dans un ordre différent) reste absente', () => {
        const out = buildContactsSubmission(
            { ...UNCHANGED_STATE, ccEmails: [...BASELINE.billing_cc_emails].reverse() },
            BASELINE,
        );
        expect(out).not.toHaveProperty('billingCcEmails');
    });
});

describe('buildContactsSubmission — un seul champ modifié', () => {
    it('officialEmail seul modifié : les 7 autres restent absents', () => {
        const out = buildContactsSubmission(
            { ...UNCHANGED_STATE, officialEmail: 'new@example.com' },
            BASELINE,
        );
        expect(out).toEqual({ officialEmail: 'new@example.com' });
    });

    it('notes seul modifié : officialEmail + notes uniquement', () => {
        const out = buildContactsSubmission(
            { ...UNCHANGED_STATE, notes: 'Contact prioritaire' },
            BASELINE,
        );
        expect(out).toEqual({ officialEmail: BASELINE.official_email, notes: 'Contact prioritaire' });
    });

    it('phoneE164 seul modifié : opsEmail/financeEmail/address/notes/preferredLanguage/billingCcEmails absents', () => {
        const out = buildContactsSubmission(
            { ...UNCHANGED_STATE, phoneE164: '+25279999999' },
            BASELINE,
        );
        expect(out).toEqual({ officialEmail: BASELINE.official_email, phoneE164: '+25279999999' });
    });

    it('preferredLanguage seul modifié', () => {
        const out = buildContactsSubmission(
            { ...UNCHANGED_STATE, preferredLanguage: 'so' },
            BASELINE,
        );
        expect(out).toEqual({ officialEmail: BASELINE.official_email, preferredLanguage: 'so' });
    });

    it('billingCcEmails seul modifié (ajout)', () => {
        const out = buildContactsSubmission(
            { ...UNCHANGED_STATE, ccEmails: [...BASELINE.billing_cc_emails, 'cc3@x.com'] },
            BASELINE,
        );
        expect(out).toEqual({
            officialEmail: BASELINE.official_email,
            billingCcEmails: ['cc1@x.com', 'cc2@x.com', 'cc3@x.com'],
        });
    });
});

describe('buildContactsSubmission — effacement explicite', () => {
    it('un champ nullable vidé par l\'utilisateur est envoyé comme null, pas comme chaîne vide', () => {
        const out = buildContactsSubmission({ ...UNCHANGED_STATE, notes: '' }, BASELINE);
        expect(out).toEqual({ officialEmail: BASELINE.official_email, notes: null });
    });

    it('un champ déjà vide en base et laissé vide ne réapparaît pas (pas de null redondant)', () => {
        const baselineNoPhone = { ...BASELINE, phone_e164: null };
        const out = buildContactsSubmission({ ...UNCHANGED_STATE, phoneE164: '' }, baselineNoPhone);
        expect(out).not.toHaveProperty('phoneE164');
    });

    it('un champ espaces-seulement est traité comme vidé (null), pas comme une valeur', () => {
        const out = buildContactsSubmission({ ...UNCHANGED_STATE, address: '   ' }, BASELINE);
        expect(out).toEqual({ officialEmail: BASELINE.official_email, address: null });
    });
});

describe('buildContactsSubmission — tout modifié', () => {
    it('envoie les 8 champs quand les 8 ont réellement changé', () => {
        const out = buildContactsSubmission(
            {
                officialEmail: 'new@example.com',
                ccEmails: ['only@x.com'],
                opsEmail: 'new-ops@x.com',
                financeEmail: 'new-finance@x.com',
                phoneE164: '+25270000000',
                address: 'New address',
                preferredLanguage: 'ar',
                notes: 'New notes',
            },
            BASELINE,
        );
        expect(out).toEqual({
            officialEmail: 'new@example.com',
            billingCcEmails: ['only@x.com'],
            opsEmail: 'new-ops@x.com',
            financeEmail: 'new-finance@x.com',
            phoneE164: '+25270000000',
            address: 'New address',
            preferredLanguage: 'ar',
            notes: 'New notes',
        });
    });
});
