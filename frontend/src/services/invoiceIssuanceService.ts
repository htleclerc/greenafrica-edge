// Cœur d'émission d'un document fiscal (pro-forma / facture) pour une
// transaction. Extrait de POST /api/invoices/generate le 2026-07-24 pour que
// les scripts (seed, backfill) puissent émettre les mêmes documents que
// l'application — un seul pipeline, un seul format de ref, un seul hash.
//
// La route HTTP garde l'authentification et l'autorisation ; ce module ne
// suppose rien du caller et travaille sur le client Supabase qu'on lui passe
// (client tenant côté route, service-role côté script).

// Imports are deliberately relative (not `@/…`): scripts/ runs this module
// through `npx tsx` from the repo root, where the `@/*` path alias of
// frontend/tsconfig.json does not apply. Same reason as onboardingImport/.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    generateInvoicePdf,
    statusToMode,
    buildVerifyUrl,
    hashInvoiceFields,
    signInvoiceRef,
    type InvoiceData,
    type InvoiceMode,
    type InvoiceBadge,
} from './invoiceService';
import { sendInvoiceEmail } from './emailService';
import { getIssuerProfile } from '@/services/issuerProfileService';
import { fetchJurisdictionMeta, fetchJurisdictionBillingCc } from '../lib/jurisdictionName';

/**
 * Returns the hash/signature fields to include in the transactions UPDATE.
 * Both values must already be present (paired) to treat the row as signed —
 * an orphaned state (hash set, signature NULL) is treated as unsigned and a
 * fresh pair is written.  Mirrors the read guard in `resolveSignature`.
 *
 * NOTE (mig 089): content_hash and verify_signature are first-write-only columns
 * guarded at the DB layer.  Writing a "fresh pair" only succeeds when the row
 * currently has BOTH columns NULL (first write).  If either column is already set
 * and the recomputed value differs from the stored one, the DB will reject the
 * UPDATE with insufficient_privilege — fail-closed.  This function intentionally
 * returns {} (skip overwrite) when both are already set, which is the only path
 * that avoids the guard on regeneration.
 */
export function buildHashFields(
    tx: { content_hash: string | null | undefined; verify_signature: string | null | undefined },
    contentHash: string,
    verifySignature: string,
): Record<string, string> {
    return tx.content_hash && tx.verify_signature
        ? {}  // both already set — reuse stored values, skip overwrite
        : { content_hash: contentHash, verify_signature: verifySignature };
}

/**
 * Builds the single-element lineItems array for a carbon-tax invoice.
 * The authoritative total is always one charge: emissions × effective rate.
 */
export function buildLineItems(
    emissionsTco2: number,
    effectiveRate: number,
    totalUsd: number,
): InvoiceData['lineItems'] {
    return [
        {
            zone: 'EEZ',
            days: 1,
            emissionsTco2,
            rate: effectiveRate,
            amount: totalUsd,
            description: `Carbon tax (${emissionsTco2.toFixed(2)} tCO2 × ${effectiveRate.toFixed(2)} USD/tCO2)`,
            qtyDisplay: `${emissionsTco2.toFixed(2)} tCO2`,
            rateDisplay: `$${effectiveRate.toFixed(2)}/t`,
        },
    ];
}

/**
 * Numéro de semaine ISO 8601 (1-53). La semaine 1 est celle qui contient le
 * premier jeudi de l'année ; on décale donc la date au jeudi de sa semaine
 * avant de compter. Calcul en UTC pour qu'un changement d'heure locale ne
 * fasse pas basculer un document d'une semaine à l'autre.
 */
export function isoWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayOfWeek = d.getUTCDay() || 7;          // lundi = 1 … dimanche = 7
    d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);  // jeudi de la semaine courante
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/**
 * Référence canonique : {PRO|INV}-YYYY-WW-<8 hex d'UUID><4 hex d'entropie>.
 *
 * L'année et la semaine décrivent la CRÉANCE (`createdAt`), pas l'instant de
 * l'émission — sans quoi un rattrapage tardif daterait le document du jour du
 * rattrapage. L'année est l'année civile et non l'année ISO, pour rester
 * alignée avec le dossier de stockage ; aux trois derniers jours de décembre,
 * on peut donc lire une semaine 53 dans une référence de l'année suivante.
 *
 * Les 12 hex finaux (8 d'UUID + 4 d'entropie) rendent l'énumération infaisable
 * même sans la couche HMAC : 2^48 combinaisons.
 */
