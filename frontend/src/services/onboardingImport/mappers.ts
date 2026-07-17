/**
 * Mappers purs : seeds onboarding (docs/onboarding/seeds/*.json) → lignes prêtes à
 * insérer dans le schéma GreenGate existant. Aucun import Supabase, aucun réseau —
 * ces fonctions sont consommées par scripts/seed-onboarding.ts (Task 7) via imports
 * relatifs. Imports relatifs uniquement dans ce fichier (pas d'alias `@/`).
 *
 * Colonnes cibles : migrations 003 (vessels/transactions de base + enum
 * vessel_category), 017 (invoice_ref), 024/047 (shipowners de base), 026
 * (transactions PROFORMA/breakdown_json), 048 (payments), 071/077 (mode
 * MARITIME/AIR + aircraft_id), 092 (shipowners sanctions/aviation), 093 (vessels
 * seed extensions), 094 (collection_reminders).
 */
import type {
    SeedArmateur, SeedCompagnie, SeedNavire, SeedVoyage,
    SeedProformaMaritime, SeedProformaAviation, SeedRelance, SeedPaiement,
} from './seedSchemas';

// ── Enum vessel_category (migration 003_core_domain_tables.sql, ligne 8-10) ──
// Valeurs réelles de l'enum Postgres — vérifiées dans la migration, ne PAS
// importer depuis src/types/database.ts qui est stale pour ces tables.
export type DbVesselCategory =
    | 'CONTAINER' | 'CARGO' | 'TANKER' | 'BULK_CARRIER' | 'FERRY' | 'NAVAL' | 'SCIENTIFIC';

// ── shipowner_account_state (migration 024, étendu en 047) ──────────────────
export type DbShipownerAccountState =
    | 'GHOST' | 'PENDING_REVIEW' | 'INVITED' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

// ── transport_mode (migration 071) ───────────────────────────────────────────
export type DbTransportMode = 'MARITIME' | 'AIR';

// ── *Insert : interfaces locales alignées sur les colonnes DB ────────────────

/** shipowners (024 + 047 + 092) — champs peuplés par l'import onboarding. */
export interface ShipownerInsert {
    seed_ref: string;
    name: string;
    country_code: string | null;
    address: string | null;
    official_email: string | null;
    ops_email: string | null;
    finance_email: string | null;
    phone_e164: string | null;
    aliases: string[];
    equasis_id: string | null;
    iata_code: string | null;
    icao_code: string | null;
    hub_code: string | null;
    notes: string | null;
    is_ofac_sdn: boolean;
    is_un_prohibited: boolean;
    account_state: DbShipownerAccountState;
}

/** vessels (003 + 024 + 093) — champs peuplés par l'import onboarding. */
export interface VesselInsert {
    seed_ref: string;
    imo_number: string;
    name: string;
    mmsi: string | null;
    flag_code: string;
    category: DbVesselCategory;
    vessel_subtype: string | null;
    gross_tonnage_dwt: number;
    dwt: number | null;
    build_year: number | null;
    previous_names: string[];
    wave_tag: string | null;
    shipowner_id: string | null;
}

/** transactions (003 + 017 + 026 + 071 + 077) — pro-forma d'entrée MARITIME/AIR. */
export interface TransactionInsert {
    invoice_ref: string;
    transaction_type: 'ENTRY_TAX' | 'TRANSIT_FEE' | 'PORT_STAY';
    document_type: 'PROFORMA' | 'FINAL' | 'COMPLEMENT' | 'REFUND';
    mode: DbTransportMode;
    vessel_id: string | null;
    vessel_name: string;
    vessel_imo: string;
    aircraft_id: string | null;
    shipowner_id: string | null;
    emissions_tco2: number;
    tax_amount_usd: number;
    rate_usd_per_tco2: number;
    status: 'PENDING';
    collections_status: 'CURRENT';
    created_at: string;
    breakdown_json: Record<string, unknown>;
}

