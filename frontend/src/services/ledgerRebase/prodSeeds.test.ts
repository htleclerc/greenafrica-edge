import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    buildProdSeedBundle,
    EXPECTED_OWNERS, EXPECTED_PROFORMAS, EXPECTED_REMINDERS, EXPECTED_TOTAL_USD, EXPECTED_VESSELS,
    type RawProdSeeds,
} from './prodSeeds';
import { parseVesselDetail, type VesselLine } from './consRefsParser';

/**
 * Le dossier de production porte les coordonnées réelles de 74 sociétés et de
 * leurs contacts : il ne suit PAS le dépôt (`.gitignore`). Toute la logique se
 * vérifie donc sur un jeu FABRIQUÉ, aux mêmes dimensions que le vrai — c'est
 * ce que le lecteur exige, et c'est ce qui rend ces tests exécutables partout.
 *
 * Une seconde série, à la fin, ne s'exécute que sur une machine où le dossier
 * est présent : elle atteste la conformité du dossier lui-même (totaux, cas de
 * contrôle), ce qu'aucune donnée fabriquée ne saurait prouver.
 */

const RATE = 40;
const SANCTIONED_INDEXES = [0, 21, 41];

/** Une adresse fabriquée, sans rapport avec un contact réel. */
function fixtureEmail(index: number): string {
    return `contact${String(index + 1).padStart(2, '0')}@example.test`;
}

function consRef(ownerIndex: number): string {
    return `PRO-CONS-2026-${String(ownerIndex + 1).padStart(3, '0')}`;
}

function invoiceRef(index: number): string {
    return `PRO-2026-${String(64001 + index).padStart(6, '0')}`;
}

/**
 * Répartit 86 pro-formas sur 74 armateurs : chacun en porte au moins une, les
 * douze premiers en portent deux. C'est la forme du vrai dossier, où huit
 * armateurs ont plusieurs navires.
 */
function ownerIndexOfProforma(index: number): number {
    return index < 12 * 2 ? Math.floor(index / 2) : index - 12;
}

/**
 * Montants qui tombent exactement sur le total attendu : le lecteur refuse
 * tout écart d'un cent, un jeu d'essai approximatif ne franchirait pas la
 * porte.
 */
function amountOf(index: number): number {
    const base = 15_000;
    return index < EXPECTED_PROFORMAS - 1
        ? base
        : EXPECTED_TOTAL_USD - base * (EXPECTED_PROFORMAS - 1);
}

