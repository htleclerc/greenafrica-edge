/**
 * Lecture du dossier de production du 27/08/2026 (`docs/06_Production_DB`).
 *
 * C'est le même portefeuille que la campagne du 19/08 — mêmes 86 références,
 * mêmes montants, même total de 1 316 124,00 USD — mais identifié : les 86
 * navires y portent leur IMO réel là où le classeur en laissait 73 anonymes,
 * et chaque dossier arrive avec son adresse, son club P&I et, pour la moitié
 * d'entre eux, l'agence consignataire de Berbera.
 *
 * Le seed numérote les armateurs par slug (`arm-morgan-navigation-co-sa`)
 * quand la base les connaît par leur référence consolidée
 * (`shipowners.seed_ref = 'PRO-CONS-2026-001'`). Le pont entre les deux se
 * DÉDUIT plutôt qu'il ne se déclare : chaque pro-forma nomme son armateur, et
 * la feuille « Détail Navires » de la campagne rattache chaque référence de
 * pro-forma à son dossier consolidé. La correspondance obtenue est bijective
 * sur les 74 dossiers — c'est vérifié ici, et un seul conflit interrompt tout.
 *
 * Conserver `PRO-CONS-2026-NNN` comme clé d'idempotence n'est pas cosmétique :
 * c'est ce que lit `scripts/provision-owner-accounts.ts` pour retrouver les
 * armateurs à mettre en service, et c'est ce qui empêche un second import de
 * créer 74 doublons à côté des 26 armateurs du seed de juillet.
 */
import { z } from 'zod';
import type { VesselLine } from './consRefsParser';

/** Total du portefeuille. Un écart d'un cent interrompt : on n'importe pas un fichier tronqué. */
export const EXPECTED_TOTAL_USD = 1_316_124.0;
export const EXPECTED_OWNERS = 74;
export const EXPECTED_VESSELS = 86;
export const EXPECTED_PROFORMAS = 86;
export const EXPECTED_REMINDERS = 41;

// ── Schémas ──────────────────────────────────────────────────────────────────
// `.passthrough()` est volontairement absent : un champ inconnu dans un seed de
// production est un changement de format, pas une extension anodine, et il vaut
// mieux s'en apercevoir à la lecture qu'après l'écriture.

/**
 * Le générateur du seed écrit tantôt `null`, tantôt la chaîne vide, pour la
 * même absence. Les deux entrent ici et ressortent en `null` : la distinction
 * ne porte aucun sens métier et la laisser filer sèmerait des chaînes vides en
 * base, où elles se comportent autrement que `NULL` (un index les indexe, un
 * `COALESCE` ne les rattrape pas).
 */
const nullableString = z
    .string()
    .nullable()
    .transform((v) => {
        const trimmed = (v ?? '').trim();
        return trimmed.length ? trimmed : null;
    });

/** Adresses : vidées de leurs entrées creuses, normalisées en minuscules. */
const emailList = z
    .array(z.string())
    .transform((list) => [...new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))]);

const ownerSchema = z.object({
    id: z.string().min(1),
    nom_legal: z.string().min(1),
    alias: z.array(z.string()),
    pays_hq: nullableString,
    adresse_hq: nullableString,
    email_principal: nullableString,
    email_ops: nullableString,
    emails_all: emailList,
    telephone: nullableString,
    pi_club: nullableString,
    is_ofac_sdn: z.boolean(),
    is_un_prohibited: z.boolean(),
    verification_status: z.string(),
    onboarding_stage: z.string(),
    notes: nullableString,
});

const vesselSchema = z.object({
    id: z.string().min(1),
    armateur_id: z.string().min(1),
    nom: z.string().min(1),
    imo: z.string().regex(/^\d{7}$/, 'IMO à 7 chiffres attendu'),
    mmsi: nullableString,
    pavillon: z.string().min(1),
    type_navire: nullableString,
    gt: z.number().int().positive(),
    dwt: z.number().int().nonnegative().nullable(),
    annee_construction: nullableString,
    status: z.string(),
    previous_names: z.array(z.string()),
    registered_owner: nullableString,
    agent_local_berbera: nullableString,
    agent_local_contact: nullableString,
    agent_local_tel: nullableString,
    derniere_escale_berbera: nullableString,
    n_escales: z.number().int().nonnegative().nullable(),
});