/** collection_reminders (094). */
export interface CollectionReminderInsert {
    seed_ref: string;
    transaction_id: string;
    tier: string;
    sent_at: string;
    sent_email: string;
    cc_emails: string[];
    template_used: string;
    debtor_response_at: string | null;
    debtor_response_type: string;
    escalated_bailiff: boolean;
}

/** payments (048). */
export interface PaymentInsert {
    transaction_id: string;
    shipowner_id: string;
    amount_minor: number;
    currency: string;
    amount_usd_minor: number;
    fx_rate: number | null;
    rail: 'WIRE_TRANSFER';
    rail_details: Record<string, unknown>;
    external_reference: string | null;
    status: 'CONFIRMED';
    confirmed_by: string;
    confirmed_at: string;
    declared_by: string;
}

/**
 * Référence résolue d'un navire, pour peupler vessel_name/vessel_imo sur la
 * transaction sans second aller-retour DB. Task 7 construit cette map après
 * avoir inséré les vessels (id retourné par l'insert + name/imo déjà en main).
 */
export interface VesselRefForProforma {
    id: string;
    name: string;
    imoNumber: string;
}

/**
 * Référence résolue d'une pro-forma déjà importée, pour les relances/paiements
 * qui la référencent par seed id (`proforma_id`, ex. "pf-mar-064001") — PAS par
 * invoice_ref. shipownerId est porté ici car payments.shipowner_id est NOT NULL
 * (migration 048) ; Task 7 le connaît déjà via la transaction qu'il vient
 * d'insérer, donc pas besoin d'une map dédiée en plus.
 */
export interface ProformaTransactionRef {
    transactionId: string;
    shipownerId: string;
}

export interface MaritimeProformaContext {
    vesselIdBySeedRef: Map<string, VesselRefForProforma>;
    shipownerIdBySeedRef: Map<string, string>;
    voyageBySeedRef: Map<string, SeedVoyage>;
}

export interface AviationProformaContext {
    aircraftIdByKey: Map<string, string>;
    shipownerIdBySeedRef: Map<string, string>;
}

// ── parseSeedDate ─────────────────────────────────────────────────────────────

const DDMMYYYY_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Accepte `DD/MM/YYYY` (format des voyages seed) ou `YYYY-MM-DD` (format des
 * proformas seed) et retourne toujours `YYYY-MM-DD`. Rejette (throw) toute
 * autre forme plutôt que de laisser passer une date invalide en DB.
 */
/**
 * Vérifie que année/mois/jour forment une date calendaire réelle (rejette
 * `32/13/2026` ou `29/02/2026` sur une année non bissextile) en reconstruisant
 * une Date UTC à partir des composants et en s'assurant qu'ils ressortent
 * identiques — `Date.UTC` déborde silencieusement sinon (ex. jour 32 → mois+1).
 */
function assertValidCalendarDate(iso: string, year: number, month: number, day: number): void {
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
        throw new Error(`parseSeedDate: date calendaire invalide: "${iso}"`);
    }
}

export function parseSeedDate(s: string): string {
    if (ISO_DATE_RE.test(s)) {
        const [year, month, day] = s.split('-').map(Number);
        assertValidCalendarDate(s, year, month, day);
        return s;
    }
    const match = DDMMYYYY_RE.exec(s);
    if (match) {
        const [, day, month, year] = match;
        assertValidCalendarDate(s, Number(year), Number(month), Number(day));
        return `${year}-${month}-${day}`;
    }
    throw new Error(`parseSeedDate: format de date non reconnu: "${s}" (attendu DD/MM/YYYY ou YYYY-MM-DD)`);
}

