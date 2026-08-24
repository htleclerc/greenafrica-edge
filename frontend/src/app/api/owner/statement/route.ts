import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { fetchJurisdictionName } from '@/lib/jurisdictionName';
import { composeOwnerStatement, currentMonthBounds } from '@/services/statementService';
import { generateStatementPdf } from '@/services/invoiceService';
import { scopedLogger } from '@/lib/logger';

/**
 * GET /api/owner/statement — relevé consolidé À LA DEMANDE.
 *
 * `?asOf=YYYY-MM-DD` arrête le solde à une date ; `?vesselId=<uuid>` le
 * restreint à un navire. Sans paramètre : toute la flotte, à l'instant présent.
 *
 * NE PERSISTE RIEN. Le relevé mensuel officiel vit dans `owner_statements`
 * sous une contrainte UNIQUE (armateur, mois) et son PDF sous
 * `statements/<id>/<YYYY-MM>.pdf` : écrire ici écraserait, au premier clic, le
 * document que l'armateur consulte dans son portail. Le PDF est composé en
 * mémoire et rendu tel quel — même règle que `sendConsolidatedRecap`.
 *
 * Toutes les lectures passent par le client de SESSION : la RLS borne
 * `transactions` et `payments` au dossier de l'appelant (migs 033 et 058). Un
 * `vesselId` étranger ne produit donc aucune ligne plutôt qu'une fuite, et il
 * n'y a pas de client privilégié à scoper à la main.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = scopedLogger('api.owner.statement');

export async function GET(req: NextRequest): Promise<NextResponse> {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return new NextResponse('Not found', { status: 404 });

    const { data: owner } = await supabase
        .from('shipowners')
        .select('id, name, jurisdiction_id')
        .eq('profile_id', auth.user.id)
        .maybeSingle();
    if (!owner) return new NextResponse('Not found', { status: 404 });

    const url = new URL(req.url);
    const now = new Date();

    // Une date d'arrêté dans le futur n'a pas de sens : elle annoncerait le
    // solde d'aujourd'hui sous une date qui n'est pas encore arrivée. On la
    // ramène à maintenant plutôt que de refuser la demande.
    const asOfRaw = url.searchParams.get('asOf');
    let asOf = now;
    if (asOfRaw) {
        const parsed = new Date(asOfRaw);
        if (Number.isNaN(parsed.getTime())) {
            return NextResponse.json({ error: 'invalid asOf' }, { status: 400 });
        }
        asOf = parsed.getTime() > now.getTime() ? now : parsed;
    }

    const vesselId = url.searchParams.get('vesselId') ?? undefined;

    const { periodStart, periodEnd, label } = currentMonthBounds(asOf);
    const result = await composeOwnerStatement(supabase, {
        shipownerId: String(owner.id),
        periodStart, periodEnd, now, asOf, vesselId,
    });

    // Un relevé sans ligne ouverte reste un document valable — « rien à
    // devoir » est une réponse, et l'armateur a cliqué pour l'obtenir.
    const jurisdictionName = await fetchJurisdictionName(
        createPlatformClient(), String(owner.jurisdiction_id),
    );

    const pdf = await generateStatementPdf({
        ownerName: String(owner.name),
        jurisdiction: jurisdictionName,
        periodLabel: label,
        openLines: result.openLines,
        payments: result.payments,
        totalOutstandingUsd: result.totalOutstandingUsd,
        paymentsInMonthUsd: result.paymentsInMonthUsd,
        asOfIso: result.asOf.toISOString(),
        vesselScope: vesselId ? (result.openLines[0]?.vesselName ?? null) : null,
    });

    log.info('statement_served', {
        shipownerId: String(owner.id),
        asOf: result.asOf.toISOString(),
        vesselId: vesselId ?? null,
        lines: result.openCount,
    });

    const stamp = result.asOf.toISOString().slice(0, 10);
    const filename = `statement-${stamp}${vesselId ? '-vessel' : ''}.pdf`;
    return new NextResponse(Buffer.from(pdf), {
        status: 200,
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${filename}"`,
            // Un solde change à chaque encaissement : ce document ne se met pas
            // en cache, sous peine d'annoncer une dette déjà réglée.
            'Cache-Control': 'no-store',
        },
    });
}