export function mintInvoiceRef(transactionId: string, mode: InvoiceMode, createdAt: Date): string {
    const year = createdAt.getUTCFullYear();
    const week = String(isoWeekNumber(createdAt)).padStart(2, '0');
    const uuidSeg = transactionId.split('-')[0].toLowerCase();
    const entropy = Math.floor(Math.random() * 0xFFFF).toString(16).padStart(4, '0');
    const refPrefix = mode === 'invoice' ? 'INV' : 'PRO';
    return `${refPrefix}-${year}-${week}-${uuidSeg}${entropy}`;
}

/**
 * Chemin de l'objet dans le bucket privé `documents` :
 *   <jurisdiction.code>/<proformas|invoices>/<YYYY>/<MM>/<REF>.pdf
 *
 * Le préfixe par État sert l'isolation multi-tenant ; le découpage année/mois
 * sert l'archivage et la purge par période. La référence passée peut être une
 * référence héritée sans segment de semaine : le chemin ne la reformate pas.
 */
export function buildStoragePath(input: {
    jurisdictionCode: string;
    mode: InvoiceMode;
    createdAt: Date;
    invoiceRef: string;
}): string {
    const folder = input.mode === 'invoice' ? 'invoices' : 'proformas';
    const year = input.createdAt.getUTCFullYear();
    const month = String(input.createdAt.getUTCMonth() + 1).padStart(2, '0');
    return `${input.jurisdictionCode}/${folder}/${year}/${month}/${input.invoiceRef}.pdf`;
}

export interface InvoiceRecipientsInput {
    /** Contact de facturation déclaré par l'armateur (shipowners.official_email). */
    shipownerBillingEmail: string | null;
    /** Agent maritime rattaché à la transaction. */
    agentEmail: string | null;
    /** Propriétaire du navire (vessels.owner_id → profiles.email). */
    vesselOwnerEmail: string | null;
    /** Copies propres à l'armateur (shipowners.billing_cc_emails). */
    ownerCcEmails: string[];
    /** Copies propres à l'État émetteur (jurisdictions.billing_cc_emails). */
    jurisdictionCcEmails: string[];
    /** Copie plateforme unique (PLATFORM_BILLING_CC). */
    platformCcEmail: string | null;
}

const cleanEmail = (value: string | null | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
};

/**
 * Détermine qui reçoit un document fiscal.
 *
 * Destinataire principal en cascade : contact de facturation de l'armateur →
 * agent maritime → propriétaire du navire. L'agent passe en copie s'il n'est
 * pas déjà le destinataire principal, puis viennent les copies propres à
 * l'armateur, celles de l'État émetteur et celle de la plateforme.
 *
 * Renvoie `null` quand aucun destinataire principal n'est joignable : une
 * créance existe indépendamment de la joignabilité de son débiteur, et il
 * serait absurde d'envoyer un document uniquement à ses propres archives.
 *
 * Le dédoublonnage est insensible à la casse mais préserve la casse d'origine
 * de la première occurrence : certains serveurs traitent la partie locale
 * comme sensible à la casse.
 */
export function resolveInvoiceRecipients(
    input: InvoiceRecipientsInput,
): { to: string; cc: string[] } | null {
    const to = cleanEmail(input.shipownerBillingEmail)
        ?? cleanEmail(input.agentEmail)
        ?? cleanEmail(input.vesselOwnerEmail);
    if (!to) return null;

    const seen = new Set<string>([to.toLowerCase()]);
    const cc: string[] = [];
    const candidates = [
        cleanEmail(input.agentEmail),
        ...input.ownerCcEmails.map(cleanEmail),
        ...input.jurisdictionCcEmails.map(cleanEmail),
        cleanEmail(input.platformCcEmail),
    ];
    for (const candidate of candidates) {
        if (!candidate) continue;
        const key = candidate.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cc.push(candidate);
    }

    return { to, cc };
}

/**
 * Un document fiscal dont le détail contredit le total n'a pas à exister.
 * On tolère un cent d'écart pour absorber les arrondis de représentation en
 * virgule flottante, pas davantage.
 */
