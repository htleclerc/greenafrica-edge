/**
 * Schémas Zod pour les 7 fichiers seeds du package onboarding armateurs/compagnies
 * (docs/onboarding/seeds/*.json). Un `z.object` par entité + un wrapper par fichier.
 * Les champs inconnus sont tolérés (`.loose()`) — les seeds évoluent indépendamment
 * de ce schéma d'import et de nouveaux champs descriptifs peuvent apparaître.
 *
 * Imports relatifs uniquement (pas d'alias `@/`) : ce module est consommé tel quel
 * par scripts/seed-onboarding.ts (Task 7), en dehors de l'app Next.js.
 */
import { z } from 'zod';

// ── armateurs[] (01_armateurs.json) ──────────────────────────────────────────
export const armateurSchema = z.object({
    id: z.string(),
    nom_legal: z.string(),
    alias: z.array(z.string()),
    pays_hq: z.string().nullable(),
    adresse_hq: z.string().nullable(),
    email_principal: z.string().nullable(),
    email_ops: z.string().nullable(),
    telephone: z.string().nullable(),
    is_ofac_sdn: z.boolean(),
    is_un_prohibited: z.boolean(),
    verification_status: z.string(),
    onboarding_stage: z.string(),
    // Absent (pas seulement null) pour 17/20 armateurs du seed — l'équipe
    // n'a pas encore vérifié Equasis pour ces opérateurs.
    equasis_id: z.string().nullable().optional(),
    notes: z.string().nullable(),
}).loose();
export type SeedArmateur = z.infer<typeof armateurSchema>;

export const armateursFileSchema = z.object({
    count: z.number(),
    armateurs: z.array(armateurSchema),
}).loose();
export type SeedArmateursFile = z.infer<typeof armateursFileSchema>;

// ── compagnies[] (07_compagnies_aeriennes.json) ──────────────────────────────
export const compagnieSchema = z.object({
    id: z.string(),
    nom_legal: z.string(),
    iata_code: z.string().nullable(),
    icao_code: z.string().nullable(),
    hub_principal: z.string().nullable(),
    pays_hq: z.string().nullable(),
    email_ops: z.string().nullable(),
    email_finance: z.string().nullable(),
    onboarding_stage: z.string(),
    notes: z.string().nullable(),
}).loose();
export type SeedCompagnie = z.infer<typeof compagnieSchema>;

export const compagniesFileSchema = z.object({
    count: z.number(),
    compagnies: z.array(compagnieSchema),
}).loose();
export type SeedCompagniesFile = z.infer<typeof compagniesFileSchema>;

// ── navires[] (02_navires.json) ──────────────────────────────────────────────
export const navireSchema = z.object({
    id: z.string(),
    armateur_id: z.string(),
    nom: z.string(),
    imo: z.string().nullable(),
    mmsi: z.string().nullable(),
    pavillon: z.string().nullable(),
    type_navire: z.string(),
    gt: z.number(),
    dwt: z.number().nullable(),
    annee_construction: z.number().nullable(),
    status: z.string(),
    previous_names: z.array(z.string()),
    wave_tag: z.string().nullable(),
}).loose();
export type SeedNavire = z.infer<typeof navireSchema>;

export const naviresFileSchema = z.object({
    count: z.number(),
    navires: z.array(navireSchema),
}).loose();
export type SeedNaviresFile = z.infer<typeof naviresFileSchema>;

// ── voyages[] (03_voyages.json) ──────────────────────────────────────────────
export const voyageSchema = z.object({
    id: z.string(),
    navire_id: z.string(),
    port_origine: z.string(),
    port_destination: z.string(),
    date_arrivee: z.string(),
    date_depart: z.string().nullable(),
    distance_nm: z.number(),
    vitesse_kn: z.number(),
    voyage_days: z.number(),
    carburant_type: z.string(),
    fuel_consumed_t: z.number(),
    co2_voyage_tco2: z.number(),
    co2_facturable_tco2: z.number(),
    contribution_usd: z.number(),
    wave_tag: z.string().nullable(),
    status: z.string(),
}).loose();
export type SeedVoyage = z.infer<typeof voyageSchema>;

