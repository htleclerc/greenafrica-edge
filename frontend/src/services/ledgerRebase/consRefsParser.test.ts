import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
    parseConsRefs, parseSuiviArmateurs, parseVesselDetail,
    reconcileWithCsv, SANCTIONED_CONS_REFS,
} from './consRefsParser';

/**
 * Référentiel de la campagne du 19/08/2026.
 *
 * La source faisant foi est le CLASSEUR de suivi. `cons_refs_mapping.csv` du
 * paquet de pro-formas est un export à perte : il omet trois adresses
 * principales — dont celle de PRO-CONS-2026-021, sans quoi Leaders for
 * Trading (19 843,20 USD) resterait sans compte — et n'a aucune
 * colonne équivalente aux « Emails secondaires ». Il sert désormais de
 * contrôle de concordance : deux fichiers produits séparément qui s'accordent
 * sur 74 dossiers, 86 navires et 1 316 124,00 USD.
 */
const CSV = `cons_ref,fleet_manager,n_vessels,total_usd,contact_email,contact_phone,contact_address,contact_country,owner_name,owner_email,owner_phone,owner_address,owner_country,pi_club,vessels
PRO-CONS-2026-002,"CORAL TECHNICAL SERVICES",5,93190.40,"coral@nets.example","+99 1 1050","Amman, Jordan.","JO","IMAN SHIPPING CO LTD","","","Amman, Jordan.","JO","","ALIMAN | ABU YASSER II | ALBARAKA 1 | BARAKAT | AL MABROUKA 10"
PRO-CONS-2026-003,"DEVON SHIP MANAGEMENT LTD",2,53012.80,"","+99 1 1051","Mersin, Turkey.","TR","CAPE CRUISE MARINE LTD","","","Monrovia, Liberia.","LR","ASO P&I","CEFIRO | PORTLAND S"
PRO-CONS-2026-055,"SUCCESS SHIPPING FZE",1,7018.80,"marine@succshipping.example","+99 1 1052","Sharjah, UAE.","AE","OCEAN DEEP LTD","operations@neelshipping.example","","Sharjah, UAE.","AE","West of England","SNARTH"
`;

describe('parseConsRefs', () => {
    it('scinde la liste de navires sur le pipe et retire les espaces', () => {
        const [coral] = parseConsRefs(CSV);
        expect(coral.consRef).toBe('PRO-CONS-2026-002');
        expect(coral.fleetManager).toBe('CORAL TECHNICAL SERVICES');
        expect(coral.vessels).toEqual([
            'ALIMAN', 'ABU YASSER II', 'ALBARAKA 1', 'BARAKAT', 'AL MABROUKA 10',
        ]);
        expect(coral.nVessels).toBe(5);
        expect(coral.totalUsd).toBeCloseTo(93190.40, 2);
        expect(coral.contactEmail).toBe('coral@nets.example');
    });

    it('respecte les virgules internes aux champs entre guillemets', () => {
        const [coral] = parseConsRefs(CSV);
        expect(coral.address).toBe('Amman, Jordan.');
        expect(coral.country).toBe('JO');
    });

    it('rend null — jamais la chaîne vide — pour une adresse absente', () => {
        const devon = parseConsRefs(CSV)[1];
        expect(devon.contactEmail).toBeNull();
        expect(devon.secondaryEmails).toEqual([]);
    });

    it('remonte l’adresse du propriétaire comme contact secondaire', () => {
        const success = parseConsRefs(CSV)[2];
        expect(success.contactEmail).toBe('marine@succshipping.example');
        expect(success.secondaryEmails).toEqual(['operations@neelshipping.example']);
    });

    it('refuse un dossier dont le nombre de navires contredit la liste', () => {
        // Un fichier tronqué ne doit pas importer à moitié un portefeuille
        // de 1,3 M USD : mieux vaut refuser bruyamment.
        const faux = CSV.replace(',5,93190.40', ',9,93190.40');
        expect(() => parseConsRefs(faux)).toThrow(/PRO-CONS-2026-002/);
    });

    it('nomme les trois dossiers sous sanctions', () => {
        expect(SANCTIONED_CONS_REFS).toEqual([
            'PRO-CONS-2026-001', 'PRO-CONS-2026-022', 'PRO-CONS-2026-042',
        ]);
    });
});