export function assertLineItemsMatchTotal(
    lineItems: InvoiceData['lineItems'],
    totalUsd: number,
): void {
    if (!lineItems.length) {
        throw new Error('invoice issuance: lineItems must contain at least one line item');
    }
    const sum = lineItems.reduce((acc, item) => acc + item.amount, 0);
    if (Math.abs(sum - totalUsd) > 0.01) {
        throw new Error(
            `invoice issuance: lineItems sum ${sum} does not match tax_amount_usd ${totalUsd}`,
        );
    }
}

export interface IssueInvoiceActor {
    /** auth.users id used for the audit trail. */
    id: string;
    /** Display name recorded on the audit entry. */
    fullName: string;
}

export interface IssueInvoiceInput {
    /** Supabase client already scoped to the transaction's jurisdiction. */
    admin: SupabaseClient;
    transactionId: string;
    jurisdictionId: string;
    actor: IssueInvoiceActor;
    /** Origin used to build the /verify QR URL, e.g. https://greengate.africa */
    origin: string;
    /** Also email the document to the vessel owner and stamp proforma_sent_at. */
    sendEmail?: boolean;
    /**
     * Lignes de détail personnalisées. Permet au pipeline automatique de
     * conserver son libellé métier. Validées : leur somme doit égaler
     * tax_amount_usd. Par défaut, ligne unique « emissions × taux ».
     */
    lineItems?: InvoiceData['lineItems'];
    /** N'écrit pas dans le bucket. invoice_pdf_url reste NULL. Tests uniquement. */
    skipStorage?: boolean;
    /** N'envoie pas d'e-mail. Tests et rattrapage. */
    skipEmail?: boolean;
}

export interface IssueInvoiceEmailResult {
    success: boolean;
    id?: string;
    error?: string;
    skipped?: boolean;
}

export type IssueInvoiceResult =
    | {
          ok: true;
          invoiceRef: string;
          mode: InvoiceMode;
          badge: InvoiceBadge;
          verifyUrl: string;
          contentHash: string;
          verifySignature: string;
          storagePath: string;
          pdfBuffer: Uint8Array;
          email: IssueInvoiceEmailResult;
          /** Destinataires réellement retenus, null si aucun n'était joignable. */
          recipients: { to: string; cc: string[] } | null;
      }
    | { ok: false; status: number; error: string };

/**
 * Renders, uploads and records the fiscal document for a transaction.
 *
 *  1. Reload the authoritative transaction + vessel + owner rows. The PDF is
 *     rendered from DB data only — no caller-supplied amounts, names or refs.
 *  2. Mint an immutable invoice ref if the row has none yet, compute the
 *     SHA-256 content hash and its HMAC signature (first-write-only).
 *  3. Render the PDF with a QR URL carrying `?h=<hash>&s=<sig>` so /verify can
 *     reject unsigned / enumerated URLs before touching the DB.
 *  4. Upload to the private `documents` bucket, then persist ref + hash +
 *     signature + storage path on the transaction.
 *  5. Audit log (INVOICE_GENERATED always; INVOICE_SENT only when sendEmail).
 *
 * Idempotent: re-running on a transaction that already carries a ref/hash pair
 * reuses them so previously distributed PDFs keep verifying.
 */