const proformaSchema = z.object({
    id: z.string().min(1),
    reference: z.string().regex(/^PRO-2026-\d{6}$/),
    type: z.literal('MARITIME'),
    armateur_id: z.string().min(1),
    navire_id: z.string().min(1),
    imo: z.string().regex(/^\d{7}$/),
    total_usd: z.number().positive(),
    total_paye_usd: z.number(),
    outstanding_usd: z.number(),
    billed_tco2: z.number().positive(),
    periode: z.string(),
    date_emission: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    date_echeance: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    payment_status: z.string(),
    collection_status: z.enum([
        'FINAL_REMINDER_27AUG',
        'NO_EMAIL_CONTACT',
        'SANCTIONS_INREM_ONLY',
        'IN_DISCUSSION_FROZEN',
    ]),
    login_emails: emailList,
    pdf_url: nullableString,
    pdf_file: nullableString,
    sent_at: nullableString,
    sent_method: nullableString,
    is_erratum: z.boolean(),
    penalty_usd_after_due: z.number().nonnegative(),
});

const reminderSchema = z.object({
    id: z.string().min(1),
    proforma_id: z.string().min(1),
    tier: z.string(),
    sent_at: z.string(),
    sent_email: z.string(),
    cc_emails: emailList,
    template_used: z.string(),
    armateur_response_at: nullableString,
    armateur_response_type: z.string(),
    escalated_bailiff: z.boolean(),
});

const envelope = <T extends z.ZodTypeAny>(root: string, item: T) =>
    z.object({ count: z.number().int(), [root]: z.array(item) }).loose();

export type OwnerSeed = z.infer<typeof ownerSchema>;
export type VesselSeed = z.infer<typeof vesselSchema>;
export type ProformaSeed = z.infer<typeof proformaSchema>;
export type ReminderSeed = z.infer<typeof reminderSchema>;

// ── Modèle consolidé ─────────────────────────────────────────────────────────

export interface ProdOwner {
    /** Slug du seed — clé interne au dossier, jamais écrite en base. */
    slug: string;
    /** `PRO-CONS-2026-NNN` — la clé d'idempotence, déduite de la campagne. */
    consRef: string;
    legalName: string;
    aliases: string[];
    countryCode: string | null;
    address: string | null;
    /** Adresse de connexion. NULLE pour un armateur sous sanctions. */
    loginEmail: string | null;
    /** Contact d'exploitation, hors liste d'autorisation. */
    opsEmail: string | null;
    /**
     * Adresses supplémentaires ouvrant le portail (`billing_cc_emails`).
     * Union de `emails_all` et des `login_emails` des pro-formas du dossier :
     * une pro-forma nomme parfois une adresse absente de la fiche armateur.
     * VIDE pour un armateur sous sanctions.
     */
    ccEmails: string[];
    phone: string | null;
    piClub: string | null;
    isOfacSdn: boolean;
    isUnProhibited: boolean;
    notes: string | null;
}

export interface ProdVessel {
    seedId: string;
    ownerSlug: string;
    /** Référence de la pro-forma du navire — un navire, une pro-forma. */
    invoiceRef: string;
    name: string;
    imo: string;
    mmsi: string | null;
    flagName: string;
    vesselSubtype: string | null;
    grossTonnage: number;
    dwt: number | null;
    buildYear: number | null;
    previousNames: string[];
    registeredOwner: string | null;
    localAgentName: string | null;
    localAgentContact: string | null;
    localAgentPhone: string | null;
    lastPortCallOn: string | null;
    portCallsCount: number | null;
}

export interface ProdProforma {
    seedId: string;
    reference: string;
    ownerSlug: string;
    vesselSeedId: string;
    imo: string;
    totalUsd: number;
    billedTco2: number;
    period: string;
    issuedOn: string;
    dueOn: string;
    collectionStatus: ProformaSeed['collection_status'];
    loginEmails: string[];
    pdfFile: string | null;
    sentAt: string | null;
    sentMethod: string | null;
    penaltyAfterDueUsd: number;
}

export interface ProdReminder {
    seedId: string;
    proformaSeedId: string;
    invoiceRef: string;
    /** Palier du seed (`FINAL_15D`), avant traduction vers l'enum de la base. */
    seedTier: string;
    sentAt: string;
    sentEmail: string;
    ccEmails: string[];
    template: string;
    /** Valeur de `debtor_response_type`, traduite depuis le vocabulaire du dossier. */
    responseType: DebtorResponse;
    respondedAt: string | null;
    escalatedBailiff: boolean;
}

