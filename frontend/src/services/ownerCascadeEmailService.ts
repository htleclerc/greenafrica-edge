import { Resend } from 'resend';

/**
 * Owner-cascade email service.
 *
 * Sends a 7-day liability-escalation cover letter (EN/FR) from the Port
 * Officer to the registered shipowner when the designated agent has not
 * paid the carbon-tax invoice. The original pro-forma PDF is attached.
 *
 * Required env:
 *   - RESEND_API_KEY   (server-side only)
 *   - EMAIL_FROM       (verified sender, e.g. "noreply@africgreen.example")
 *
 * This service is intentionally scope-isolated from emailService.ts for the
 * MVP: the cover-letter template is specific to the escalation workflow and
 * must not be mixed with the generic invoice email template.
 */

export interface OwnerCascadeInput {
    toEmail: string;
    ownerName: string;
    vesselName: string;
    vesselImo: string;
    invoiceRef: string;
    amountUsd: number;
    arrivalDate: string; // ISO
    agentName: string;
    agentEmail: string;
    pdfBuffer: Uint8Array;
    locale: 'en' | 'fr';
}

export type OwnerCascadeResult =
    | { ok: true; resendId: string }
    | { ok: false; reason: string };

let resendClient: Resend | null = null;
function getResend(): Resend {
    if (resendClient) return resendClient;
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        throw new Error('RESEND_API_KEY not configured');
    }
    resendClient = new Resend(apiKey);
    return resendClient;
}

function renderSubject(input: OwnerCascadeInput): string {
    if (input.locale === 'fr') {
        return `Facture de taxe carbone impayée — MV ${input.vesselName} — IMO ${input.vesselImo}`;
    }
    return `Unpaid carbon-tax invoice — MV ${input.vesselName} — IMO ${input.vesselImo}`;
}

function renderBody(input: OwnerCascadeInput): string {
    const arrival = new Date(input.arrivalDate).toLocaleDateString(
        input.locale === 'fr' ? 'fr-FR' : 'en-US',
    );
    const amount = input.amountUsd.toLocaleString(
        input.locale === 'fr' ? 'fr-FR' : 'en-US',
        { style: 'currency', currency: 'USD' },
    );
    if (input.locale === 'fr') {
        return `Madame, Monsieur,

Selon nos registres, la facture de taxe carbone ${input.invoiceRef} pour le navire ${input.vesselName} (IMO ${input.vesselImo}, arrivé le ${arrival}) d'un montant de ${amount} reste impayée par votre agent maritime désigné (${input.agentName}, ${input.agentEmail}) plus de 7 jours après l'arrivée du navire dans la ZEE du Somaliland.

En tant que propriétaire enregistré, vous êtes tenu responsable selon le décret [REF] pour tout solde de taxe carbone que votre agent n'aurait pas réglé. Nous demandons le paiement dans les 30 jours suivant cet avis ; dans le cas contraire, le navire pourra faire l'objet de restrictions opérationnelles lors de sa prochaine escale.

La facture pro-forma originale est jointe à titre de référence. Pour les instructions de paiement ou pour contester ce montant, veuillez répondre à cet email ou contacter compliance@africgreen.example.

Cordialement,
Équipe de conformité — Taxe carbone Green-Gate`;
    }
    return `Dear ${input.ownerName},

Per our records, the carbon-tax invoice ${input.invoiceRef} for vessel ${input.vesselName} (IMO ${input.vesselImo}, arrived ${arrival}) in the amount of ${amount} remains unpaid by your appointed shipping agent (${input.agentName}, ${input.agentEmail}) more than 7 days after the vessel's arrival in the Somaliland EEZ.

You are liable as the registered owner under Decree [REF] for any carbon-tax balance your agent fails to remit. We request payment within 30 days of this notice; otherwise the vessel may be subject to operational restrictions on its next call.

The original pro-forma PDF is attached for reference. For payment instructions or to dispute this charge, reply to this email or contact compliance@africgreen.example.

Regards,
Green-Gate Carbon Tax Compliance Team`;
}

export async function sendOwnerCascadeEmail(
    input: OwnerCascadeInput,
): Promise<OwnerCascadeResult> {
    try {
        const resend = getResend();
        const from = process.env.EMAIL_FROM ?? 'noreply@africgreen.example';
        const result = await resend.emails.send({
            from,
            to: input.toEmail,
            subject: renderSubject(input),
            text: renderBody(input),
            attachments: [
                {
                    filename: `${input.invoiceRef}.pdf`,
                    content: Buffer.from(input.pdfBuffer),
                },
            ],
        });
        if (result.error) {
            return { ok: false, reason: result.error.message };
        }
        if (!result.data?.id) {
            return { ok: false, reason: 'Resend returned no id' };
        }
        return { ok: true, resendId: result.data.id };
    } catch (err) {
        return { ok: false, reason: (err as Error).message };
    }
}