function makeSeeds(): RawProdSeeds {
    const armateurs = Array.from({ length: EXPECTED_OWNERS }, (_, i) => {
        const sanctioned = SANCTIONED_INDEXES.includes(i);
        // Un armateur sur trois reste sans adresse, comme les 35 dossiers
        // hors de portée du portail.
        const reachable = !sanctioned && i % 3 !== 0;
        const email = reachable || sanctioned ? fixtureEmail(i) : null;
        return {
            id: `arm-fixture-${String(i + 1).padStart(2, '0')}`,
            nom_legal: `FIXTURE SHIPPING ${i + 1}`,
            alias: [],
            pays_hq: 'ZZ',
            adresse_hq: `${i + 1} Harbour Road`,
            email_principal: email,
            email_ops: null,
            emails_all: email ? [email] : [],
            telephone: null,
            pi_club: null,
            is_ofac_sdn: i === 21 || i === 41,
            is_un_prohibited: i === 0,
            verification_status: reachable ? 'VERIFIED' : 'UNVERIFIED',
            onboarding_stage: reachable ? 'REMINDED' : 'NO_CONTACT',
            notes: null,
        };
    });

    const navires = Array.from({ length: EXPECTED_VESSELS }, (_, i) => ({
        id: `nav-fixture-${i + 1}`,
        armateur_id: armateurs[ownerIndexOfProforma(i)].id,
        nom: `FIXTURE VESSEL ${i + 1}`,
        imo: String(9_000_001 + i),
        mmsi: null,
        pavillon: 'Panama',
        type_navire: 'General Cargo Ship',
        gt: 5000,
        dwt: 8000,
        annee_construction: '2001',
        status: 'ACTIVE',
        previous_names: [],
        registered_owner: null,
        agent_local_berbera: i % 2 === 0 ? 'FIXTURE SHIPPING AGENCY' : null,
        agent_local_contact: null,
        agent_local_tel: null,
        derniere_escale_berbera: '2026-05-01',
        n_escales: 3,
    }));

    const proformas = Array.from({ length: EXPECTED_PROFORMAS }, (_, i) => {
        const ownerIndex = ownerIndexOfProforma(i);
        const owner = armateurs[ownerIndex];
        const sanctioned = SANCTIONED_INDEXES.includes(ownerIndex);
        const total = amountOf(i);
        return {
            id: `pf-fixture-${i + 1}`,
            reference: invoiceRef(i),
            type: 'MARITIME' as const,
            armateur_id: owner.id,
            navire_id: navires[i].id,
            imo: navires[i].imo,
            total_usd: total,
            total_paye_usd: 0,
            outstanding_usd: total,
            billed_tco2: total / RATE,
            periode: '2026-05-01 → 2026-08-31',
            date_emission: '2026-08-27',
            date_echeance: '2026-09-10',
            payment_status: 'PENDING',
            collection_status: sanctioned
                ? 'SANCTIONS_INREM_ONLY'
                : (owner.email_principal ? 'FINAL_REMINDER_27AUG' : 'NO_EMAIL_CONTACT'),
            login_emails: owner.emails_all,
            pdf_url: null,
            pdf_file: `${invoiceRef(i)}.pdf`,
            sent_at: null,
            sent_method: null,
            is_erratum: false,
            penalty_usd_after_due: 20000,
        };
    });

    // 41 relances, jamais sur un dossier sous sanctions.
    const relancables = proformas.filter((p) => p.collection_status === 'FINAL_REMINDER_27AUG');
    const relances = relancables.slice(0, EXPECTED_REMINDERS).map((p, i) => ({
        id: `rel-fixture-${i + 1}`,
        proforma_id: p.id,
        tier: 'FINAL_15D',
        sent_at: '2026-08-27T12:00:00.000Z',
        sent_email: fixtureEmail(i),
        cc_emails: ['billing@example.test'],
        template_used: 'Email_Rappel_Final_IMO_EN.html',
        armateur_response_at: null,
        armateur_response_type: 'PENDING',
        escalated_bailiff: true,
    }));

    return {
        armateurs: { count: armateurs.length, armateurs },
        navires: { count: navires.length, navires },
        proformas: { count: proformas.length, proformas },
        relances: { count: relances.length, relances },
    };
}

/** Feuille de campagne fabriquée : elle ne sert qu'au pont référence ↔ dossier. */
function makeCampaign(): VesselLine[] {
    return Array.from({ length: EXPECTED_VESSELS }, (_, i) => ({
        invoiceRef: invoiceRef(i),
        consRef: consRef(ownerIndexOfProforma(i)),
        name: `FIXTURE VESSEL ${i + 1}`,
        imo: String(9_000_001 + i),
        mmsi: null,
        flag: 'Panama',
        grossTonnage: 5000,
        buildYear: 2001,
        portCalls: 3,
        emissionsTco2: amountOf(i) / RATE,
        amountUsd: amountOf(i),
    }));
}

/** Copie profonde, pour qu'un scénario d'altération n'en contamine pas un autre. */
function mutate(fn: (seeds: {
    armateurs: { armateurs: Record<string, unknown>[] };
    navires: { navires: Record<string, unknown>[] };
    proformas: { proformas: Record<string, unknown>[] };
    relances: { relances: Record<string, unknown>[] };
}) => void): RawProdSeeds {
    const copy = JSON.parse(JSON.stringify(makeSeeds()));
    fn(copy);
    return copy as RawProdSeeds;
}