// ── mapVesselCategory ─────────────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, DbVesselCategory> = {
    'Bulk Carrier': 'BULK_CARRIER',
    'Container Ship': 'CONTAINER',
    'General Cargo': 'CARGO',
    'Cargo': 'CARGO',
    'Chemical Tanker': 'TANKER',
    'Chemical/Oil Tanker': 'TANKER',
    'Oil Tanker': 'TANKER',
    'Livestock Carrier': 'CARGO',
    'Tug': 'CARGO',
    'Offshore Tug/Supply': 'CARGO',
    'Landing Craft': 'CARGO',
};

export function mapVesselCategory(typeNavire: string): DbVesselCategory {
    return CATEGORY_MAP[typeNavire] ?? 'CARGO';
}

// ── mapArmateurToShipowner / mapCompagnieToShipowner ─────────────────────────

export function mapArmateurToShipowner(a: SeedArmateur): ShipownerInsert {
    return {
        seed_ref: a.id,
        name: a.nom_legal,
        country_code: a.pays_hq,
        address: a.adresse_hq,
        official_email: a.email_principal,
        ops_email: a.email_ops,
        finance_email: null,
        phone_e164: a.telephone,
        aliases: a.alias,
        equasis_id: a.equasis_id ?? null,
        iata_code: null,
        icao_code: null,
        hub_code: null,
        notes: a.notes,
        is_ofac_sdn: a.is_ofac_sdn,
        is_un_prohibited: a.is_un_prohibited,
        // Toujours GHOST : l'invitation (transition vers INVITED) est un acte
        // admin explicite post-import, jamais automatique depuis le seed.
        account_state: 'GHOST',
    };
}

export function mapCompagnieToShipowner(c: SeedCompagnie): ShipownerInsert {
    return {
        seed_ref: c.id,
        name: c.nom_legal,
        country_code: c.pays_hq,
        address: null,
        official_email: c.email_ops,
        ops_email: c.email_ops,
        finance_email: c.email_finance,
        phone_e164: null,
        aliases: [],
        equasis_id: null,
        iata_code: c.iata_code,
        icao_code: c.icao_code,
        hub_code: c.hub_principal,
        notes: c.notes,
        is_ofac_sdn: false,
        is_un_prohibited: false,
        account_state: 'GHOST',
    };
}

// ── mapNavireToVessel ─────────────────────────────────────────────────────────

const FLAG_CODE_RE = /^[A-Z]{2}$/;

function resolveFlagCode(pavillon: string | null): string {
    if (pavillon && FLAG_CODE_RE.test(pavillon)) {
        return pavillon;
    }
    // flag_code est CHAR(2) NOT NULL (migration 003) : pavillon manquant ("—"),
    // null, ou non-ISO2 → sentinelle 'XX'.
    return 'XX';
}

function resolveMmsi(mmsi: string | null): string | null {
    if (!mmsi || mmsi === '—') {
        return null;
    }
    return mmsi;
}

/** Préfixe des IMO synthétiques (placeholder quand le seed n'a pas d'IMO réel). */
export const SYNTHETIC_IMO_PREFIX = 'UNVERIFIED-';

/** Détecte un IMO synthétique produit par `resolveImoNumber` (pas un vrai IMO). */
export function isSyntheticImo(imo: string): boolean {
    return imo.startsWith(SYNTHETIC_IMO_PREFIX);
}

function resolveImoNumber(n: SeedNavire): string {
    if (n.imo && n.imo !== '—') {
        return n.imo;
    }
    // imo_number reste NOT NULL UNIQUE (migration 003) — jamais relaxé par la
    // 093 (qui ne touche que mmsi/call_sign). 73/100 navires du seed ont
    // imo=null (source Equasis/VesselFinder incomplète). On synthétise un
    // placeholder stable et unique à partir du seed id plutôt que d'échouer
    // l'import ou d'inventer un faux IMO plausible.
    return `${SYNTHETIC_IMO_PREFIX}${n.id}`;
}

