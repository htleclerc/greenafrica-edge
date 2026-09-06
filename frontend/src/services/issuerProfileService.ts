import type { SupabaseClient } from '@supabase/supabase-js';
import { WIRE_BENEFICIARY, type WireBeneficiary } from '@/lib/payments/wireBeneficiary';

/**
 * Profil émetteur — ce qu'un document fiscal imprime en dehors des chiffres.
 *
 * Une ligne par juridiction en base (mig 131), plus une ligne de défaut. Ce
 * module fait la superposition : chaque champ non renseigné sur la juridiction
 * retombe sur le défaut, et chaque champ absent des deux retombe sur les
 * constantes ci-dessous — pour qu'un pro-forma s'imprime même si la table n'a
 * pas encore été remplie sur un environnement neuf.
 */

export interface BankAccount {
    label: string;
    currency: string;
    holder: string;
    holderAddress: string | null;
    iban: string | null;
    accountNumber: string | null;
    swift: string;
    bank: string;
    bankAddress: string | null;
    /** Référence de dépôt propre au compte, à porter EN PLUS de la facture. */
    depositReference: string | null;
    /**
     * Banque correspondante, quand le compte en exige une. Le compte local
     * (Premier Bank, Hargeisa) n'est joignable depuis l'étranger que par
     * Nairobi : omettre l'intermédiaire fait rejeter le virement par la banque
     * émettrice, sans message utile pour le payeur.
     */
    intermediaryBank: string | null;
    intermediarySwift: string | null;
    /**
     * Compte domestique de la juridiction. Marqué explicitement plutôt que
     * déduit du libellé : le libellé est une chaîne d'affichage, traduite et
     * réécrite au fil du temps, et un pro-forma ne doit pas dépendre de son
     * orthographe pour savoir quel compte proposer au payeur local.
     */
    isLocal: boolean;
    /** Compte imprimé sur la page 1 du pro-forma, et proposé par défaut. */
    isPrimary: boolean;
}

export interface IssuerProfile {
    issuerName: string;
    issuerLegalName: string;
    issuerAddress: string;
    sovereignLine: string;
    supervisingMinistry: string;
    authorityLine: string;
    decreeReference: string;
    directorName: string;
    directorTitle: string;
    directorEmail: string;
    directorPhone: string;
    operationsEmail: string;
    billingEmail: string;
    paymentTermsDays: number;
    latePenaltyUsd: number;
    disputePeriodDays: number;
    escalationLine: string;
    bailiffName: string;
    legalBasisUrl: string;
    bankAccounts: BankAccount[];
}

/**
 * Dernier recours, si la table est vide. Reprend les documents officiels du
 * 2026-08-19 — c'est la même source que le seed de la mig 131, pas une
 * seconde vérité : si les deux divergent un jour, la base fait foi.
 */
export const DEFAULT_ISSUER_PROFILE: IssuerProfile = {
    issuerName: 'SOLIDE TECHNOLOGY (Concessionaire)',
    issuerLegalName: 'SOLIDE TECHNOLOGY LIMITED',
    issuerAddress: 'Masalaha Street, M.Haybe District, Hargeisa, Somaliland',
    sovereignLine: 'Republic of Somaliland',
    supervisingMinistry: 'Ministry of Environment & Climate Change — Republic of Somaliland',
    authorityLine: 'Maritime Carbon Tax Authority',
    decreeReference: 'MOE&CC/MWI/36/2026 (Hargeisa, 31 March 2026)',
    directorName: 'Noël KPATCHAVI',
    directorTitle: 'Director, Solide Technology',
    directorEmail: 'st.operations@greengate.africa',
    directorPhone: '+33 7 51 42 23 84',
    operationsEmail: 'st.operations@greengate.africa',
    billingEmail: 'billing@greengate.africa',
    // 30 depuis la mig 149 (décision PO 2026-09-05) : aligné sur le NET-30
    // que le déclencheur de la mig 146 pose sur transactions.due_date.
    paymentTermsDays: 30,
    latePenaltyUsd: 20000,
    disputePeriodDays: 10,
    escalationLine: 'Reminder > formal notice (copy Direction) > bailiff Eidle Advocats + Antwerp Bar',
    bailiffName: 'Eidle Advocats + Antwerp Bar',
    legalBasisUrl: 'https://greengate.africa/legal-basis',
    bankAccounts: [{
        label: 'Virement depuis la zone euro (SEPA / UE)',
        currency: 'USD',
        holder: WIRE_BENEFICIARY.beneficiary,
        holderAddress: null,
        iban: WIRE_BENEFICIARY.iban,
        accountNumber: WIRE_BENEFICIARY.iban,
        swift: WIRE_BENEFICIARY.swiftCode,
        bank: WIRE_BENEFICIARY.bank,
        bankAddress: WIRE_BENEFICIARY.bankAddress,
        depositReference: null,
        intermediaryBank: null,
        intermediarySwift: null,
        isLocal: false,
        isPrimary: true,
    }],
};

/** Colonnes de la table, telles quelles. */
interface ProfileRow {
    jurisdiction_id: string | null;
    issuer_name: string | null;
    issuer_legal_name: string | null;
    issuer_address: string | null;
    sovereign_line: string | null;
    supervising_ministry: string | null;
    authority_line: string | null;
    decree_reference: string | null;
    director_name: string | null;
    director_title: string | null;
    director_email: string | null;
    director_phone: string | null;
    operations_email: string | null;
    billing_email: string | null;
    payment_terms_days: number | null;
    late_penalty_usd: number | string | null;
    dispute_period_days: number | null;
    escalation_line: string | null;
    bailiff_name: string | null;
    legal_basis_url: string | null;
    bank_accounts: unknown;
}

