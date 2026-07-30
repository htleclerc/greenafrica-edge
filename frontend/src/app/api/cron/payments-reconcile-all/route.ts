import { NextResponse, type NextRequest } from 'next/server';
import { GET as runPaymentReconcile } from '../stripe-reconcile-pending/route';
import { GET as runRefundReconcile } from '../stripe-refund-reconcile-pending/route';
import { GET as runPaypalReconcile } from '../paypal-reconcile-pending/route';

/**
 * GET /api/cron/payments-reconcile-all
 *
 * Créneau cron unique regroupant tous les reconcilers de paiement. Remplace
 * l'ancien `stripe-reconcile-all`, devenu inexact depuis l'ajout du rail PayPal.
 *
 * POURQUOI UN CHAÎNEUR — le plan Vercel refuse toute expression cron plus
 * fréquente qu'une fois par jour, et chaque entrée de `vercel.json` consomme un
 * créneau. Regrouper les trois reconcilers derrière un seul slot quotidien
 * (`0 9 * * *`) évite d'en ajouter à chaque nouveau rail.
 *
 * Compromis de cadence : un webhook manqué laisse un paiement PROCESSING ou un
 * remboursement APPROVED en attente jusqu'à ~24 h. Acceptable — les webhooks
 * sont fiables en régime normal et sont retentés par les providers (PayPal
 * pendant ~3 jours) ; ces reconcilers sont une ceinture, pas la bretelle.
 * Passer à Vercel Pro et restaurer `*\/15 * * * *` ici si la réactivité devient
 * contraignante.
 *
 * Chaque sous-handler garde sa propre garde CRON_SECRET, son export de route et
 * ses tests : ils restent appelables individuellement pour l'ops. Seule cette
 * route est planifiée dans vercel.json.
 *
 * Auth : `Authorization: Bearer ${CRON_SECRET}`. Vercel envoie un seul header
 * d'auth par exécution — on transmet l'objet Request tel quel.
 *
 * Tolérance aux pannes : exécution séquentielle, chacun fail-soft. Si le
 * reconciler Stripe throw, les remboursements et PayPal tournent quand même ;
 * l'erreur apparaît comme une chaîne dans le sous-résultat.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization');
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const payments = await safeRun(() => runPaymentReconcile(req));
    const refunds = await safeRun(() => runRefundReconcile(req));
    const paypal = await safeRun(() => runPaypalReconcile(req));

    return NextResponse.json({ payments, refunds, paypal });
}

async function safeRun(
    fn: () => Promise<NextResponse>,
): Promise<{ status: number; body: unknown } | { error: string }> {
    try {
        const res = await fn();
        const body = await res.json().catch(() => null);
        return { status: res.status, body };
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}