/** Vocabulaire de l'enum `debtor_response_type` (mig 094). */
export type DebtorResponse =
    | 'SILENT' | 'ACKNOWLEDGE' | 'DISPUTE' | 'PAYMENT_PROMISE'
    | 'PARTIAL_PAYMENT' | 'PAID' | 'REFUSED';

/**
 * Le dossier note « PENDING » là où la base dit « SILENT » : les deux
 * désignent une relance restée sans réponse. La traduction est explicite et
 * close — une valeur inconnue interrompt l'import plutôt que de se faire
 * silencieusement ramener au défaut de la colonne, ce qui effacerait une
 * réponse de débiteur.
 */
const RESPONSE_BY_SEED_LABEL: Record<string, DebtorResponse> = {
    PENDING: 'SILENT',
    SILENT: 'SILENT',
    ACKNOWLEDGE: 'ACKNOWLEDGE',
    DISPUTE: 'DISPUTE',
    PAYMENT_PROMISE: 'PAYMENT_PROMISE',
    PARTIAL_PAYMENT: 'PARTIAL_PAYMENT',
    PAID: 'PAID',
    REFUSED: 'REFUSED',
};

export interface ProdSeedBundle {
    owners: ProdOwner[];
    vessels: ProdVessel[];
    proformas: ProdProforma[];
    reminders: ProdReminder[];
    totalUsd: number;
    /** Anomalies non bloquantes, à porter au journal de l'import. */
    warnings: string[];
}

/** Fichiers bruts, tels que lus sur le disque. */
export interface RawProdSeeds {
    armateurs: unknown;
    navires: unknown;
    proformas: unknown;
    relances: unknown;
}

function normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
}

/**
 * Un armateur sous sanctions ne reçoit ni adresse de connexion ni CC : la
 * `billing_cc_emails` EST la liste d'autorisation du lien magique (mig 122), et
 * y verser les adresses du seed ouvrirait le portail à une partie visée par
 * l'OFAC ou les Nations unies. Le seed les porte pourtant — c'est le canal
 * documentaire du dossier, pas une autorisation d'accès. Le filtrage se fait
 * ici, une fois, plutôt qu'à chaque écriture.
 */
function isSanctioned(owner: OwnerSeed): boolean {
    return owner.is_ofac_sdn || owner.is_un_prohibited;
}

/**
 * Construit le modèle d'import à partir des quatre seeds et du détail navires
 * de la campagne du 19/08, qui fournit le pont slug ↔ référence consolidée.
 *
 * Lève à la première incohérence structurelle. Les manques attendus (dossier
 * sans adresse, navire sans agent) reviennent dans `warnings`.
 */