describe('buildProdSeedBundle', () => {
    it('lit les quatre seeds et retrouve le portefeuille attendu', () => {
        const b = buildProdSeedBundle(makeSeeds(), makeCampaign());

        expect(b.owners).toHaveLength(EXPECTED_OWNERS);
        expect(b.vessels).toHaveLength(EXPECTED_VESSELS);
        expect(b.proformas).toHaveLength(EXPECTED_PROFORMAS);
        expect(b.reminders).toHaveLength(EXPECTED_REMINDERS);
        expect(b.totalUsd).toBeCloseTo(EXPECTED_TOTAL_USD, 2);
    });

    it('déduit une correspondance bijective entre slug et référence consolidée', () => {
        const b = buildProdSeedBundle(makeSeeds(), makeCampaign());

        const refs = b.owners.map((o) => o.consRef);
        expect(new Set(refs).size).toBe(EXPECTED_OWNERS);
        expect(refs.every((r) => /^PRO-CONS-2026-\d{3}$/.test(r))).toBe(true);
    });

    it('accorde une échéance à 15 jours, distincte du NET-30 du schéma', () => {
        const b = buildProdSeedBundle(makeSeeds(), makeCampaign());

        expect(b.proformas.every((p) => p.issuedOn === '2026-08-27')).toBe(true);
        expect(b.proformas.every((p) => p.dueOn === '2026-09-10')).toBe(true);
    });

    it('traduit le « PENDING » du dossier vers le vocabulaire du schéma', () => {
        const b = buildProdSeedBundle(makeSeeds(), makeCampaign());

        expect(b.reminders.every((r) => r.responseType === 'SILENT')).toBe(true);
        expect(b.reminders.every((r) => r.seedTier === 'FINAL_15D')).toBe(true);
    });

    it('coupe tout accès au portail aux armateurs sous sanctions', () => {
        const b = buildProdSeedBundle(makeSeeds(), makeCampaign());

        const sanctioned = b.owners.filter((o) => o.isOfacSdn || o.isUnProhibited);
        expect(sanctioned).toHaveLength(SANCTIONED_INDEXES.length);
        for (const o of sanctioned) {
            expect(o.loginEmail).toBeNull();
            expect(o.ccEmails).toEqual([]);
        }

        // Le dossier PORTE bien ces adresses — c'est le filtrage qui les
        // retire, pas leur absence de la source.
        const raw = makeSeeds().armateurs as { armateurs: Array<{ emails_all: string[] }> };
        expect(raw.armateurs[SANCTIONED_INDEXES[0]].emails_all.length).toBeGreaterThan(0);
    });

    it("récupère une adresse portée par la pro-forma mais absente de la fiche armateur", () => {
        const orphan = 'ops@orphan.test';
        const seeds = mutate((s) => {
            // Indice 4 : un dossier joignable, pas un sanctionne (dont les
            // adresses sont retirees a dessein).
            (s.proformas.proformas[4] as { login_emails: string[] }).login_emails = [orphan];
        });
        const b = buildProdSeedBundle(seeds, makeCampaign());

        const slug = (makeSeeds().proformas as { proformas: Array<{ armateur_id: string }> })
            .proformas[4].armateur_id;
        const owner = b.owners.find((o) => o.slug === slug);
        expect([owner?.loginEmail, ...(owner?.ccEmails ?? [])]).toContain(orphan);
        expect(b.warnings.some((w) => w.includes(orphan))).toBe(true);
    });
});

describe('buildProdSeedBundle — refus des dossiers incohérents', () => {
    it('refuse un fichier tronqué', () => {
        const seeds = mutate((s) => { s.proformas.proformas.pop(); });
        expect(() => buildProdSeedBundle(seeds, makeCampaign())).toThrow(/85/);
    });

    it("refuse un total qui ne tombe pas juste", () => {
        const seeds = mutate((s) => { (s.proformas.proformas[0] as { total_usd: number }).total_usd += 1; });
        expect(() => buildProdSeedBundle(seeds, makeCampaign())).toThrow(/total attendu/);
    });

    it('refuse un armateur rattaché à deux dossiers consolidés', () => {
        // La clé d'idempotence deviendrait ambiguë et le second import
        // écraserait le premier.
        const seeds = mutate((s) => {
            const rows = s.proformas.proformas as Array<{ armateur_id: string }>;
            rows[rows.length - 1].armateur_id = rows[0].armateur_id;
        });
        expect(() => buildProdSeedBundle(seeds, makeCampaign())).toThrow(/bijective/);
    });

    it('refuse une échéance antérieure à son émission', () => {
        const seeds = mutate((s) => {
            (s.proformas.proformas[0] as { date_echeance: string }).date_echeance = '2026-08-01';
        });
        expect(() => buildProdSeedBundle(seeds, makeCampaign())).toThrow(/antérieure/);
    });

    it("refuse un IMO qui n'en est pas un", () => {
        const seeds = mutate((s) => { (s.navires.navires[0] as { imo: string }).imo = 'UNVERIFIED-nav-001'; });
        expect(() => buildProdSeedBundle(seeds, makeCampaign())).toThrow();
    });

    it('refuse une relance adressée à un armateur sous sanctions', () => {
        const seeds = mutate((s) => {
            const sanctionedProforma = (s.proformas.proformas as Array<{ id: string; collection_status: string }>)
                .find((p) => p.collection_status === 'SANCTIONS_INREM_ONLY')!;
            (s.relances.relances[0] as { proforma_id: string }).proforma_id = sanctionedProforma.id;
        });
        expect(() => buildProdSeedBundle(seeds, makeCampaign())).toThrow(/sanctions/);
    });

    it("refuse une réponse de débiteur inconnue du schéma", () => {
        const seeds = mutate((s) => {
            (s.relances.relances[0] as { armateur_response_type: string }).armateur_response_type = 'MAYBE';
        });
        expect(() => buildProdSeedBundle(seeds, makeCampaign())).toThrow(/inconnue du schéma/);
    });

    it('refuse une pro-forma dont le dossier consolidé est introuvable', () => {
        const campaign = makeCampaign().filter((v) => v.invoiceRef !== invoiceRef(2));
        expect(() => buildProdSeedBundle(makeSeeds(), campaign)).toThrow(new RegExp(invoiceRef(2)));
    });
});

