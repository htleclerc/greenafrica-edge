import { describe, it, expect } from 'vitest';
import { parseVesselFinderPortCalls, resolveBillingEmail } from './vesselFinderParser';

const HEADER =
    '"MMSI","IMO","SHIP NAME","TYPE","DRAUGHT","DATE TIME (UTC)","EVENT","PORT NAME","LOCODE",' +
    'CALLSIGN,BUILT,FLAG,FLAGNAME,TYPE,TYPENAME,STATUS,GT,DWT,LOA,LPP,BEAM,DRAUGHT,CLASS,CLASSCODE,' +
    'MANAGER_NAME,MANAGER_COUNTRY,MANAGER_ADDRESS,MANAGER_WEB,MANAGER_EMAIL,MANAGER_PHONE,MANAGER_FAX,' +
    'OWNER_NAME,OWNER_COUNTRY,OWNER_ADDRESS,OWNER_WEB,OWNER_EMAIL,OWNER_PHONE,OWNER_FAX,' +
    'ISM_MANAGER_NAME,ISM_MANAGER_COUNTRY,ISM_MANAGER_ADDRESS,ISM_MANAGER_WEB,ISM_MANAGER_EMAIL,' +
    'ISM_MANAGER_PHONE,ISM_MANAGER_FAX,PI_COMPANY,PI_INCEPTION';

/** TRUST 1 — manager porteur de l\'e-mail, owner sans adresse. LOA 55 < LPP 74 dans la source réelle. */
const TRUST1 = (dateTime: string, loa = '74', lpp = '55') =>
    `671882000,7504158,"TRUST 1",70,5.0,"${dateTime}","ENTER_ZONE","Berbera Anch.","SOBBO",5VEV4,1975,TG,Togo,A38A,Livestock Carrier,IN SERVICE/COMMISSION,2975,2560,${loa},${lpp},12,5,COLUMBUS AMERICAN REGISTER,CAR,` +
    `FAROS SHIPPING CO SARL,LB,"Office 54, Beirut, Lebanon.",http://www.farosshipping.com,faros@farosshipping.example,+99 1 1036,+961 1 566476,` +
    `UNIVERSAL SHIPPING & LOGISTIC,LB,"C/O: Faros Shipping Co Sarl, Beirut.",,,+99 1 1036,+961 1 566476,` +
    `FAROS SHIPPING CO SARL,LB,"Office 54, Beirut, Lebanon.",http://www.farosshipping.com,faros@farosshipping.example,+99 1 1036,+961 1 566476,,0000-00-00`;

/** MAYAR — ni manager ni owner joignables, seul l\'ISM manager porte une adresse. */
const MAYAR =
    `341264001,9167057,"MAYAR",70,6.4,"2026-05-01 07:33:31","EXIT_ZONE","Berbera Anch.","SOBBO",V4LK5,1998,KN,Saint Kitts & Nevis,A38A,Livestock Carrier,IN SERVICE/COMMISSION,4752,4200,103.1,96.86,16.8,6.25,REGISTRO ITALIANO NAVALE,RINA,` +
    `LEVANTE MARITTIMO CO,MH,"Majuro, Marshall Islands.",,,,,` +
    `LEVANTE MARITTIMO CO,MH,"Majuro, Marshall Islands.",,,,,` +
    `MORGAN NAVIGATION CO SA,LB,"Beirut, Lebanon.",,morgan.navigation@mail.example,+99 1 1039,,North of England P&I Association,2022-06-09`;

/** Boutre local : IMO 0, aucune particularité. */
const NAFISA =
    '417078690,0,"NAFISA",90,0.0,"2026-05-02 04:19:37","EXIT_ZONE","Berbera","SOBBO",,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,';

const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');