describe('parseSuiviArmateurs', () => {
    const HDR = ['Réf. consolidée', 'Fleet Manager / Armateur', 'Nb navires', 'Navires',
        'Montant dû (USD)', 'Email contact', 'Emails secondaires', 'Téléphone',
        'Adresse', 'Pays', 'Propriétaire (Owner)', 'Email owner', 'Tél. owner',
        'Adresse owner', 'Pays owner', 'P&I Club'];

    const LEADERS = ['PRO-CONS-2026-021', 'LEADERS FOR TRADING & MARITIME', 1, 'LEADER',
        19843.20, 'faros@farosshipping.example', '', '', 'C/O: Faros Shipping Co Sarl', 'ZZ',
        'LEADERS FOR TRADING & MARITIME', '', '', '', 'LB', ''];

    const SUCCESS = ['PRO-CONS-2026-055', 'SUCCESS SHIPPING FZE', 1, 'SNARTH',
        7018.80, 'marine@succshipping.example', 'operations@neelshipping.example', '',
        'Sharjah', 'AE', 'OCEAN DEEP LTD', '', '', '', 'AE', 'West of England'];

    it('lit le contact que le CSV omet', () => {
        // Sans cette adresse, Leaders for Trading resterait sans compte —
        // 19 843,20 USD hors de portée du portail.
        const [d] = parseSuiviArmateurs([HDR, LEADERS]);
        expect(d.consRef).toBe('PRO-CONS-2026-021');
        expect(d.contactEmail).toBe('faros@farosshipping.example');
        expect(d.totalUsd).toBeCloseTo(19843.20, 2);
    });

    it('lit la colonne « Emails secondaires », absente du CSV', () => {
        const [d] = parseSuiviArmateurs([HDR, SUCCESS]);
        expect(d.secondaryEmails).toEqual(['operations@neelshipping.example']);
    });

    it('ignore la ligne TOTAL', () => {
        const total = ['TOTAL', '', 86, '', 1316124, '', '', '', '', '', '', '', '', '', '', ''];
        expect(parseSuiviArmateurs([HDR, total])).toHaveLength(0);
    });

    it('refuse un dossier dont le compte de navires contredit la liste', () => {
        const faux = [...LEADERS]; faux[2] = 4;
        expect(() => parseSuiviArmateurs([HDR, faux])).toThrow(/PRO-CONS-2026-021/);
    });
});

describe('reconcileWithCsv', () => {
    const mk = (ref: string, usd: number, vessels: string[], email: string | null) => ({
        consRef: ref, fleetManager: ref, nVessels: vessels.length, totalUsd: usd,
        contactEmail: email, secondaryEmails: [], phone: null, address: null,
        country: null, ownerName: null, piClub: null, vessels,
    });

    it('accepte deux sources qui s’accordent sur la structure', () => {
        const a = [mk('A', 10, ['V1'], 'a@b.c')];
        const r = reconcileWithCsv(a, [mk('A', 10, ['V1'], 'a@b.c')]);
        expect(r.ok).toBe(true);
        expect(r.problems).toEqual([]);
    });

    it('signale un écart de total', () => {
        const r = reconcileWithCsv([mk('A', 10, ['V1'], null)], [mk('A', 99, ['V1'], null)]);
        expect(r.ok).toBe(false);
        expect(r.problems.join(' ')).toMatch(/total/);
    });

    it('signale un écart de nombre de navires', () => {
        const r = reconcileWithCsv([mk('A', 10, ['V1', 'V2'], null)], [mk('A', 10, ['V1'], null)]);
        expect(r.ok).toBe(false);
        expect(r.problems.join(' ')).toMatch(/navires/);
    });

    it('liste les contacts présents au classeur et absents du CSV sans les traiter en erreur', () => {
        const r = reconcileWithCsv(
            [mk('PRO-CONS-2026-021', 10, ['LEADER'], 'faros@farosshipping.example')],
            [mk('PRO-CONS-2026-021', 10, ['LEADER'], null)],
        );
        expect(r.ok).toBe(true);
        expect(r.contactsOnlyInXlsx).toEqual(['PRO-CONS-2026-021']);
    });
});