export function mapNavireToVessel(
    n: SeedNavire,
    shipownerIdBySeedRef: Map<string, string>,
): VesselInsert {
    return {
        seed_ref: n.id,
        imo_number: resolveImoNumber(n),
        name: n.nom,
        mmsi: resolveMmsi(n.mmsi),
        flag_code: resolveFlagCode(n.pavillon),
        category: mapVesselCategory(n.type_navire),
        vessel_subtype: n.type_navire,
        gross_tonnage_dwt: n.gt,
        dwt: n.dwt,
        build_year: n.annee_construction,
        previous_names: n.previous_names,
        wave_tag: n.wave_tag,
        // shipowner_id est nullable (024 : ON DELETE SET NULL) — un armateur
        // absent de la map (pas encore importé / hors lot) donne un navire
        // orphelin plutôt qu'un échec de tout l'import.
        shipowner_id: shipownerIdBySeedRef.get(n.armateur_id) ?? null,
    };
}

// ── mapProformaMaritime / mapProformaAviation ─────────────────────────────────

/**
 * breakdown_json est un instantané libre (colonne JSONB, pas de contrainte de
 * forme) — 26/100 voyages du seed portent un `date_depart` en texte libre
 * ("à confirmer", "still at port (cycle 2)", "08/05/2026 (cycle 2)"), et
 * 4/100 un `date_arrivee` composite ("25/04/2026 + 06/05/2026 (2 cycles)")
 * pour les voyages multi-escales ou encore en cours. On tente le parsing
 * strict et on retombe sur la chaîne brute plutôt que de faire échouer tout
 * l'import pour un champ purement informatif du snapshot — contrairement à
 * `date_emission` (colonne `created_at`, toujours une date propre dans le
 * seed réel), qui reste strict.
 */
function parseSeedDateOrRaw(s: string): string {
    try {
        return parseSeedDate(s);
    } catch {
        return s;
    }
}

export function mapProformaMaritime(
    p: SeedProformaMaritime,
    ctx: MaritimeProformaContext,
): TransactionInsert {
    const voyageSeedId = p.voyage_ids[0];
    if (!voyageSeedId) {
        throw new Error(`mapProformaMaritime: proforma ${p.id} n'a aucun voyage_ids`);
    }
    const voyage = ctx.voyageBySeedRef.get(voyageSeedId);
    if (!voyage) {
        throw new Error(
            `mapProformaMaritime: voyage "${voyageSeedId}" introuvable dans le contexte (proforma ${p.id})`,
        );
    }
    const vessel = ctx.vesselIdBySeedRef.get(p.navire_id);
    if (!vessel) {
        // vessel_id est requis par la CHECK transactions_asset_per_mode (077)
        // pour mode<>'AIR' : mieux vaut échouer tôt et lisiblement ici que
        // laisser Postgres rejeter l'insert sans contexte.
        throw new Error(
            `mapProformaMaritime: navire "${p.navire_id}" introuvable dans le contexte (proforma ${p.id})`,
        );
    }

    return {
        invoice_ref: p.reference,
        transaction_type: 'ENTRY_TAX',
        document_type: 'PROFORMA',
        mode: 'MARITIME',
        vessel_id: vessel.id,
        vessel_name: vessel.name,
        vessel_imo: vessel.imoNumber,
        aircraft_id: null,
        shipowner_id: ctx.shipownerIdBySeedRef.get(p.armateur_id) ?? null,
        emissions_tco2: voyage.co2_facturable_tco2,
        tax_amount_usd: p.total_usd,
        rate_usd_per_tco2: 40,
        status: 'PENDING',
        collections_status: 'CURRENT',
        created_at: parseSeedDate(p.date_emission),
        breakdown_json: {
            source: 'onboarding_seed_v2',
            wave_tag: p.wave_tag,
            voyage: {
                ...voyage,
                date_arrivee: parseSeedDateOrRaw(voyage.date_arrivee),
                date_depart: voyage.date_depart ? parseSeedDateOrRaw(voyage.date_depart) : null,
            },
        },
    };
}