const COLUMNS =
    'jurisdiction_id, issuer_name, issuer_legal_name, issuer_address, sovereign_line, '
    + 'supervising_ministry, authority_line, decree_reference, director_name, director_title, '
    + 'director_email, director_phone, operations_email, billing_email, payment_terms_days, '
    + 'late_penalty_usd, dispute_period_days, escalation_line, bailiff_name, legal_basis_url, '
    + 'bank_accounts';

function mapAccounts(raw: unknown): BankAccount[] | null {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return raw.map((a) => {
        const o = a as Record<string, unknown>;
        return {
            label: String(o.label ?? ''),
            currency: String(o.currency ?? 'USD'),
            holder: String(o.holder ?? ''),
            holderAddress: (o.holder_address as string | null) ?? null,
            iban: (o.iban as string | null) ?? null,
            accountNumber: (o.account_number as string | null) ?? null,
            swift: String(o.swift ?? ''),
            bank: String(o.bank ?? ''),
            bankAddress: (o.bank_address as string | null) ?? null,
            depositReference: (o.deposit_reference as string | null) ?? null,
            intermediaryBank: (o.intermediary_bank as string | null) ?? null,
            intermediarySwift: (o.intermediary_swift as string | null) ?? null,
            isLocal: o.is_local === true,
            isPrimary: o.is_primary === true,
        };
    });
}

/** `override ?? base` champ par champ — une valeur NULL en base n'écrase rien. */
function overlay(base: IssuerProfile, row: ProfileRow | null): IssuerProfile {
    if (!row) return base;
    const penalty = row.late_penalty_usd;
    return {
        issuerName: row.issuer_name ?? base.issuerName,
        issuerLegalName: row.issuer_legal_name ?? base.issuerLegalName,
        issuerAddress: row.issuer_address ?? base.issuerAddress,
        sovereignLine: row.sovereign_line ?? base.sovereignLine,
        supervisingMinistry: row.supervising_ministry ?? base.supervisingMinistry,
        authorityLine: row.authority_line ?? base.authorityLine,
        decreeReference: row.decree_reference ?? base.decreeReference,
        directorName: row.director_name ?? base.directorName,
        directorTitle: row.director_title ?? base.directorTitle,
        directorEmail: row.director_email ?? base.directorEmail,
        directorPhone: row.director_phone ?? base.directorPhone,
        operationsEmail: row.operations_email ?? base.operationsEmail,
        billingEmail: row.billing_email ?? base.billingEmail,
        paymentTermsDays: row.payment_terms_days ?? base.paymentTermsDays,
        latePenaltyUsd: penalty === null || penalty === undefined ? base.latePenaltyUsd : Number(penalty),
        disputePeriodDays: row.dispute_period_days ?? base.disputePeriodDays,
        escalationLine: row.escalation_line ?? base.escalationLine,
        bailiffName: row.bailiff_name ?? base.bailiffName,
        legalBasisUrl: row.legal_basis_url ?? base.legalBasisUrl,
        bankAccounts: mapAccounts(row.bank_accounts) ?? base.bankAccounts,
    };
}

/**
 * Profil applicable à une juridiction : constantes ⊕ ligne de défaut ⊕ ligne
 * de la juridiction, dans cet ordre.
 *
 * Ne lève jamais : un document fiscal ne doit pas rester bloqué parce que la
 * table de configuration est vide ou injoignable. En cas d'erreur de lecture,
 * le repli imprime les coordonnées connues plutôt que rien.
 */
export async function getIssuerProfile(
    client: SupabaseClient,
    jurisdictionId: string | null,
): Promise<IssuerProfile> {
    const { data, error } = await client
        .from('jurisdiction_issuer_profile')
        .select(COLUMNS);

    if (error || !data) return DEFAULT_ISSUER_PROFILE;

    const rows = data as unknown as ProfileRow[];
    const base = overlay(DEFAULT_ISSUER_PROFILE, rows.find((r) => r.jurisdiction_id === null) ?? null);
    if (!jurisdictionId) return base;
    return overlay(base, rows.find((r) => r.jurisdiction_id === jurisdictionId) ?? null);
}

/**
 * Compte à créditer, imprimé sur la page 1 du pro-forma et affiché à l'écran
 * de paiement. Le premier `is_primary`, à défaut le premier de la liste.
 */
export function primaryAccount(profile: IssuerProfile): BankAccount {
    return profile.bankAccounts.find((a) => a.isPrimary) ?? profile.bankAccounts[0];
}

/**
 * Compte domestique, s'il en existe un. Rendu à part parce que le pro-forma
 * l'imprime EN PLUS du compte international : un armateur qui banque sur place
 * ne doit pas payer un virement transfrontalier pour une taxe perçue chez lui.
 */
export function localAccount(profile: IssuerProfile): BankAccount | null {
    return profile.bankAccounts.find((a) => a.isLocal) ?? null;
}

/** Vue « coordonnées de virement » attendue par l'écran de paiement armateur. */
export function toWireBeneficiary(profile: IssuerProfile): WireBeneficiary {
    const a = primaryAccount(profile);
    return {
        beneficiary: a.holder,
        bank: a.bank,
        bankAddress: a.bankAddress ?? '',
        swiftCode: a.swift,
        iban: a.iban ?? a.accountNumber ?? '',
    };
}