// ── Conformité du dossier réel ───────────────────────────────────────────────
// Ne s'exécute que là où le dossier est présent : il ne suit pas le dépôt.

const REPO = join(__dirname, '..', '..', '..', '..');
const SEEDS = join(REPO, 'docs', '06_Production_DB', 'seeds_prod');
const CAMPAIGN = join(REPO, 'docs', 'onboarding', 'campagne-19aout', 'detail-navires.json');
const dossierPresent = existsSync(SEEDS) && existsSync(CAMPAIGN);

describe.skipIf(!dossierPresent)('conformité du dossier de production du 27/08', () => {
    const realSeeds = (): RawProdSeeds => {
        const read = (f: string) => JSON.parse(readFileSync(join(SEEDS, f), 'utf8'));
        return {
            armateurs: read('01_armateurs_PROD.json'),
            navires: read('02_navires_PROD.json'),
            proformas: read('04_proformas_PROD.json'),
            relances: read('05_relances_PROD.json'),
        };
    };
    const realCampaign = () => parseVesselDetail(JSON.parse(readFileSync(CAMPAIGN, 'utf8')) as unknown[][]);

    it('retrouve le portefeuille de la campagne, au cent près', () => {
        const b = buildProdSeedBundle(realSeeds(), realCampaign());
        expect(b.totalUsd).toBeCloseTo(EXPECTED_TOTAL_USD, 2);
        expect(b.owners).toHaveLength(EXPECTED_OWNERS);
    });

    it('donne à chaque navire son IMO réel, jamais un identifiant de substitution', () => {
        const b = buildProdSeedBundle(realSeeds(), realCampaign());
        expect(b.vessels.every((v) => /^\d{7}$/.test(v.imo))).toBe(true);
        expect(new Set(b.vessels.map((v) => v.imo)).size).toBe(EXPECTED_VESSELS);
    });

    it('retrouve le cas de contrôle : IMO 9161182 → PRO-2026-064003, 44 244 USD', () => {
        const b = buildProdSeedBundle(realSeeds(), realCampaign());

        expect(b.vessels.find((v) => v.imo === '9161182')?.invoiceRef).toBe('PRO-2026-064003');
        const proforma = b.proformas.find((p) => p.reference === 'PRO-2026-064003');
        expect(proforma?.totalUsd).toBe(44244);
        expect(proforma?.issuedOn).toBe('2026-08-27');
        expect(proforma?.dueOn).toBe('2026-09-10');
    });

    it('ouvre le portail aux 36 dossiers joignables, et à eux seuls', () => {
        const b = buildProdSeedBundle(realSeeds(), realCampaign());
        expect(b.owners.filter((o) => o.loginEmail).length).toBe(36);
        expect(b.owners.filter((o) => o.isOfacSdn || o.isUnProhibited)
            .every((o) => o.loginEmail === null && o.ccEmails.length === 0)).toBe(true);
    });
});