export function mapProformaAviation(
    p: SeedProformaAviation,
    ctx: AviationProformaContext,
): TransactionInsert {
    const aircraftKey = `${p.compagnie_id}/${p.vol_details.aircraft}`;
    const aircraftId = ctx.aircraftIdByKey.get(aircraftKey);
    if (!aircraftId) {
        // aircraft_id est requis par la CHECK transactions_asset_per_mode (077)
        // pour mode='AIR'.
        throw new Error(
            `mapProformaAviation: aircraft "${aircraftKey}" introuvable dans le contexte (proforma ${p.id})`,
        );
    }

    return {
        invoice_ref: p.reference,
        transaction_type: 'ENTRY_TAX',
        document_type: 'PROFORMA',
        mode: 'AIR',
        vessel_id: null,
        vessel_name: p.vol_details.flight_no,
        vessel_imo: p.vol_details.aircraft,
        aircraft_id: aircraftId,
        shipowner_id: ctx.shipownerIdBySeedRef.get(p.compagnie_id) ?? null,
        emissions_tco2: p.vol_details.co2_voyage_tco2 * p.vol_details.rfi,
        tax_amount_usd: p.total_usd,
        rate_usd_per_tco2: 40,
        status: 'PENDING',
        collections_status: 'CURRENT',
        created_at: parseSeedDate(p.date_emission),
        breakdown_json: {
            source: 'onboarding_seed_v2',
            vol: p.vol_details,
        },
    };
}

// ── mapRelance ────────────────────────────────────────────────────────────────

export function mapRelance(
    r: SeedRelance,
    txnIdByProformaSeedId: Map<string, ProformaTransactionRef>,
): CollectionReminderInsert {
    const ref = txnIdByProformaSeedId.get(r.proforma_id);
    if (!ref) {
        throw new Error(
            `mapRelance: proforma "${r.proforma_id}" introuvable dans le contexte (relance ${r.id})`,
        );
    }
    return {
        seed_ref: r.id,
        transaction_id: ref.transactionId,
        tier: r.tier,
        sent_at: r.sent_at,
        sent_email: r.sent_email,
        cc_emails: r.cc_emails,
        template_used: r.template_used,
        debtor_response_at: r.armateur_response_at,
        debtor_response_type: r.armateur_response_type,
        escalated_bailiff: r.escalated_bailiff,
    };
}

// ── mapPaiement ───────────────────────────────────────────────────────────────

export function mapPaiement(
    p: SeedPaiement,
    txnIdByProformaSeedId: Map<string, ProformaTransactionRef>,
    confirmedBy: string,
): PaymentInsert {
    const ref = txnIdByProformaSeedId.get(p.proforma_id);
    if (!ref) {
        throw new Error(
            `mapPaiement: proforma "${p.proforma_id}" introuvable dans le contexte (paiement ${p.id})`,
        );
    }
    const amountMinor = Math.round(p.montant_usd * 100);
    return {
        transaction_id: ref.transactionId,
        shipowner_id: ref.shipownerId,
        amount_minor: amountMinor,
        currency: 'USD',
        amount_usd_minor: amountMinor,
        // CHECK payments_currency_amount_consistent (migration 048) exige
        // fx_rate IS NULL quand currency='USD' — ce mapper ne produit que du
        // USD, donc jamais 1 ici.
        fx_rate: null,
        rail: 'WIRE_TRANSFER',
        rail_details: {
            reference_bancaire: p.reference_bancaire,
            banque_emettrice: p.banque_emettrice,
            notes: p.notes,
        },
        external_reference: p.reference_bancaire,
        status: 'CONFIRMED',
        confirmed_by: confirmedBy,
        // confirmed_at est TIMESTAMPTZ ; date_recu ("YYYY-MM-DD") est castée par
        // Postgres à minuit UTC — pas de reformatage nécessaire côté mapper.
        confirmed_at: p.date_recu,
        declared_by: confirmedBy,
    };
}
