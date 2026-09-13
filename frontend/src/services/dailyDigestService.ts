/**
 * Récapitulatif quotidien d'exploitation — agrégation pure.
 *
 * Ce module ne parle ni à la base ni au courrier : il reçoit des lignes et rend
 * le contenu du récapitulatif. C'est ce qui permet de le tester sans base, et
 * surtout de vérifier les TOTAUX, qui sont la seule chose que le destinataire
 * lit vraiment.
 *
 * Deux mesures distinctes, à ne pas confondre :
 *   — les pro-formas ÉMISES sur la période sont celles dont `proforma_sent_at`
 *     tombe dans la fenêtre. Pas `created_at` : une créance enregistrée n'est
 *     pas une créance notifiée, et les 41 lignes versées le 10 septembre sont
 *     précisément en base sans avoir été envoyées.
 *   — les paiements REÇUS sont les `CONFIRMED` sur la période. Une déclaration
 *     en attente n'est pas un encaissement ; elle est comptée à part, parce
 *     qu'un récapitulatif qui la tait laisse croire que rien n'arrive.
 */

/** Bornes de la période couverte, en ISO 8601. */
export interface DigestWindow {
    startIso: string;
    endIso: string;
    /** Jour couvert, en AAAA-MM-JJ, pour l'objet du message. */
    label: string;
}

export interface ProformaRow {
    invoice_ref: string | null;
    ref: string | null;
    mode: string | null;
    vessel_name: string | null;
    tax_amount_usd: number | null;
    proforma_sent_at: string | null;
}

export interface PaymentRow {
    receipt_ref: string | null;
    amount_usd_minor: number | null;
    rail: string | null;
    status: string | null;
    confirmed_at: string | null;
    created_at: string | null;
}

export interface DigestLine {
    ref: string;
    label: string;
    amountUsd: number;
    at: string;
}

export interface DigestSection {
    lines: DigestLine[];
    count: number;
    totalUsd: number;
}

export interface DailyDigest {
    window: DigestWindow;
    maritime: DigestSection;
    air: DigestSection;
    /** Total des pro-formas émises, tous modes. */
    issuedTotalUsd: number;
    issuedCount: number;
    payments: DigestSection;
    /** Déclarations reçues mais pas encore confirmées, sur la même période. */
    pendingPayments: DigestSection;
    /** Vrai si absolument rien ne s'est passé — le message le dit alors. */
    empty: boolean;
}

/**
 * Fenêtre du jour civil précédent, en UTC.
 *
 * Un récapitulatif quotidien doit couvrir une journée entière et fermée. Faire
 * glisser une fenêtre de 24 h sur l'heure du déclenchement ferait basculer un
 * même envoi d'un récapitulatif à l'autre au gré des minutes de retard du cron.
 */
export function previousDayWindow(now: Date): DigestWindow {
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const start = new Date(end.getTime() - 86_400_000);
    return {
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        label: start.toISOString().slice(0, 10),
    };
}

function usdFromMinor(minor: number | null): number {
    return Math.round((minor ?? 0)) / 100;
}

function section(lines: DigestLine[]): DigestSection {
    const totalUsd = lines.reduce((acc, l) => acc + l.amountUsd, 0);
    return {
        lines,
        count: lines.length,
        // Les montants viennent de colonnes numériques ; on arrondit au cent
        // pour que le total affiché soit exactement la somme des lignes lues.
        totalUsd: Math.round(totalUsd * 100) / 100,
    };
}

/** Trie du plus récent au plus ancien — ce qui vient d'arriver se lit en premier. */
function byMostRecent(a: DigestLine, b: DigestLine): number {
    return b.at.localeCompare(a.at);
}

export function buildDailyDigest(
    window: DigestWindow,
    proformas: ProformaRow[],
    payments: PaymentRow[],
): DailyDigest {
    const maritimeLines: DigestLine[] = [];
    const airLines: DigestLine[] = [];

    for (const p of proformas) {
        if (!p.proforma_sent_at) continue;
        const line: DigestLine = {
            ref: p.invoice_ref ?? p.ref ?? '—',
            label: p.vessel_name ?? '—',
            amountUsd: p.tax_amount_usd ?? 0,
            at: p.proforma_sent_at,
        };
        // Le mode est une colonne NOT NULL, mais une ligne ancienne ou importée
        // peut le porter vide : on la range au maritime, jamais on ne la perd.
        if ((p.mode ?? 'MARITIME').toUpperCase() === 'AIR') airLines.push(line);
        else maritimeLines.push(line);
    }

    const confirmedLines: DigestLine[] = [];
    const pendingLines: DigestLine[] = [];
    for (const pay of payments) {
        const status = (pay.status ?? '').toUpperCase();
        const at = pay.confirmed_at ?? pay.created_at ?? '';
        const line: DigestLine = {
            ref: pay.receipt_ref ?? '—',
            label: pay.rail ?? '—',
            amountUsd: usdFromMinor(pay.amount_usd_minor),
            at,
        };
        if (status === 'CONFIRMED') confirmedLines.push(line);
        else if (status === 'INITIATED' || status === 'PROCESSING') pendingLines.push(line);
    }

    maritimeLines.sort(byMostRecent);
    airLines.sort(byMostRecent);
    confirmedLines.sort(byMostRecent);
    pendingLines.sort(byMostRecent);

    const maritime = section(maritimeLines);
    const air = section(airLines);
    const paid = section(confirmedLines);
    const pending = section(pendingLines);

    return {
        window,
        maritime,
        air,
        issuedCount: maritime.count + air.count,
        issuedTotalUsd: Math.round((maritime.totalUsd + air.totalUsd) * 100) / 100,
        payments: paid,
        pendingPayments: pending,
        empty: maritime.count === 0 && air.count === 0 && paid.count === 0 && pending.count === 0,
    };
}