describe('parseVesselDetail', () => {
    const HDR = ['Réf. pro-forma', 'Réf. consolidée', 'Navire', 'IMO', 'MMSI',
        'Pavillon', 'Type', 'GT', 'Built', 'Nb escales', '1re arrivée',
        'Dernier départ', 'tCO2 facturé', 'Montant (USD)', 'Propriétaire',
        'ISM Manager', 'P&I Club'];

    it('lit une ligne navire complète', () => {
        const [v] = parseVesselDetail([HDR, ['PRO-2026-064001', 'PRO-CONS-2026-001',
            'MAYAR', '9167057', '341264001', 'Saint Kitts & Nevis', 'Livestock Carrier',
            4752, 1998, 18, '2026-05-01', '2026-07-31', 1720.8, 68832.0,
            'LEVANTE MARITTIMO CO', 'MORGAN NAVIGATION CO SA', 'North of England']]);
        expect(v.invoiceRef).toBe('PRO-2026-064001');
        expect(v.consRef).toBe('PRO-CONS-2026-001');
        expect(v.name).toBe('MAYAR');
        expect(v.imo).toBe('9167057');
        expect(v.mmsi).toBe('341264001');
        expect(v.grossTonnage).toBe(4752);
        expect(v.buildYear).toBe(1998);
        expect(v.portCalls).toBe(18);
        expect(v.emissionsTco2).toBeCloseTo(1720.8, 1);
        expect(v.amountUsd).toBeCloseTo(68832.0, 2);
    });

    it('ignore la ligne TOTAL du classeur', () => {
        expect(parseVesselDetail([HDR, ['TOTAL', '', '', '', '', '', '', '', '',
            '', '', '', '', 1316124, '', '', '']])).toHaveLength(0);
    });

    it('accepte un IMO absent sans casser', () => {
        const [v] = parseVesselDetail([HDR, ['PRO-2026-064071', 'PRO-CONS-2026-071',
            'VENIZ 1', '', '', '', '', '', '', 1, '', '', 66.33, 2653.20, '', '', '']]);
        expect(v.imo).toBeNull();
        expect(v.mmsi).toBeNull();
        expect(v.name).toBe('VENIZ 1');
        expect(v.amountUsd).toBeCloseTo(2653.20, 2);
    });

    it('absorbe les espaces insécables des montants du classeur', () => {
        const [v] = parseVesselDetail([HDR, ['PRO-2026-064002', 'PRO-CONS-2026-004',
            'UNITED ID', '9196395', '341540002', '', '', '', '', 5, '', '',
            '1 139,0', '45 558,00', '', '', '']]);
        expect(v.emissionsTco2).toBeCloseTo(1139.0, 1);
        expect(v.amountUsd).toBeCloseTo(45558.0, 2);
    });
});

// Le classeur porte les coordonnees reelles des 74 debiteurs : il ne suit plus
// le depot. Ce que ces deux blocs verrouillent est une propriete du
// portefeuille, pas du lecteur — cela ne se simule pas. Ils se mettent donc en
// sommeil la ou le classeur est absent.
const CLASSEUR = join(process.cwd(), '..', 'docs', 'onboarding', 'campagne-19aout', 'suivi-armateurs.json');
const AVEC_CLASSEUR = existsSync(CLASSEUR);

// `describe.skipIf` marque les tests comme sautes mais EXECUTE quand meme le
// corps du bloc pour les collecter : une lecture posee la s'effectue malgre le
// saut. La lecture doit donc etre conditionnelle elle aussi.
function lireDossiers(): ReturnType<typeof parseSuiviArmateurs> {
    if (!AVEC_CLASSEUR) return [];
    return parseSuiviArmateurs(JSON.parse(readFileSync(CLASSEUR, 'utf8')) as unknown[][]);
}