export const voyagesFileSchema = z.object({
    count: z.number(),
    voyages: z.array(voyageSchema),
}).loose();
export type SeedVoyagesFile = z.infer<typeof voyagesFileSchema>;

// ── proformas[] (04_proformas.json, 04b_proformas_aviation_mai_extension.json)
// — MARITIME | AVIATION ────────────────────────────────────────────────────
// proformaAviationSchema est déjà `.loose()` (comme tous les schémas de ce
// fichier) : les 3 champs informatifs propres à 04b (`flight_date`,
// `wave_tag`, `status`) passent tels quels sans déclaration explicite — ils
// ne sont lus par aucun mapper, seule leur tolérance par le schéma compte.
export const volDetailsSchema = z.object({
    flight_no: z.string(),
    route: z.string(),
    aircraft: z.string(),
    pax: z.number(),
    co2_voyage_tco2: z.number(),
    rfi: z.number(),
}).loose();
export type SeedVolDetails = z.infer<typeof volDetailsSchema>;

const proformaBaseSchema = z.object({
    id: z.string(),
    reference: z.string(),
    total_usd: z.number(),
    total_paye_usd: z.number(),
    outstanding_usd: z.number(),
    date_emission: z.string(),
    date_echeance: z.string(),
    payment_status: z.string(),
    pdf_url: z.string().nullable(),
    sent_at: z.string().nullable(),
    sent_method: z.string().nullable(),
    is_erratum: z.boolean(),
});

export const proformaMaritimeSchema = proformaBaseSchema.extend({
    type: z.literal('MARITIME'),
    armateur_id: z.string(),
    navire_id: z.string(),
    voyage_ids: z.array(z.string()),
    original_proforma_id: z.string().nullable(),
    wave_tag: z.string().nullable(),
}).loose();
export type SeedProformaMaritime = z.infer<typeof proformaMaritimeSchema>;

export const proformaAviationSchema = proformaBaseSchema.extend({
    type: z.literal('AVIATION'),
    compagnie_id: z.string(),
    vol_details: volDetailsSchema,
}).loose();
export type SeedProformaAviation = z.infer<typeof proformaAviationSchema>;

export const proformaSchema = z.union([proformaMaritimeSchema, proformaAviationSchema]);
export type SeedProforma = z.infer<typeof proformaSchema>;

export const proformasFileSchema = z.object({
    count: z.number(),
    proformas: z.array(proformaSchema),
}).loose();
export type SeedProformasFile = z.infer<typeof proformasFileSchema>;

// ── relances[] (05_relances.json) ─────────────────────────────────────────────
export const relanceSchema = z.object({
    id: z.string(),
    proforma_id: z.string(),
    tier: z.string(),
    sent_at: z.string(),
    sent_email: z.string(),
    cc_emails: z.array(z.string()),
    template_used: z.string(),
    armateur_response_at: z.string().nullable(),
    armateur_response_type: z.string(),
    escalated_bailiff: z.boolean(),
}).loose();
export type SeedRelance = z.infer<typeof relanceSchema>;

export const relancesFileSchema = z.object({
    count: z.number(),
    relances: z.array(relanceSchema),
}).loose();
export type SeedRelancesFile = z.infer<typeof relancesFileSchema>;

// ── paiements[] (06_paiements.json) ───────────────────────────────────────────
export const paiementSchema = z.object({
    id: z.string(),
    proforma_id: z.string(),
    montant_usd: z.number(),
    date_recu: z.string(),
    methode: z.string(),
    reference_bancaire: z.string().nullable(),
    banque_emettrice: z.string().nullable(),
    confirmation_pdf: z.string().nullable(),
    notes: z.string().nullable(),
}).loose();
export type SeedPaiement = z.infer<typeof paiementSchema>;

export const paiementsFileSchema = z.object({
    count: z.number(),
    paiements: z.array(paiementSchema),
}).loose();
export type SeedPaiementsFile = z.infer<typeof paiementsFileSchema>;
