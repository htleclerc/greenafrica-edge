import { isValidImo } from './imo';

export type VesselCategory =
    | 'CONTAINER' | 'CARGO' | 'TANKER' | 'BULK_CARRIER' | 'FERRY' | 'NAVAL' | 'SCIENTIFIC';

export interface VesselFinderCandidate {
    imoNumber: string;
    mmsi: string | null;
    callSign: string | null;
    vesselName: string;
    flagCode: string;
    typeRaw: string;
    category: VesselCategory;
    grossTonnage: number | null;
    deadweight: number | null;
    buildYear: number | null;
    managerName: string | null;
    managerCountry: string | null;
    managerEmail: string | null;
    ownerName: string | null;
    ownerCountry: string | null;
    ownerEmail: string | null;
    ismManagerName: string | null;
    ismManagerEmail: string | null;
    /** `DATE TIME (UTC)` du mouvement le plus récent retenu pour ce navire. */
    lastSeenAt: string;
}

export interface RejectedRow {
    lineNumber: number;
    vesselName: string;
    reason: string;
}

export interface ParseResult {
    candidates: VesselFinderCandidate[];
    rejected: RejectedRow[];
    rowsRead: number;
}

/**
 * Index des colonnes exploitées. La lecture est POSITIONNELLE : l'en-tête de
 * VesselFinder contient `TYPE` deux fois (4 = code AIS, 14 = libellé) et
 * `DRAUGHT` deux fois (5 = tirant du mouvement, 22 = tirant maximal). Un accès
 * par nom perdrait silencieusement l'une des deux valeurs.
 */
const COL = {
    MMSI: 0, IMO: 1, SHIP_NAME: 2, DATE_TIME: 5, EVENT: 6, LOCODE: 8,
    CALLSIGN: 9, BUILT: 10, FLAG: 11, TYPENAME: 14, GT: 16, DWT: 17, LOA: 18, LPP: 19,
    MANAGER_NAME: 24, MANAGER_COUNTRY: 25, MANAGER_EMAIL: 28,
    OWNER_NAME: 31, OWNER_COUNTRY: 32, OWNER_EMAIL: 35,
    ISM_NAME: 38, ISM_EMAIL: 42,
} as const;

/** Colonnes dont la présence à l'index attendu atteste du bon gabarit. */
const HEADER_GUARD: ReadonlyArray<readonly [number, string]> = [
    [COL.MMSI, 'MMSI'], [COL.IMO, 'IMO'], [COL.SHIP_NAME, 'SHIP NAME'],
    [COL.DATE_TIME, 'DATE TIME (UTC)'], [COL.EVENT, 'EVENT'],
    [COL.TYPENAME, 'TYPENAME'], [COL.GT, 'GT'], [COL.DWT, 'DWT'],
    [COL.MANAGER_EMAIL, 'MANAGER_EMAIL'], [COL.OWNER_EMAIL, 'OWNER_EMAIL'],
    [COL.ISM_EMAIL, 'ISM_MANAGER_EMAIL'],
];

/**
 * Correspondance TYPENAME → catégorie fiscale. Volontairement SANS valeur par
 * défaut : `mapVesselCategory` de l'import onboarding retombe sur 'CARGO', ce qui
 * classerait un pétrolier en cargo et fausserait la taxe. Ici un libellé inconnu
 * rejette la ligne et impose une décision humaine.
 */
export const CATEGORY_BY_TYPENAME: Readonly<Record<string, VesselCategory>> = {
    'Bulk Carrier': 'BULK_CARRIER',
    'Container Ship': 'CONTAINER',
    'General Cargo Ship': 'CARGO',
    'Deck Cargo Ship': 'CARGO',
    'Ro-Ro Cargo Ship': 'CARGO',
    'Palletised Cargo Ship': 'CARGO',
    'Refrigerated Cargo Ship': 'CARGO',
    'Livestock Carrier': 'CARGO',
    'Landing Craft': 'CARGO',
    'Tug': 'CARGO',
    'Oil Products Tanker': 'TANKER',
    'Chemical/Oil Products Tanker': 'TANKER',
    'LPG Tanker': 'TANKER',
};

/** Découpe une ligne CSV en respectant les guillemets (adresses contenant des virgules). */
function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            if (quoted && line[i + 1] === '"') { field += '"'; i += 1; }
            else quoted = !quoted;
        } else if (ch === ',' && !quoted) {
            out.push(field);
            field = '';
        } else {
            field += ch;
        }
    }
    out.push(field);
    return out;
}

const clean = (v: string | undefined): string | null => {
    const t = (v ?? '').trim().replace(/\s+/g, ' ');
    return t === '' ? null : t;
};

const num = (v: string | undefined): number | null => {
    const t = (v ?? '').trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
};

const email = (v: string | undefined): string | null => {
    const t = clean(v);
    return t && t.includes('@') ? t.toLowerCase() : null;
};

