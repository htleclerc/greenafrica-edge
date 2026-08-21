/**
 * Lecture du référentiel de la campagne de recouvrement du 19/08/2026.
 *
 * L'entrée canonique est `cons_refs_mapping.csv` du paquet
 * ProFormas_OFFICIEL_19aout2026 — pas le classeur de suivi : même contenu,
 * encodage sain, et il porte déjà le lien dossier ↔ navires. Le détail par
 * navire vient de la feuille « Détail Navires » du classeur, transmise ici
 * sous forme de tableau de lignes.
 */

export interface ConsDossier {
    consRef: string;
    fleetManager: string;
    nVessels: number;
    totalUsd: number;
    contactEmail: string | null;
    /** Adresses complémentaires (propriétaire) — contacts, pas débiteurs. */
    secondaryEmails: string[];
    phone: string | null;
    address: string | null;
    country: string | null;
    ownerName: string | null;
    piClub: string | null;
    vessels: string[];
}

export interface VesselLine {
    invoiceRef: string;
    consRef: string;
    name: string;
    imo: string | null;
    mmsi: string | null;
    flag: string | null;
    grossTonnage: number | null;
    buildYear: number | null;
    portCalls: number;
    emissionsTco2: number;
    amountUsd: number;
}

/**
 * Morgan Navigation (UN), Barbara/Yassin et Petrofleet (OFAC). Jamais de
 * contact direct : saisie in rem via Me Eidle Omer. La liste est figée ici
 * pour que l'import n'ait pas à la déduire de champs libres.
 */
export const SANCTIONED_CONS_REFS = [
    'PRO-CONS-2026-001',
    'PRO-CONS-2026-022',
    'PRO-CONS-2026-042',
] as const;

/** Découpe une ligne CSV en respectant les guillemets et les virgules internes. */
function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
            if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; }
            else quoted = !quoted;
        } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
        else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
}

function orNull(v: string | undefined | null): string | null {
    const s = String(v ?? '').trim();
    return s === '' ? null : s;
}

/**
 * Convertit un montant du classeur. Les cellules exportées portent des
 * espaces insécables fines (U+202F) et une virgule décimale — les laisser
 * passer produirait NaN, donc un import silencieusement faux.
 */
function toNumber(v: unknown): number {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const n = Number(
        String(v ?? '')
            .replace(/[  \s]/g, '')
            .replace(',', '.'),
    );
    return Number.isFinite(n) ? n : 0;
}

export function parseConsRefs(csv: string): ConsDossier[] {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
    const header = splitCsvLine(lines[0]);
    const at = (row: string[], name: string): string => row[header.indexOf(name)] ?? '';

    return lines.slice(1).map((line) => {
        const r = splitCsvLine(line);
        const consRef = at(r, 'cons_ref');
        const vessels = at(r, 'vessels')
            .split('|').map((v) => v.trim()).filter((v) => v !== '');
        const nVessels = toNumber(at(r, 'n_vessels'));

        // Un écart entre le compte annoncé et la liste signale un fichier
        // tronqué ou mal exporté. On refuse plutôt que d'importer à moitié
        // un portefeuille de 1 316 124,00 USD.
        if (vessels.length !== nVessels) {
            throw new Error(
                `${consRef}: n_vessels=${nVessels} mais ${vessels.length} navire(s) listés`,
            );
        }

        const secondaryEmails = at(r, 'owner_email')
            .split(/[;,]/).map((e) => e.trim()).filter((e) => e.includes('@'));

        return {
            consRef,
            fleetManager: at(r, 'fleet_manager'),
            nVessels,
            totalUsd: toNumber(at(r, 'total_usd')),
            contactEmail: orNull(at(r, 'contact_email')),
            secondaryEmails,
            phone: orNull(at(r, 'contact_phone')),
            address: orNull(at(r, 'contact_address')),
            country: orNull(at(r, 'contact_country')),
            ownerName: orNull(at(r, 'owner_name')),
            piClub: orNull(at(r, 'pi_club')),
            vessels,
        };
    });
}

/**
 * Lit la feuille « Suivi Armateurs » du classeur — la source FAISANT FOI
 * pour les contacts.
 *
 * `cons_refs_mapping.csv` est un export à perte : il omet trois adresses
 * principales (PRO-CONS-012, -021, -022) et n'a aucune colonne équivalente
 * aux « Emails secondaires ». L'omission de PRO-CONS-2026-021
 * (faros@farosshipping.example) laisserait Leaders for Trading — 19 843,20 USD —
 * sans contact et donc sans compte. Le CSV ne sert plus qu'au contrôle de
 * concordance (`reconcileWithCsv`).
 */