export function buildProdSeedBundle(raw: RawProdSeeds, campaignVessels: VesselLine[]): ProdSeedBundle {
    const owners = envelope('armateurs', ownerSchema).parse(raw.armateurs).armateurs as OwnerSeed[];
    const vessels = envelope('navires', vesselSchema).parse(raw.navires).navires as VesselSeed[];
    const proformas = envelope('proformas', proformaSchema).parse(raw.proformas).proformas as ProformaSeed[];
    const reminders = envelope('relances', reminderSchema).parse(raw.relances).relances as ReminderSeed[];

    const warnings: string[] = [];

    if (owners.length !== EXPECTED_OWNERS) throw new Error(`attendu ${EXPECTED_OWNERS} armateurs, lu ${owners.length}`);
    if (vessels.length !== EXPECTED_VESSELS) throw new Error(`attendu ${EXPECTED_VESSELS} navires, lu ${vessels.length}`);
    if (proformas.length !== EXPECTED_PROFORMAS) throw new Error(`attendu ${EXPECTED_PROFORMAS} pro-formas, lu ${proformas.length}`);
    if (reminders.length !== EXPECTED_REMINDERS) throw new Error(`attendu ${EXPECTED_REMINDERS} relances, lu ${reminders.length}`);

    const totalUsd = proformas.reduce((s, p) => s + p.total_usd, 0);
    if (Math.abs(totalUsd - EXPECTED_TOTAL_USD) > 0.01) {
        throw new Error(`total attendu ${EXPECTED_TOTAL_USD}, lu ${totalUsd.toFixed(2)}`);
    }

    // ── Pont slug ↔ référence consolidée ─────────────────────────────────────
    const consByInvoiceRef = new Map(campaignVessels.map((v) => [v.invoiceRef, v.consRef]));
    const consBySlug = new Map<string, string>();
    const slugByCons = new Map<string, string>();
    for (const p of proformas) {
        const consRef = consByInvoiceRef.get(p.reference);
        if (!consRef) throw new Error(`${p.reference} : absente du détail navires de la campagne, dossier consolidé introuvable`);

        const knownCons = consBySlug.get(p.armateur_id);
        if (knownCons && knownCons !== consRef) {
            throw new Error(`${p.armateur_id} rattaché à deux dossiers (${knownCons} et ${consRef}) — la correspondance n'est pas bijective`);
        }
        const knownSlug = slugByCons.get(consRef);
        if (knownSlug && knownSlug !== p.armateur_id) {
            throw new Error(`${consRef} rattaché à deux armateurs (${knownSlug} et ${p.armateur_id}) — la correspondance n'est pas bijective`);
        }
        consBySlug.set(p.armateur_id, consRef);
        slugByCons.set(consRef, p.armateur_id);
    }
    if (consBySlug.size !== owners.length) {
        throw new Error(`${consBySlug.size} armateurs portent une pro-forma sur ${owners.length} — un dossier sans facture n'a pas de raison d'être importé`);
    }

    // ── Adresses ouvrant le portail, par armateur ────────────────────────────
    const portalEmailsBySlug = new Map<string, Set<string>>();
    for (const o of owners) portalEmailsBySlug.set(o.id, new Set(o.emails_all.map(normalizeEmail)));
    for (const p of proformas) {
        const bag = portalEmailsBySlug.get(p.armateur_id);
        if (!bag) throw new Error(`${p.reference} : armateur ${p.armateur_id} introuvable`);
        for (const e of p.login_emails) {
            const email = normalizeEmail(e);
            if (!bag.has(email)) {
                warnings.push(`${p.reference} : ${email} figure sur la pro-forma mais pas sur la fiche de ${p.armateur_id} — ajoutée à la liste d'autorisation`);
                bag.add(email);
            }
        }
    }

    const outOwners: ProdOwner[] = owners.map((o) => {
        const consRef = consBySlug.get(o.id);
        if (!consRef) throw new Error(`${o.id} : aucune pro-forma, dossier consolidé indéterminable`);

        const sanctioned = isSanctioned(o);
        const all = [...(portalEmailsBySlug.get(o.id) ?? [])];
        const loginEmail = sanctioned ? null : (o.email_principal ? normalizeEmail(o.email_principal) : null);
        const cc = sanctioned ? [] : all.filter((e) => e !== loginEmail);

        if (sanctioned && all.length) {
            warnings.push(`${consRef} ${o.nom_legal} : sous sanctions, ${all.length} adresse(s) écartée(s) de la liste d'autorisation`);
        }
        if (!sanctioned && !loginEmail) {
            warnings.push(`${consRef} ${o.nom_legal} : aucune adresse de connexion — voie courrier / agent consignataire`);
        }

        return {
            slug: o.id,
            consRef,
            legalName: o.nom_legal,
            aliases: o.alias,
            countryCode: o.pays_hq && o.pays_hq !== 'ZZ' ? o.pays_hq : null,
            address: o.adresse_hq,
            loginEmail,
            opsEmail: o.email_ops ? normalizeEmail(o.email_ops) : null,
            ccEmails: cc,
            phone: o.telephone,
            piClub: o.pi_club,
            isOfacSdn: o.is_ofac_sdn,
            isUnProhibited: o.is_un_prohibited,
            notes: o.notes,
        };
    });

    // ── Navires ──────────────────────────────────────────────────────────────
    const refByVesselSeedId = new Map(proformas.map((p) => [p.navire_id, p.reference]));
    const seenImo = new Set<string>();
    const outVessels: ProdVessel[] = vessels.map((v) => {
        const invoiceRef = refByVesselSeedId.get(v.id);
        if (!invoiceRef) throw new Error(`navire ${v.nom} (${v.imo}) : aucune pro-forma ne le désigne`);
        if (seenImo.has(v.imo)) throw new Error(`IMO ${v.imo} présent deux fois dans le seed navires`);
        seenImo.add(v.imo);
        if (!consBySlug.has(v.armateur_id)) throw new Error(`navire ${v.nom} : armateur ${v.armateur_id} introuvable`);
        if (!v.agent_local_berbera) warnings.push(`${invoiceRef} ${v.nom} : pas d'agence consignataire connue`);

        const buildYear = v.annee_construction ? Number.parseInt(v.annee_construction, 10) : null;
        return {
            seedId: v.id,
            ownerSlug: v.armateur_id,
            invoiceRef,
            name: v.nom,
            imo: v.imo,
            mmsi: v.mmsi,
            flagName: v.pavillon,
            vesselSubtype: v.type_navire,
            grossTonnage: v.gt,
            dwt: v.dwt,
            buildYear: Number.isFinite(buildYear) ? buildYear : null,
            previousNames: v.previous_names,
            registeredOwner: v.registered_owner,
            localAgentName: v.agent_local_berbera,
            localAgentContact: v.agent_local_contact,
            localAgentPhone: v.agent_local_tel,
            lastPortCallOn: v.derniere_escale_berbera,
            portCallsCount: v.n_escales,
        };
    });

    // ── Pro-formas ───────────────────────────────────────────────────────────
    const vesselIds = new Set(vessels.map((v) => v.id));
    const outProformas: ProdProforma[] = proformas.map((p) => {
        if (!vesselIds.has(p.navire_id)) throw new Error(`${p.reference} : navire ${p.navire_id} introuvable`);
        if (p.total_paye_usd !== 0) {
            warnings.push(`${p.reference} : le seed annonce ${p.total_paye_usd} USD encaissés — le rail de paiement de la base fait foi, la valeur est ignorée`);
        }
        if (p.date_echeance <= p.date_emission) throw new Error(`${p.reference} : échéance ${p.date_echeance} antérieure à l'émission ${p.date_emission}`);
        return {
            seedId: p.id,
            reference: p.reference,
            ownerSlug: p.armateur_id,
            vesselSeedId: p.navire_id,
            imo: p.imo,
            totalUsd: p.total_usd,
            billedTco2: p.billed_tco2,
            period: p.periode,
            issuedOn: p.date_emission,
            dueOn: p.date_echeance,
            collectionStatus: p.collection_status,
            loginEmails: p.login_emails.map(normalizeEmail),
            pdfFile: p.pdf_file,
            sentAt: p.sent_at,
            sentMethod: p.sent_method,
            penaltyAfterDueUsd: p.penalty_usd_after_due,
        };
    });

    // ── Relances ─────────────────────────────────────────────────────────────
    const refByProformaSeedId = new Map(proformas.map((p) => [p.id, p.reference]));
    const outReminders: ProdReminder[] = reminders.map((r) => {
        const invoiceRef = refByProformaSeedId.get(r.proforma_id);
        if (!invoiceRef) throw new Error(`relance ${r.id} : pro-forma ${r.proforma_id} introuvable`);
        const responseType = RESPONSE_BY_SEED_LABEL[r.armateur_response_type];
        if (!responseType) {
            throw new Error(`relance ${r.id} : réponse « ${r.armateur_response_type} » inconnue du schéma`);
        }
        return {
            seedId: r.id,
            proformaSeedId: r.proforma_id,
            invoiceRef,
            seedTier: r.tier,
            sentAt: r.sent_at,
            sentEmail: r.sent_email,
            ccEmails: r.cc_emails,
            template: r.template_used,
            responseType,
            respondedAt: r.armateur_response_at,
            escalatedBailiff: r.escalated_bailiff,
        };
    });

    // Une relance partie vers un armateur sous sanctions serait une violation,
    // pas une anomalie de données : on refuse d'importer le journal tel quel.
    const sanctionedRefs = new Set(
        outProformas.filter((p) => p.collectionStatus === 'SANCTIONS_INREM_ONLY').map((p) => p.reference),
    );
    for (const r of outReminders) {
        if (sanctionedRefs.has(r.invoiceRef)) {
            throw new Error(`relance ${r.seedId} : ${r.invoiceRef} est sous sanctions et ne peut avoir reçu de relance`);
        }
    }

    return { owners: outOwners, vessels: outVessels, proformas: outProformas, reminders: outReminders, totalUsd, warnings };
}