function assertHeader(cells: string[]): void {
    for (const [index, label] of HEADER_GUARD) {
        if ((cells[index] ?? '').trim().replace(/^"|"$/g, '') !== label) {
            throw new Error(
                `Export VesselFinder : en-tête inattendu — colonne ${index} devrait être « ${label} », ` +
                `trouvé « ${(cells[index] ?? '').trim()} ». Le fichier n'est pas un export d'escales.`,
            );
        }
    }
}

export function parseVesselFinderPortCalls(csv: string): ParseResult {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) throw new Error('Export VesselFinder : fichier vide');
    assertHeader(splitCsvLine(lines[0]));

    const byImo = new Map<string, VesselFinderCandidate>();
    const rejected: RejectedRow[] = [];
    let rowsRead = 0;

    for (let i = 1; i < lines.length; i += 1) {
        rowsRead += 1;
        const lineNumber = i + 1;
        const c = splitCsvLine(lines[i]);
        const vesselName = clean(c[COL.SHIP_NAME]) ?? '(sans nom)';
        const reject = (reason: string) => rejected.push({ lineNumber, vesselName, reason });

        const imoRaw = (c[COL.IMO] ?? '').trim();
        if (imoRaw === '' || imoRaw === '0') { reject('IMO absent ou nul'); continue; }
        if (!isValidImo(imoRaw)) { reject('somme de contrôle IMO invalide'); continue; }

        const flag = clean(c[COL.FLAG]);
        if (!flag || !/^[A-Z]{2}$/.test(flag)) {
            reject(`pavillon non ISO-2 : ${flag ?? '(vide)'}`); continue;
        }

        const typeRaw = clean(c[COL.TYPENAME]);
        const category = typeRaw ? CATEGORY_BY_TYPENAME[typeRaw] : undefined;
        if (!typeRaw || !category) {
            reject(`type de navire inconnu : ${typeRaw ?? '(vide)'}`); continue;
        }

        const loa = num(c[COL.LOA]);
        const lpp = num(c[COL.LPP]);
        if (loa !== null && lpp !== null && lpp > 0 && loa < lpp) {
            reject('LOA inférieure à LPP'); continue;
        }

        const lastSeenAt = clean(c[COL.DATE_TIME]) ?? '';
        const candidate: VesselFinderCandidate = {
            imoNumber: imoRaw,
            mmsi: clean(c[COL.MMSI]),
            callSign: clean(c[COL.CALLSIGN]),
            vesselName,
            flagCode: flag,
            typeRaw,
            category,
            grossTonnage: num(c[COL.GT]),
            deadweight: num(c[COL.DWT]),
            buildYear: num(c[COL.BUILT]),
            managerName: clean(c[COL.MANAGER_NAME]),
            managerCountry: clean(c[COL.MANAGER_COUNTRY]),
            managerEmail: email(c[COL.MANAGER_EMAIL]),
            ownerName: clean(c[COL.OWNER_NAME]),
            ownerCountry: clean(c[COL.OWNER_COUNTRY]),
            ownerEmail: email(c[COL.OWNER_EMAIL]),
            ismManagerName: clean(c[COL.ISM_NAME]),
            ismManagerEmail: email(c[COL.ISM_EMAIL]),
            lastSeenAt,
        };

        const previous = byImo.get(imoRaw);
        if (!previous || candidate.lastSeenAt > previous.lastSeenAt) {
            byImo.set(imoRaw, candidate);
        }
    }

    return { candidates: [...byImo.values()], rejected, rowsRead };
}

/**
 * Forme minimale acceptée par `resolveBillingEmail`. Volontairement structurelle
 * plutôt que liée à `VesselFinderCandidate` : les trois appelants ont des formes
 * différentes (candidat du parseur, ligne `vessel_identity_candidates` en
 * snake_case côté action, ligne projetée côté écran) et doivent tous pouvoir
 * traverser la MÊME fonction — c'est le sens du regroupement.
 */
export interface BillingContactSource {
    managerEmail: string | null;
    ownerEmail: string | null;
    ismManagerEmail: string | null;
    /** Absent ⇒ non bloqué. Un candidat sous sanctions n'a JAMAIS de destinataire. */
    contactBlocked?: boolean;
}

/**
 * Destinataire de facturation (décision D4 de la spec) : le manager d'abord.
 * Mesuré sur l'export réel : manager 32 navires, owner 1, ISM 14 — l'owner est
 * presque toujours une société mono-navire domiciliée chez un trust, sans e-mail.
 *
 * SOURCE UNIQUE de la règle. Elle porte aussi la garde sanctions : un candidat
 * `contactBlocked` ne rend aucune adresse, quelle que soit la société qui la
 * porte. Sans cette garde, la fonction restituait l'adresse de Morgan Navigation
 * (`arm-013`, UN) à qui l'appelait.
 */
export function resolveBillingEmail(c: BillingContactSource): string | null {
    if (c.contactBlocked) return null;
    return c.managerEmail ?? c.ownerEmail ?? c.ismManagerEmail ?? null;
}
