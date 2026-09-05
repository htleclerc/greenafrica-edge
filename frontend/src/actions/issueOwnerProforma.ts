'use server';

import { z } from 'zod';
import { requireOwner } from '@/lib/auth/requireOwner';
import { createTenantClient } from '@/lib/supabase/tenant';
import { issueInvoiceDocument } from '@/services/invoiceIssuanceService';
import { scopedLogger } from '@/lib/logger';
import { appBaseUrl } from '@/lib/appUrl';

const log = scopedLogger('issueOwnerProforma');

const schema = z.object({ transactionId: z.string().uuid() });

export interface IssueOwnerProformaResult {
    invoiceRef: string;
}

/**
 * Émet à la demande le PDF d'un pro-forma que le pipeline n'a pas encore
 * produit — le « PDF not issued » de la liste des factures. L'armateur ne peut
 * le demander que pour SES propres lignes.
 *
 * Sécurité — pourquoi ce geste ne rouvre pas la faille H1/H2 de l'audit fraude
 * du 2026-04 (qui avait retiré SHIPPING_AGENT de /api/invoices/generate) :
 *   - le client n'envoie qu'un identifiant de transaction. Montants, IMO,
 *     noms, référence : tout est relu en base par `issueInvoiceDocument`, rien
 *     n'est accepté de l'appelant ;
 *   - l'appartenance est vérifiée ici, contre le shipowner de la session ;
 *   - référence, hash et signature sont en écriture unique : réémettre ne
 *     réécrit pas un document déjà distribué, il le reproduit à l'identique ;
 *   - aucun e-mail n'est envoyé (`sendEmail` reste faux) — la diffusion
 *     officielle reste un geste de la juridiction.
 *
 * L'entrée d'audit INVOICE_GENERATED porte l'armateur comme acteur : c'est lui
 * qui a déclenché l'émission, la trace doit le dire.
 */
export async function issueOwnerProforma(input: {
    transactionId: string;
}): Promise<IssueOwnerProformaResult> {
    const { transactionId } = schema.parse(input);
    const ctx = await requireOwner();

    const admin = createTenantClient(ctx.jurisdictionId);

    const { data: tx, error: txErr } = await admin
        .from('transactions')
        .select('id, shipowner_id, invoice_pdf_url')
        .eq('id', transactionId)
        .maybeSingle();
    if (txErr) throw txErr;
    if (!tx || tx.shipowner_id !== ctx.shipowner.id) {
        // Même réponse pour « inconnue » et « pas la vôtre » : ne pas révéler
        // l'existence d'une facture d'un autre armateur.
        throw new Error('Invoice not found');
    }

    log.info('action_invoked', {
        transactionId,
        userId: ctx.userId,
        shipownerId: ctx.shipowner.id,
        alreadyIssued: Boolean(tx.invoice_pdf_url),
    });

    const result = await issueInvoiceDocument({
        admin,
        transactionId,
        jurisdictionId: ctx.jurisdictionId,
        actor: { id: ctx.userId, fullName: ctx.shipowner.name ?? 'Shipowner' },
        origin: appBaseUrl(),
        sendEmail: false,
    });

    if (!result.ok) {
        log.error('issue_failed', { transactionId, status: result.status, error: result.error });
        throw new Error(result.error);
    }

    log.info('issued', { transactionId, invoiceRef: result.invoiceRef });
    return { invoiceRef: result.invoiceRef };
}