describe.skipIf(!AVEC_CLASSEUR)('partition du referentiel — qui recoit un compte', () => {
    // Cette regle decide qui obtient un acces au portail sur un portefeuille
    // de 1 316 124,00 USD. Elle est verrouillee sur le referentiel committe,
    // pour qu'un changement de fichier ou de regle soit visible plutot que
    // silencieux.
    const dossiers = lireDossiers();
    const sanctionne = (ref: string) => (SANCTIONED_CONS_REFS as readonly string[]).includes(ref);

    const cibles = dossiers.filter((d) => d.contactEmail && !sanctionne(d.consRef));
    const sansAdresse = dossiers.filter((d) => !d.contactEmail && !sanctionne(d.consRef));
    const sanctionnes = dossiers.filter((d) => sanctionne(d.consRef));

    it('compte 74 dossiers pour 1 316 124,00 USD', () => {
        expect(dossiers).toHaveLength(74);
        expect(dossiers.reduce((s, d) => s + d.totalUsd, 0)).toBeCloseTo(1_316_124.0, 2);
    });

    it('ouvre 36 comptes, pour 681 304,00 USD', () => {
        expect(cibles).toHaveLength(36);
        expect(cibles.reduce((s, d) => s + d.totalUsd, 0)).toBeCloseTo(681_304.0, 2);
    });

    it('laisse 35 dossiers hors de portee faute d’adresse, 486 709,20 USD', () => {
        expect(sansAdresse).toHaveLength(35);
        expect(sansAdresse.reduce((s, d) => s + d.totalUsd, 0)).toBeCloseTo(486_709.2, 2);
    });

    it('exclut les 3 dossiers sous sanctions, 148 110,80 USD', () => {
        expect(sanctionnes).toHaveLength(3);
        expect(sanctionnes.reduce((s, d) => s + d.totalUsd, 0)).toBeCloseTo(148_110.8, 2);
    });

    it('n’oublie personne : les trois parts couvrent exactement le portefeuille', () => {
        expect(cibles.length + sansAdresse.length + sanctionnes.length).toBe(dossiers.length);
    });

    it('aucun dossier sanctionne ne porte d’adresse exploitable par erreur', () => {
        // Morgan Navigation et Petrofleet EN ONT une : c'est la liste figee,
        // pas l'absence d'adresse, qui les protege.
        expect(sanctionnes.filter((d) => d.contactEmail).length).toBeGreaterThan(0);
    });
});

describe.skipIf(!AVEC_CLASSEUR)('un profil ne peut posseder qu’un seul armateur', () => {
    const dossiers = lireDossiers();
    const sanctionne = (ref: string) => (SANCTIONED_CONS_REFS as readonly string[]).includes(ref);
    const cibles = dossiers.filter((d) => d.contactEmail && !sanctionne(d.consRef));

    it('detecte les adresses servant plusieurs dossiers a mettre en service', () => {
        // Poser le meme profile_id sur deux armateurs casse le portail :
        // requirePrincipal fait .eq('profile_id').maybeSingle() et rend
        // PGRST116 « The result contains 2 rows », et current_shipowner_id()
        // — qui porte le RLS — fait LIMIT 1 sans ORDER BY.
        // Le premier dossier possede le compte, les suivants sont rattaches.
        const parAdresse = new Map<string, string[]>();
        for (const d of cibles) {
            const e = (d.contactEmail as string).toLowerCase();
            parAdresse.set(e, [...(parAdresse.get(e) ?? []), d.consRef]);
        }
        const partagees = [...parAdresse.entries()].filter(([, refs]) => refs.length > 1);

        // L'adresse n'est pas nommee ici : elle vient du classeur, et ce fichier
        // n'a pas a en garder une copie. Ce qui compte est qu'il y en ait
        // EXACTEMENT une, et sur ces deux dossiers-la.
        expect(partagees).toHaveLength(1);
        expect(partagees[0][1]).toEqual(['PRO-CONS-2026-008', 'PRO-CONS-2026-021']);
        // 36 dossiers joignables, 35 comptes distincts : un seul rattachement.
        expect(parAdresse.size).toBe(35);
        expect(cibles.length).toBe(36);
    });
});