describe('parseVesselFinderPortCalls', () => {
    it('lit les colonnes par index malgré les doublons TYPE et DRAUGHT', () => {
        const r = parseVesselFinderPortCalls(csv(TRUST1('2026-05-01 05:21:13')));
        expect(r.candidates).toHaveLength(1);
        const c = r.candidates[0];
        expect(c.imoNumber).toBe('7504158');
        expect(c.mmsi).toBe('671882000');
        expect(c.callSign).toBe('5VEV4');
        expect(c.vesselName).toBe('TRUST 1');
        expect(c.flagCode).toBe('TG');
        expect(c.typeRaw).toBe('Livestock Carrier');
        expect(c.category).toBe('CARGO');
        expect(c.buildYear).toBe(1975);
    });

    it('mappe GT et DWT sur des champs distincts', () => {
        const c = parseVesselFinderPortCalls(csv(TRUST1('2026-05-01 05:21:13'))).candidates[0];
        expect(c.grossTonnage).toBe(2975);
        expect(c.deadweight).toBe(2560);
    });

    it('extrait les trois contacts', () => {
        const c = parseVesselFinderPortCalls(csv(TRUST1('2026-05-01 05:21:13'))).candidates[0];
        expect(c.managerName).toBe('FAROS SHIPPING CO SARL');
        expect(c.managerEmail).toBe('faros@farosshipping.example');
        expect(c.ownerName).toBe('UNIVERSAL SHIPPING & LOGISTIC');
        expect(c.ownerEmail).toBeNull();
        expect(c.ismManagerName).toBe('FAROS SHIPPING CO SARL');
    });

    it('déduplique par IMO en gardant le mouvement le plus récent', () => {
        const r = parseVesselFinderPortCalls(
            csv(TRUST1('2026-05-01 05:21:13'), TRUST1('2026-07-19 15:12:19'), TRUST1('2026-06-11 08:50:14')),
        );
        expect(r.rowsRead).toBe(3);
        expect(r.candidates).toHaveLength(1);
        expect(r.candidates[0].lastSeenAt).toBe('2026-07-19 15:12:19');
    });

    it('rejette les engins sans IMO avec un motif', () => {
        const r = parseVesselFinderPortCalls(csv(NAFISA));
        expect(r.candidates).toHaveLength(0);
        expect(r.rejected).toEqual([
            { lineNumber: 2, vesselName: 'NAFISA', reason: 'IMO absent ou nul' },
        ]);
    });

    it('rejette une somme de contrôle IMO invalide', () => {
        const bad = TRUST1('2026-05-01 05:21:13').replace('7504158', '7504159');
        const r = parseVesselFinderPortCalls(csv(bad));
        expect(r.candidates).toHaveLength(0);
        expect(r.rejected[0].reason).toBe('somme de contrôle IMO invalide');
    });

    it('rejette une incohérence dimensionnelle LOA < LPP', () => {
        const r = parseVesselFinderPortCalls(csv(TRUST1('2026-05-01 05:21:13', '55', '74')));
        expect(r.candidates).toHaveLength(0);
        expect(r.rejected[0].reason).toBe('LOA inférieure à LPP');
    });

    it('rejette un TYPENAME inconnu du référentiel fiscal', () => {
        const r = parseVesselFinderPortCalls(
            csv(TRUST1('2026-05-01 05:21:13').replace(',Livestock Carrier,', ',Submersible Drilling Rig,')),
        );
        expect(r.rejected[0].reason).toBe('type de navire inconnu : Submersible Drilling Rig');
    });

    it('rejette un pavillon hors ISO-3166 alpha-2', () => {
        const r = parseVesselFinderPortCalls(csv(TRUST1('2026-05-01 05:21:13').replace(',TG,Togo,', ',TOGO,Togo,')));
        expect(r.rejected[0].reason).toBe('pavillon non ISO-2 : TOGO');
    });

    it('normalise les noms sales de la source', () => {
        const dirty = TRUST1('2026-05-01 05:21:13').replace('"TRUST 1"', '" TRUST   1 "');
        expect(parseVesselFinderPortCalls(csv(dirty)).candidates[0].vesselName).toBe('TRUST 1');
    });

    it('refuse un en-tête non conforme au gabarit', () => {
        expect(() => parseVesselFinderPortCalls('MMSI,IMO,NAME\n1,2,3')).toThrow(
            /en-tête inattendu/i,
        );
    });
});

describe('resolveBillingEmail', () => {
    const base = parseVesselFinderPortCalls(csv(TRUST1('2026-05-01 05:21:13'))).candidates[0];

    it('préfère le manager', () => {
        expect(resolveBillingEmail(base)).toBe('faros@farosshipping.example');
    });

    it('retombe sur l\'owner puis sur l\'ISM manager', () => {
        expect(resolveBillingEmail({ ...base, managerEmail: null, ownerEmail: 'o@x.com' })).toBe('o@x.com');
        expect(
            resolveBillingEmail({ ...base, managerEmail: null, ownerEmail: null, ismManagerEmail: 'i@x.com' }),
        ).toBe('i@x.com');
    });

    it('renvoie null quand aucun contact n\'est joignable', () => {
        expect(
            resolveBillingEmail({ ...base, managerEmail: null, ownerEmail: null, ismManagerEmail: null }),
        ).toBeNull();
    });

    it('résout MAYAR par l\'ISM manager tant qu\'aucune sanction n\'est constatée', () => {
        const mayar = parseVesselFinderPortCalls(csv(MAYAR)).candidates[0];
        expect(resolveBillingEmail(mayar)).toBe('morgan.navigation@mail.example');
    });

    it('ne rend JAMAIS l\'adresse d\'un candidat sous sanctions', () => {
        // MAYAR est joignable par MORGAN NAVIGATION CO SA (arm-013, liste UN).
        // Une fois le candidat marqué par la garde sanctions, la règle de
        // destinataire doit rendre null — c'est la même fonction qui sert les
        // trois appelants, la garde ne peut donc plus être oubliée nulle part.
        const mayar = parseVesselFinderPortCalls(csv(MAYAR)).candidates[0];
        expect(resolveBillingEmail({ ...mayar, contactBlocked: true })).toBeNull();
    });
});