export async function issueInvoiceDocument(input: IssueInvoiceInput): Promise<IssueInvoiceResult> {
    const { admin, transactionId, jurisdictionId, actor, origin } = input;
    const sendEmail = input.sendEmail === true;

    // ── 1. Reload the authoritative transaction ─────────────────────────
    const { data: tx, error: txErr } = await admin
        .from('transactions')
        .select('id, vessel_id, vessel_name, vessel_imo, transaction_type, emissions_tco2, tax_amount_usd, status, port_call, created_at, paid_at, invoice_ref, content_hash, verify_signature, invoice_pdf_url, proforma_sent_at, jurisdiction_id, shipowner_id, agent_profile_id')
        .eq('id', transactionId)
        .single();
    if (txErr || !tx) {
        return { ok: false, status: 404, error: 'Transaction not found' };
    }

    let vesselOwnerId: string | null = null;
    let vesselOwnerEmail: string | null = null;
    let vesselOwnerName: string | null = null;
    if (tx.vessel_id) {
        const { data: vessel } = await admin
            .from('vessels')
            .select('owner_id, mmsi')
            .eq('id', tx.vessel_id)
            .single();
        vesselOwnerId = vessel?.owner_id ?? null;
    }

    if (vesselOwnerId) {
        const { data: ownerProfile } = await admin
            .from('profiles')
            .select('email, full_name')
            .eq('id', vesselOwnerId)
            .single();
        vesselOwnerEmail = ownerProfile?.email ?? null;
        vesselOwnerName = ownerProfile?.full_name ?? null;
    }
    const ownerName = vesselOwnerName || 'Unassigned shipping agent';

    // ── 2. Derive canonical fields (mode, ref, dates) ───────────────────
    const { mode, badge } = statusToMode(tx.status);
    const createdAt = new Date(tx.created_at);
    const issueDate = createdAt.toLocaleDateString('en-GB', {
        day: '2-digit', month: 'long', year: 'numeric',
    });
    const dueDate = new Date(createdAt.getTime() + 30 * 86400000)
        .toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

    // Keep an existing ref if already minted (idempotent re-gen).
    const invoiceRef = tx.invoice_ref || mintInvoiceRef(tx.id, mode, createdAt);

    // ── 3. Resolve the transaction's jurisdiction (code + sovereign name) ─
    // Use the jurisdiction_id stamped on the row (W2+). Falls back to
    // Somaliland for any pre-W2 row that lacks it. The code drives the storage
    // prefix, the name is printed on the document.
    const txRecord = tx as typeof tx & {
        jurisdiction_id?: string | null;
        shipowner_id?: string | null;
        agent_profile_id?: string | null;
    };
    const jurisdiction = await fetchJurisdictionMeta(admin, txRecord.jurisdiction_id);
    const jurisdictionName = jurisdiction.name;

    const totalUsd = Number(tx.tax_amount_usd);
    const emissionsTco2 = Number(tx.emissions_tco2);
    // Effective $/tCO2 rate as applied to this transaction — derive it so
    // we don't need to re-read the tax_configurations table.
    const effectiveRate = emissionsTco2 > 0 ? totalUsd / emissionsTco2 : 0;

    // ── 4. Content hash + HMAC signature (first-write-only) ─────────────
    // If the row already has a content_hash from a prior generation, reuse it
    // along with its verify_signature so that any previously distributed PDF
    // (carrying those values in its QR code) continues to verify.  Only compute
    // fresh values when the row has never been signed before.
    let contentHash: string;
    let verifySignature: string;
    if (tx.content_hash && tx.verify_signature) {
        contentHash = tx.content_hash;
        verifySignature = tx.verify_signature;
    } else {
        const canonicalFields = {
            invoiceRef,
            vesselImo: tx.vessel_imo,
            vesselName: tx.vessel_name,
            ownerName,
            totalUsd,
            periodStart: issueDate,
            periodEnd: dueDate,
            mode: mode as InvoiceMode,
        };
        contentHash = hashInvoiceFields(canonicalFields);
        verifySignature = signInvoiceRef(invoiceRef, contentHash);
    }

    // Build the QR URL with the signed token so /verify can accept/reject
    // it at the edge without touching the DB.
    const verifyUrl = buildVerifyUrl(invoiceRef, {
        origin,
        contentHash,
        signature: verifySignature,
    });

    // ── 5. Render the PDF ───────────────────────────────────────────────
    // Le pipeline automatique fournit ses propres lignes (libellé métier) ;
    // sinon, ligne unique « emissions × taux ». Dans les deux cas la somme doit
    // égaler le total, faute de quoi le document contredirait la créance.
    const lineItems = input.lineItems ?? buildLineItems(emissionsTco2, effectiveRate, totalUsd);
    try {
        assertLineItemsMatchTotal(lineItems, totalUsd);
    } catch (err) {
        return {
            ok: false,
            status: 400,
            error: err instanceof Error ? err.message : 'invalid lineItems',
        };
    }

    // Profil emetteur : coordonnees, compte de collecte, delais et rampe de
    // recouvrement imprimes en pied de page 1 et sur toute la page 2. Defaut
    // plateforme surcharge par la juridiction (mig 131).
    const issuer = await getIssuerProfile(admin, jurisdictionId);

    // Contacts du debiteur. L'armateur est en base ; le gestionnaire ISM et le
    // P&I Club ne le sont pas encore — la page 2 les marque « — » plutot que
    // d'inventer, un pro-forma etant opposable.
    let debtorAddress: string | null = null;
    let debtorContact: string | null = null;
    if (tx.shipowner_id) {
        const { data: owner } = await admin
            .from('shipowners')
            .select('address, official_email, phone_e164')
            .eq('id', tx.shipowner_id)
            .maybeSingle();
        const o = owner as { address?: string | null; official_email?: string | null; phone_e164?: string | null } | null;
        debtorAddress = o?.address ?? null;
        debtorContact = [o?.official_email, o?.phone_e164].filter(Boolean).join(' · ') || null;
    }

    const invoiceData: InvoiceData = {
        invoiceRef,
        vesselName: tx.vessel_name,
        vesselImo: tx.vessel_imo,
        vesselMmsi: '',
        ownerName,
        // Sovereign name resolved from the transaction's jurisdiction_id — never
        // hardcoded so Djibouti invoices name Djibouti, not Somaliland.
        jurisdiction: jurisdictionName,
        periodStart: issueDate,
        periodEnd: dueDate,
        emissionsTco2,
        ratePerTco2: effectiveRate,
        subtotalUsd: totalUsd,
        exemptionUsd: 0,
        totalUsd,
        mode,
        badge,
        verifyUrl,
        lineItems,
        issuer,
        voyage: {
            // `port_call` est le seul element d'escale que la transaction
            // porte ; ETD, ATA et ATD ne sont pas releves aujourd'hui.
            arrivalPort: (tx.port_call as string | null) ?? null,
        },
        debtor: {
            ownerName,
            ownerAddress: debtorAddress,
            ownerContact: debtorContact,
        },
    };

    let pdfBuffer: Uint8Array;
    try {
        pdfBuffer = await generateInvoicePdf(invoiceData);
    } catch (err) {
        console.error('[Invoice issuance] PDF render failed:', err);
        return {
            ok: false,
            status: 500,
            error: err instanceof Error ? err.message : 'PDF generation failed',
        };
    }

    // ── 6. Upload to the private documents bucket ───────────────────────
    const storagePath = buildStoragePath({
        jurisdictionCode: jurisdiction.code,
        mode,
        createdAt,
        invoiceRef,
    });
    if (!input.skipStorage) {
        const { error: uploadError } = await admin.storage
            .from('documents')
            .upload(storagePath, pdfBuffer, {
                contentType: 'application/pdf',
                upsert: true,
            });
        if (uploadError) {
            console.error('[Invoice issuance] Upload failed:', uploadError.message);
            return { ok: false, status: 502, error: `Upload failed: ${uploadError.message}` };
        }
    }

    // ── 7. Persist ref, hash, signature + pdf storage path ──────────────
    // content_hash and verify_signature are first-write-only: if they are
    // already set (a previously distributed PDF carries those values in its
    // QR code), we MUST NOT overwrite them or that PDF will stop verifying.
    // Only write them when BOTH are NULL — mirrors the read guard at step 4.
    const hashFields = buildHashFields(tx, contentHash, verifySignature);
    const { error: txUpdateErr } = await admin
        .from('transactions')
        .update({
            invoice_ref: invoiceRef,
            ...hashFields,
            // Only record the storage path when the PDF was actually uploaded,
            // so a skipStorage run never claims a document exists.
            ...(input.skipStorage ? {} : { invoice_pdf_url: storagePath }),
        })
        .eq('id', transactionId);
    if (txUpdateErr) {
        // Bloquant par conception : un PDF présent dans le bucket dont la
        // référence n'est pas en base est invisible depuis l'application — le
        // portail et /verify résolvent tous deux par invoice_ref. Mieux vaut
        // échouer et rejouer que produire un document fantôme.
        console.error('[Invoice issuance] Transaction update failed:', txUpdateErr.message);
        return {
            ok: false,
            status: 500,
            error: `Persisting invoice reference failed: ${txUpdateErr.message}`,
        };
    }

    if (tx.vessel_id) {
        const { error: vesselError } = await admin
            .from('vessels')
            .update({ pro_forma_generated: true })
            .eq('id', tx.vessel_id);
        if (vesselError) {
            console.error('[Invoice issuance] Vessel update failed:', vesselError.message);
        }
    }

    // ── 8. Audit log (always fired for INVOICE_GENERATED) ───────────────
    const { error: auditError } = await admin.from('audit_logs').insert({
        user_id: actor.id,
        user_full_name: actor.fullName,
        action: 'INVOICE_GENERATED',
        severity: 'INFO',
        entity_type: 'Transaction',
        entity_id: transactionId,
        jurisdiction_id: jurisdictionId,
        details_json: {
            vesselName: tx.vessel_name,
            invoiceRef,
            amount: totalUsd,
            mode,
            badge,
            contentHash,
        },
    });
    if (auditError) {
        console.error('[Invoice issuance] Audit log failed:', auditError.message);
    }

    // ── 9. Resolve recipients (cascade + copies) ────────────────────────
    const { data: shipowner } = txRecord.shipowner_id
        ? await admin
            .from('shipowners')
            .select('official_email, billing_cc_emails')
            .eq('id', txRecord.shipowner_id)
            .maybeSingle()
        : { data: null };

    const { data: agentProfile } = txRecord.agent_profile_id
        ? await admin
            .from('profiles')
            .select('email')
            .eq('id', txRecord.agent_profile_id)
            .maybeSingle()
        : { data: null };

    const recipients = resolveInvoiceRecipients({
        shipownerBillingEmail: (shipowner?.official_email as string | null) ?? null,
        agentEmail: (agentProfile?.email as string | null) ?? null,
        vesselOwnerEmail,
        ownerCcEmails: (shipowner?.billing_cc_emails as string[] | null) ?? [],
        jurisdictionCcEmails: await fetchJurisdictionBillingCc(admin, txRecord.jurisdiction_id),
        platformCcEmail: process.env.PLATFORM_BILLING_CC ?? null,
    });

    // ── 10. Email delivery (only when explicitly requested) ─────────────
    const emailRequested = sendEmail && !input.skipEmail;
    let emailResult: IssueInvoiceEmailResult = { success: false, skipped: !emailRequested };
    if (emailRequested && recipients) {
        emailResult = await sendInvoiceEmail({
            to: recipients.to,
            cc: recipients.cc,
            recipientName: ownerName,
            vesselName: tx.vessel_name,
            invoiceRef,
            amountUsd: totalUsd,
            dueDate,
            mode,
            badge,
            pdfBuffer,
            verifyUrl,
            jurisdictionName,
        });
        if (!emailResult.success) {
            console.error('[Invoice issuance] Email failed:', emailResult.error);
        }
    } else if (emailRequested) {
        // La créance existe indépendamment de la joignabilité du débiteur : on
        // n'échoue pas, on trace l'absence de destinataire.
        emailResult = { success: false, error: 'no reachable recipient' };
    }

    // ── 11. On "Print & Send": stamp proforma_sent_at (first time only)
    //        + always insert an INVOICE_SENT audit entry ────────────────
    if (emailRequested) {
        if (mode === 'proforma' && !tx.proforma_sent_at) {
            const { error: sentStampError } = await admin
                .from('transactions')
                .update({ proforma_sent_at: new Date().toISOString() })
                .eq('id', transactionId);
            if (sentStampError) {
                console.error('[Invoice issuance] proforma_sent_at update failed:', sentStampError.message);
            }
        }

        const { error: sentAuditError } = await admin.from('audit_logs').insert({
            user_id: actor.id,
            user_full_name: actor.fullName,
            action: 'INVOICE_SENT',
            severity: 'INFO',
            entity_type: 'Transaction',
            entity_id: transactionId,
            jurisdiction_id: jurisdictionId,
            details_json: {
                vesselName: tx.vessel_name,
                invoiceRef,
                mode,
                badge,
                recipientEmail: recipients?.to ?? null,
                recipientCc: recipients?.cc ?? [],
                recipientName: ownerName,
                delivery: {
                    provider: 'resend',
                    succeeded: emailResult.success,
                    error: emailResult.error ?? null,
                },
            },
        });
        if (sentAuditError) {
            console.error('[Invoice issuance] INVOICE_SENT audit log failed:', sentAuditError.message);
        }
    }

    return {
        ok: true,
        invoiceRef,
        mode,
        badge,
        verifyUrl,
        contentHash,
        verifySignature,
        storagePath,
        pdfBuffer,
        email: emailResult,
        recipients,
    };
}
