import { describe, it, expect } from 'vitest';
import {
    parseSeedDate, mapVesselCategory, mapArmateurToShipowner,
    mapCompagnieToShipowner, mapNavireToVessel, mapProformaMaritime,
    mapProformaAviation, mapRelance, mapPaiement, isSyntheticImo,
} from './mappers';

describe('onboardingImport mappers', () => {
    it('parseSeedDate accepte DD/MM/YYYY et ISO', () => {
        expect(parseSeedDate('26/04/2026')).toBe('2026-04-26');
        expect(parseSeedDate('2026-06-01')).toBe('2026-06-01');
    });

    it('parseSeedDate rejette une date non reconnue', () => {
        expect(() => parseSeedDate('not-a-date')).toThrow();
        expect(() => parseSeedDate('2026/04/26')).toThrow();
    });

    it('parseSeedDate rejette une date calendaire invalide', () => {
        expect(() => parseSeedDate('32/13/2026')).toThrow();
        // 2026 n'est pas bissextile.
        expect(() => parseSeedDate('29/02/2026')).toThrow();
    });

    it('parseSeedDate accepte le 29 février d\'une année bissextile', () => {
        expect(parseSeedDate('29/02/2024')).toBe('2024-02-29');
    });

    it('mapVesselCategory couvre les 11 types du seed avec fallback CARGO', () => {
        expect(mapVesselCategory('Bulk Carrier')).toBe('BULK_CARRIER');
        expect(mapVesselCategory('Container Ship')).toBe('CONTAINER');
        expect(mapVesselCategory('General Cargo')).toBe('CARGO');
        expect(mapVesselCategory('Cargo')).toBe('CARGO');
        expect(mapVesselCategory('Chemical Tanker')).toBe('TANKER');
        expect(mapVesselCategory('Chemical/Oil Tanker')).toBe('TANKER');
        expect(mapVesselCategory('Oil Tanker')).toBe('TANKER');
        expect(mapVesselCategory('Livestock Carrier')).toBe('CARGO');
        expect(mapVesselCategory('Tug')).toBe('CARGO');
        expect(mapVesselCategory('Offshore Tug/Supply')).toBe('CARGO');
        expect(mapVesselCategory('Landing Craft')).toBe('CARGO');
        expect(mapVesselCategory('Type Inconnu')).toBe('CARGO');
    });

    it('armateur OFAC garde ses flags et reste GHOST', () => {
        const row = mapArmateurToShipowner({
            id: 'arm-007', nom_legal: 'IRISL Group / Valfajr Shipping', alias: [],
            pays_hq: 'IR', adresse_hq: null, email_principal: 'commercial@irisl.net',
            email_ops: null, telephone: null, is_ofac_sdn: true, is_un_prohibited: false,
            verification_status: 'BLOCKED', onboarding_stage: 'BLOCKED_OFAC',
            equasis_id: null, notes: null,
        });
        expect(row.is_ofac_sdn).toBe(true);
        expect(row.account_state).toBe('GHOST');
        expect(row.seed_ref).toBe('arm-007');
    });

    it('armateur normal mappe tous les champs de base', () => {
        const row = mapArmateurToShipowner({
            id: 'arm-001', nom_legal: 'H&P Ship Management Ltd',
            alias: ['H&P Cyprus', 'HP Ship Mgmt'], pays_hq: 'CY',
            adresse_hq: '27 Neophytos Nicolaides Street, 8011 Paphos, Cyprus',
            email_principal: 'operations@hpshipmanagement.com',
            email_ops: 'vessels@hpshipmanagement.com', telephone: '+357 26 811 200',
            is_ofac_sdn: false, is_un_prohibited: false, verification_status: 'VERIFIED',
            onboarding_stage: 'PENDING_INVITE', equasis_id: 'HP-MGT-2019-0341',
            notes: 'Bulk carrier operator',
        });
        expect(row.name).toBe('H&P Ship Management Ltd');
        expect(row.country_code).toBe('CY');
        expect(row.address).toBe('27 Neophytos Nicolaides Street, 8011 Paphos, Cyprus');
        expect(row.official_email).toBe('operations@hpshipmanagement.com');
        expect(row.ops_email).toBe('vessels@hpshipmanagement.com');
        expect(row.phone_e164).toBe('+357 26 811 200');
        expect(row.aliases).toEqual(['H&P Cyprus', 'HP Ship Mgmt']);
        expect(row.equasis_id).toBe('HP-MGT-2019-0341');
        expect(row.account_state).toBe('GHOST');
    });

    it('armateur avec email_principal null → official_email null', () => {
        const row = mapArmateurToShipowner({
            id: 'arm-099', nom_legal: 'Ghost Line', alias: [], pays_hq: null,
            adresse_hq: null, email_principal: null, email_ops: null, telephone: null,
            is_ofac_sdn: false, is_un_prohibited: false, verification_status: 'PENDING',
            onboarding_stage: 'PENDING_INVITE', equasis_id: null, notes: null,
        });
        expect(row.official_email).toBeNull();
        expect(row.country_code).toBeNull();
    });

    it('compagnie aérienne mappe IATA/hub sur shipowners', () => {
        const row = mapCompagnieToShipowner({
            id: 'avi-002', nom_legal: 'FlyDubai', iata_code: 'FZ', icao_code: 'FDB',
            hub_principal: 'DXB', pays_hq: 'AE', email_ops: 'ops@flydubai.com',
            email_finance: 'finance@flydubai.com', onboarding_stage: 'PENDING_INVITE', notes: null,
        });
        expect(row.iata_code).toBe('FZ');
        expect(row.hub_code).toBe('DXB');
        expect(row.official_email).toBe('ops@flydubai.com');
        expect(row.account_state).toBe('GHOST');
        expect(row.seed_ref).toBe('avi-002');
    });

    it('mapNavireToVessel résout le shipowner_id via armateur_id et mmsi "—" → null', () => {
        const shipownerIdBySeedRef = new Map([['arm-002', 'cccccccc-0000-4000-8000-000000000001']]);
        const row = mapNavireToVessel({
            id: 'nav-001', armateur_id: 'arm-002', nom: 'RASHA', imo: '9235957', mmsi: '—',
            pavillon: 'TO', type_navire: 'Bulk Carrier', gt: 17784, dwt: null,
            annee_construction: null, status: 'ACTIVE', previous_names: [], wave_tag: 'W1-3',
        }, shipownerIdBySeedRef);
        expect(row.mmsi).toBeNull();
        expect(row.shipowner_id).toBe('cccccccc-0000-4000-8000-000000000001');
        expect(row.imo_number).toBe('9235957');
        expect(row.flag_code).toBe('TO');
        expect(row.category).toBe('BULK_CARRIER');
        expect(row.seed_ref).toBe('nav-001');
    });

    it('mapNavireToVessel: pavillon null/"—" → flag_code "XX"', () => {
        const shipownerIdBySeedRef = new Map([['arm-014', 'dddddddd-0000-4000-8000-000000000001']]);
        const rowNullFlag = mapNavireToVessel({
            id: 'nav-028', armateur_id: 'arm-014', nom: 'VESSEL-W4-01', imo: null, mmsi: null,
            pavillon: null, type_navire: 'Bulk Carrier', gt: 19908, dwt: null,
            annee_construction: null, status: 'ACTIVE', previous_names: [], wave_tag: 'W4',
        }, shipownerIdBySeedRef);
        expect(rowNullFlag.flag_code).toBe('XX');
        expect(rowNullFlag.mmsi).toBeNull();
        // imo null in seed → synthesized non-null unique fallback (imo_number is NOT NULL/UNIQUE)
        expect(rowNullFlag.imo_number).toBeTruthy();
        expect(typeof rowNullFlag.imo_number).toBe('string');

        const rowDashFlag = mapNavireToVessel({
            id: 'nav-099', armateur_id: 'arm-014', nom: 'VESSEL-DASH', imo: '1234567', mmsi: '376985000',
            pavillon: '—', type_navire: 'Cargo', gt: 5000, dwt: null,
            annee_construction: null, status: 'ACTIVE', previous_names: [], wave_tag: 'W5',
        }, shipownerIdBySeedRef);
        expect(rowDashFlag.flag_code).toBe('XX');
        expect(rowDashFlag.mmsi).toBe('376985000');
    });

    it('isSyntheticImo distingue un IMO synthétique d\'un IMO réel', () => {
        expect(isSyntheticImo('UNVERIFIED-nav-014')).toBe(true);
        expect(isSyntheticImo('9235957')).toBe(false);
    });

    it('mapNavireToVessel: shipowner_id absent de la map → null (pas de throw)', () => {
        const row = mapNavireToVessel({
            id: 'nav-500', armateur_id: 'arm-unknown', nom: 'ORPHAN', imo: '9999999', mmsi: null,
            pavillon: 'PA', type_navire: 'Cargo', gt: 1000, dwt: null,
            annee_construction: null, status: 'ACTIVE', previous_names: [], wave_tag: 'W5',
        }, new Map());
        expect(row.shipowner_id).toBeNull();
    });

    it('pro-forma maritime → transaction ENTRY_TAX/PROFORMA avec breakdown_json.voyage', () => {
        const txn = mapProformaMaritime(
            {
                id: 'pf-mar-064001', reference: 'PRO-2026-064001', type: 'MARITIME',
                armateur_id: 'arm-002', navire_id: 'nav-001', voyage_ids: ['voy-001'],
                total_usd: 28999.99, total_paye_usd: 0, outstanding_usd: 28999.99,
                date_emission: '2026-04-26', date_echeance: '2026-05-26',
                payment_status: 'PENDING', pdf_url: null, sent_at: null, sent_method: null,
                is_erratum: false, original_proforma_id: null, wave_tag: 'W1-3',
            },
            {
                vesselIdBySeedRef: new Map([['nav-001', {
                    id: 'eeeeeeee-0000-4000-8000-000000000001', name: 'RASHA', imoNumber: '9235957',
                }]]),
                shipownerIdBySeedRef: new Map([['arm-002', 'cccccccc-0000-4000-8000-000000000001']]),
                voyageBySeedRef: new Map([['voy-001', {
                    id: 'voy-001', navire_id: 'nav-001', port_origine: 'Dubai',
                    port_destination: 'Berbera', date_arrivee: '26/04/2026', date_depart: null,
                    distance_nm: 4500, vitesse_kn: 13, voyage_days: 14.4, carburant_type: 'HFO',
                    fuel_consumed_t: 465.6, co2_voyage_tco2: 1450, co2_facturable_tco2: 725,
                    contribution_usd: 28999.99, wave_tag: 'W1-3', status: 'AT_PORT',
                }]]),
            },
        );
        expect(txn.mode).toBe('MARITIME');
        expect(txn.transaction_type).toBe('ENTRY_TAX');
        expect(txn.document_type).toBe('PROFORMA');
        expect(txn.vessel_id).toBe('eeeeeeee-0000-4000-8000-000000000001');
        expect(txn.vessel_name).toBe('RASHA');
        expect(txn.vessel_imo).toBe('9235957');
        expect(txn.shipowner_id).toBe('cccccccc-0000-4000-8000-000000000001');
        expect(txn.emissions_tco2).toBe(725);
        expect(txn.tax_amount_usd).toBe(28999.99);
        expect(txn.rate_usd_per_tco2).toBe(40);
        expect(txn.status).toBe('PENDING');
        expect(txn.collections_status).toBe('CURRENT');
        expect(txn.created_at).toBe('2026-04-26');
        expect(txn.invoice_ref).toBe('PRO-2026-064001');
        const breakdown = txn.breakdown_json as Record<string, unknown>;
        expect(breakdown.source).toBe('onboarding_seed_v2');
        expect(breakdown.wave_tag).toBe('W1-3');
        expect(breakdown.voyage).toBeTruthy();
    });

    it('pro-forma maritime throw si le voyage référencé est absent du contexte', () => {
        expect(() => mapProformaMaritime(
            {
                id: 'pf-mar-x', reference: 'PRO-2026-000X', type: 'MARITIME',
                armateur_id: 'arm-002', navire_id: 'nav-001', voyage_ids: ['voy-missing'],
                total_usd: 100, total_paye_usd: 0, outstanding_usd: 100,
                date_emission: '2026-04-26', date_echeance: '2026-05-26',
                payment_status: 'PENDING', pdf_url: null, sent_at: null, sent_method: null,
                is_erratum: false, original_proforma_id: null, wave_tag: 'W1-3',
            },
            {
                vesselIdBySeedRef: new Map([['nav-001', {
                    id: 'e1', name: 'RASHA', imoNumber: '9235957',
                }]]),
                shipownerIdBySeedRef: new Map([['arm-002', 'c1']]),
                voyageBySeedRef: new Map(),
            },
        )).toThrow();
    });

    it('pro-forma maritime throw si le navire référencé est absent du contexte', () => {
        expect(() => mapProformaMaritime(
            {
                id: 'pf-mar-z', reference: 'PRO-2026-000Z', type: 'MARITIME',
                armateur_id: 'arm-002', navire_id: 'nav-missing', voyage_ids: ['voy-001'],
                total_usd: 100, total_paye_usd: 0, outstanding_usd: 100,
                date_emission: '2026-04-26', date_echeance: '2026-05-26',
                payment_status: 'PENDING', pdf_url: null, sent_at: null, sent_method: null,
                is_erratum: false, original_proforma_id: null, wave_tag: 'W1-3',
            },
            {
                vesselIdBySeedRef: new Map(),
                shipownerIdBySeedRef: new Map([['arm-002', 'c1']]),
                voyageBySeedRef: new Map([['voy-001', {
                    id: 'voy-001', navire_id: 'nav-001', port_origine: 'Dubai',
                    port_destination: 'Berbera', date_arrivee: '26/04/2026', date_depart: null,
                    distance_nm: 4500, vitesse_kn: 13, voyage_days: 14.4, carburant_type: 'HFO',
                    fuel_consumed_t: 465.6, co2_voyage_tco2: 1450, co2_facturable_tco2: 725,
                    contribution_usd: 28999.99, wave_tag: 'W1-3', status: 'AT_PORT',
                }]]),
            },
        )).toThrow();
    });

    it('pro-forma maritime: shipowner_id absent de la map → null (pas de throw, colonne nullable)', () => {
        const txn = mapProformaMaritime(
            {
                id: 'pf-mar-w', reference: 'PRO-2026-000W', type: 'MARITIME',
                armateur_id: 'arm-unknown', navire_id: 'nav-001', voyage_ids: ['voy-001'],
                total_usd: 100, total_paye_usd: 0, outstanding_usd: 100,
                date_emission: '2026-04-26', date_echeance: '2026-05-26',
                payment_status: 'PENDING', pdf_url: null, sent_at: null, sent_method: null,
                is_erratum: false, original_proforma_id: null, wave_tag: 'W1-3',
            },
            {
                vesselIdBySeedRef: new Map([['nav-001', { id: 'e1', name: 'RASHA', imoNumber: '9235957' }]]),
                shipownerIdBySeedRef: new Map(),
                voyageBySeedRef: new Map([['voy-001', {
                    id: 'voy-001', navire_id: 'nav-001', port_origine: 'Dubai',
                    port_destination: 'Berbera', date_arrivee: '26/04/2026', date_depart: null,
                    distance_nm: 4500, vitesse_kn: 13, voyage_days: 14.4, carburant_type: 'HFO',
                    fuel_consumed_t: 465.6, co2_voyage_tco2: 1450, co2_facturable_tco2: 725,
                    contribution_usd: 28999.99, wave_tag: 'W1-3', status: 'AT_PORT',
                }]]),
            },
        );
        expect(txn.shipowner_id).toBeNull();
    });

    it('pro-forma maritime throw si voyage_ids est vide', () => {
        expect(() => mapProformaMaritime(
            {
                id: 'pf-mar-y', reference: 'PRO-2026-000Y', type: 'MARITIME',
                armateur_id: 'arm-002', navire_id: 'nav-001', voyage_ids: [],
                total_usd: 100, total_paye_usd: 0, outstanding_usd: 100,
                date_emission: '2026-04-26', date_echeance: '2026-05-26',
                payment_status: 'PENDING', pdf_url: null, sent_at: null, sent_method: null,
                is_erratum: false, original_proforma_id: null, wave_tag: 'W1-3',
            },
            {
                vesselIdBySeedRef: new Map([['nav-001', { id: 'e1', name: 'RASHA', imoNumber: '9235957' }]]),
                shipownerIdBySeedRef: new Map([['arm-002', 'c1']]),
                voyageBySeedRef: new Map(),
            },
        )).toThrow();
    });

    it('pro-forma aviation → transaction mode AIR avec CO2eq RFI', () => {
        const txn = mapProformaAviation(
            {
                id: 'pf-avi-0001', reference: 'AVI-2026-0001', type: 'AVIATION',
                compagnie_id: 'avi-001',
                vol_details: { flight_no: 'ET-309', route: 'ADD-HGA', aircraft: 'B737-800', pax: 145, co2_voyage_tco2: 3.5, rfi: 2.0 },
                total_usd: 3040, total_paye_usd: 0, outstanding_usd: 3040,
                date_emission: '2026-06-01', date_echeance: '2026-07-01',
                payment_status: 'PENDING', pdf_url: null, sent_at: null, sent_method: null, is_erratum: false,
            },
            {
                aircraftIdByKey: new Map([['avi-001/B737-800', 'aaaaaaaa-0000-4000-8000-000000000001']]),
                shipownerIdBySeedRef: new Map([['avi-001', 'bbbbbbbb-0000-4000-8000-000000000001']]),
            },
        );
        expect(txn.mode).toBe('AIR');
        expect(txn.aircraft_id).toBe('aaaaaaaa-0000-4000-8000-000000000001');
        expect(txn.vessel_id).toBeNull();
        expect(txn.emissions_tco2).toBeCloseTo(7.0);
        expect(txn.tax_amount_usd).toBe(3040);
        expect(txn.invoice_ref).toBe('AVI-2026-0001');
        expect(txn.created_at).toBe('2026-06-01');
        expect(txn.vessel_name).toBe('ET-309');
        expect(txn.vessel_imo).toBe('B737-800');
        expect(txn.document_type).toBe('PROFORMA');
        const breakdown = txn.breakdown_json as Record<string, unknown>;
        expect(breakdown.source).toBe('onboarding_seed_v2');
        expect(breakdown.vol).toBeTruthy();
        expect(breakdown.wave_tag).toBeUndefined();
    });

    it('pro-forma aviation throw si aircraft absent du contexte', () => {
        expect(() => mapProformaAviation(
            {
                id: 'pf-avi-x', reference: 'AVI-2026-000X', type: 'AVIATION',
                compagnie_id: 'avi-001',
                vol_details: { flight_no: 'ET-309', route: 'ADD-HGA', aircraft: 'B737-900', pax: 145, co2_voyage_tco2: 3.5, rfi: 2.0 },
                total_usd: 3040, total_paye_usd: 0, outstanding_usd: 3040,
                date_emission: '2026-06-01', date_echeance: '2026-07-01',
                payment_status: 'PENDING', pdf_url: null, sent_at: null, sent_method: null, is_erratum: false,
            },
            {
                aircraftIdByKey: new Map(),
                shipownerIdBySeedRef: new Map([['avi-001', 'b1']]),
            },
        )).toThrow();
    });

    it('mapRelance résout transaction_id via proforma_id (clé seed id) et copie les champs de relance', () => {
        const txnIdByProformaSeedId = new Map([['pf-mar-064001', {
            transactionId: 'ffffffff-0000-4000-8000-000000000001',
            shipownerId: 'cccccccc-0000-4000-8000-000000000001',
        }]]);
        const row = mapRelance({
            id: 'rel-0001', proforma_id: 'pf-mar-064001', tier: 'J15',
            sent_at: '2026-05-15T09:00:00Z', sent_email: 'operations@example-armateur.com',
            cc_emails: ['n.kpatchavi@solidetechnology.com'], template_used: 'J15_amicale_reminder.html',
            armateur_response_at: null, armateur_response_type: 'SILENT', escalated_bailiff: false,
        }, txnIdByProformaSeedId);
        expect(row.transaction_id).toBe('ffffffff-0000-4000-8000-000000000001');
        expect(row.tier).toBe('J15');
        expect(row.sent_at).toBe('2026-05-15T09:00:00Z');
        expect(row.cc_emails).toEqual(['n.kpatchavi@solidetechnology.com']);
        expect(row.debtor_response_type).toBe('SILENT');
        expect(row.escalated_bailiff).toBe(false);
    });

    it('mapRelance throw si la proforma référencée est absente de la map', () => {
        expect(() => mapRelance({
            id: 'rel-9999', proforma_id: 'pf-mar-unknown', tier: 'J15',
            sent_at: '2026-05-15T09:00:00Z', sent_email: 'ops@example.com',
            cc_emails: [], template_used: 'J15_amicale_reminder.html',
            armateur_response_at: null, armateur_response_type: 'SILENT', escalated_bailiff: false,
        }, new Map())).toThrow();
    });

    it('mapPaiement convertit le montant en cents et confirme le paiement', () => {
        const txnIdByProformaSeedId = new Map([['pf-mar-064001', {
            transactionId: 'ffffffff-0000-4000-8000-000000000001',
            shipownerId: 'cccccccc-0000-4000-8000-000000000001',
        }]]);
        const row = mapPaiement({
            id: 'pay-001', proforma_id: 'pf-mar-064001', montant_usd: 3985.12,
            date_recu: '2026-05-08', methode: 'SWIFT', reference_bancaire: 'SWIFT-20260508-STL-001',
            banque_emettrice: 'Bank of Cyprus Ltd', confirmation_pdf: 'https://greengate.so/payments/pay-001.pdf',
            notes: 'Premier paiement historique',
        }, txnIdByProformaSeedId, 'ffffffff-0000-4000-8000-000000000099');
        expect(row.amount_minor).toBe(398512);
        expect(row.amount_usd_minor).toBe(398512);
        expect(row.currency).toBe('USD');
        // CHECK payments_currency_amount_consistent (migration 048) exige
        // fx_rate NULL quand currency='USD'.
        expect(row.fx_rate).toBeNull();
        expect(row.rail).toBe('WIRE_TRANSFER');
        expect(row.status).toBe('CONFIRMED');
        expect(row.confirmed_by).toBe('ffffffff-0000-4000-8000-000000000099');
        expect(row.declared_by).toBe('ffffffff-0000-4000-8000-000000000099');
        expect(row.confirmed_at).toBe('2026-05-08');
        expect(row.external_reference).toBe('SWIFT-20260508-STL-001');
        expect(row.transaction_id).toBe('ffffffff-0000-4000-8000-000000000001');
        expect(row.shipowner_id).toBe('cccccccc-0000-4000-8000-000000000001');
        expect((row.rail_details as { seed_ref: string }).seed_ref).toBe('pay-001');
    });

    it('mapPaiement porte le seed id dans rail_details.seed_ref même sans référence bancaire (dédup 2e run)', () => {
        const txnIdByProformaSeedId = new Map([['pf-mar-064001', {
            transactionId: 'ffffffff-0000-4000-8000-000000000001',
            shipownerId: 'cccccccc-0000-4000-8000-000000000001',
        }]]);
        const row = mapPaiement({
            id: 'pay-002', proforma_id: 'pf-mar-064001', montant_usd: 500,
            date_recu: '2026-05-09', methode: 'CASH', reference_bancaire: null,
            banque_emettrice: null, confirmation_pdf: null, notes: 'Paiement cash sans référence',
        }, txnIdByProformaSeedId, 'ffffffff-0000-4000-8000-000000000099');
        expect(row.external_reference).toBeNull();
        expect((row.rail_details as { seed_ref: string }).seed_ref).toBe('pay-002');
    });

    it('mapPaiement throw si la proforma référencée est absente de la map', () => {
        expect(() => mapPaiement({
            id: 'pay-999', proforma_id: 'pf-mar-unknown', montant_usd: 100,
            date_recu: '2026-05-08', methode: 'SWIFT', reference_bancaire: 'REF-1',
            banque_emettrice: 'Bank', confirmation_pdf: null, notes: null,
        }, new Map(), 'confirmed-by-id')).toThrow();
    });
});