export function parseSuiviArmateurs(rows: unknown[][]): ConsDossier[] {
    const header = rows[0].map((h) => String(h ?? '').trim());
    const idx = (name: string): number => header.indexOf(name);

    return rows.slice(1)
        .filter((r) => String(r[0] ?? '').startsWith('PRO-CONS-'))
        .map((r) => {
            const consRef = String(r[idx('Réf. consolidée')]).trim();
            const vessels = String(r[idx('Navires')] ?? '')
                .split('|').map((v) => v.trim()).filter((v) => v !== '');
            const nVessels = toNumber(r[idx('Nb navires')]);

            if (vessels.length !== nVessels) {
                throw new Error(
                    `${consRef}: Nb navires=${nVessels} mais ${vessels.length} navire(s) listés`,
                );
            }

            const secondaryEmails = String(r[idx('Emails secondaires')] ?? '')
                .split(/[;,]/).map((e) => e.trim()).filter((e) => e.includes('@'));

            return {
                consRef,
                fleetManager: String(r[idx('Fleet Manager / Armateur')]).trim(),
                nVessels,
                totalUsd: toNumber(r[idx('Montant dû (USD)')]),
                contactEmail: orNull(r[idx('Email contact')] as string),
                secondaryEmails,
                phone: orNull(r[idx('Téléphone')] as string),
                address: orNull(r[idx('Adresse')] as string),
                country: orNull(r[idx('Pays')] as string),
                ownerName: orNull(r[idx('Propriétaire (Owner)')] as string),
                piClub: orNull(r[idx('P&I Club')] as string),
                vessels,
            };
        });
}

/**
 * Confronte le classeur au CSV du paquet de pro-formas.
 *
 * Les deux fichiers ont été produits séparément ; leur accord sur le nombre
 * de dossiers, de navires et sur le total est la garantie qu'on n'importe pas
 * un export tronqué. Les divergences de contacts sont ATTENDUES — le CSV est
 * à perte — et rendues en clair plutôt que traitées comme des erreurs.
 */
export function reconcileWithCsv(
    fromXlsx: ConsDossier[],
    fromCsv: ConsDossier[],
): { ok: boolean; problems: string[]; contactsOnlyInXlsx: string[] } {
    const problems: string[] = [];
    const sum = (d: ConsDossier[]) => d.reduce((s, x) => s + x.totalUsd, 0);
    const vessels = (d: ConsDossier[]) => d.reduce((s, x) => s + x.vessels.length, 0);

    if (fromXlsx.length !== fromCsv.length) {
        problems.push(`nombre de dossiers : classeur ${fromXlsx.length}, CSV ${fromCsv.length}`);
    }
    if (vessels(fromXlsx) !== vessels(fromCsv)) {
        problems.push(`nombre de navires : classeur ${vessels(fromXlsx)}, CSV ${vessels(fromCsv)}`);
    }
    if (Math.abs(sum(fromXlsx) - sum(fromCsv)) > 0.01) {
        problems.push(`total : classeur ${sum(fromXlsx).toFixed(2)}, CSV ${sum(fromCsv).toFixed(2)}`);
    }

    const csvByRef = new Map(fromCsv.map((d) => [d.consRef, d]));
    const contactsOnlyInXlsx = fromXlsx
        .filter((d) => d.contactEmail && !csvByRef.get(d.consRef)?.contactEmail)
        .map((d) => d.consRef);

    return { ok: problems.length === 0, problems, contactsOnlyInXlsx };
}

export function parseVesselDetail(rows: unknown[][]): VesselLine[] {
    const header = rows[0].map((h) => String(h ?? '').trim());
    const idx = (name: string): number => header.indexOf(name);

    return rows.slice(1)
        // La feuille se termine par une ligne TOTAL qui n'est pas un navire.
        .filter((r) => String(r[idx('Réf. pro-forma')] ?? '').startsWith('PRO-2026-'))
        .map((r) => ({
            invoiceRef: String(r[idx('Réf. pro-forma')]).trim(),
            consRef: String(r[idx('Réf. consolidée')]).trim(),
            name: String(r[idx('Navire')]).trim(),
            imo: orNull(r[idx('IMO')] as string),
            mmsi: orNull(r[idx('MMSI')] as string),
            flag: orNull(r[idx('Pavillon')] as string),
            grossTonnage: toNumber(r[idx('GT')]) || null,
            buildYear: toNumber(r[idx('Built')]) || null,
            portCalls: toNumber(r[idx('Nb escales')]),
            emissionsTco2: toNumber(r[idx('tCO2 facturé')]),
            amountUsd: toNumber(r[idx('Montant (USD)')]),
        }));
}
