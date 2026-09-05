import { applyEmailRedirect, redirectTarget } from '@/lib/emailRedirect';
import { deliver, selectedTransport } from '@/services/email/transport';
import { OWNER_INVOICES_PATH, OWNER_WALLET_PATH } from '@/lib/routes/ownerPaths';
import {
    TX_AGENT_INVITE_HTML,
    TX_MONTHLY_STATEMENT_HTML,
    TX_PAYMENT_CONFIRMATION_HTML,
    TX_PROFORMA_INVOICE_HTML,
    TX_VESSEL_ACCESS_CODE_HTML,
} from '@/emails/templates';
import { renderEmailTemplate } from '@/emails/renderEmailTemplate';
import { appBaseUrl } from '@/lib/appUrl';

/**
 * Centralized email service for Green Gate OS notifications.
 *
 * L'acheminement est choisi par `@/services/email/transport` : Resend, ou
 * n'importe quel serveur SMTP (Gmail, domaine propre). Ce fichier ne connaît
 * plus le fournisseur — il compose les messages, la couche transport les
 * remet. Les gabarits restent des chaînes HTML en ligne, à la charte
 * institutionnelle émeraude/sombre du reste de la plateforme.
 *
 * Env requis — l'un OU l'autre :
 *   - RESEND_API_KEY    (envoi par l'API Resend)
 *   - EMAIL_SMTP_HOST   (envoi SMTP ; voir transport.ts pour USER/PASSWORD/PORT)
 *
 * Env requis dans les deux cas :
 *   - EMAIL_FROM        (adresse d'expédition autorisée, ex. "noreply@greengate.africa")
 *
 * Optionnel :
 *   - EMAIL_TRANSPORT   ("resend" | "smtp" — tranche si les deux sont posés)
 *   - EMAIL_REPLY_TO    (ex. "st.operations@greengate.africa")
 *   - EMAIL_REDIRECT_TO (hors production : tout part vers cette adresse)
 *   - NEXT_PUBLIC_APP_URL (liens dans les e-mails — cf. `@/lib/appUrl`)
 */

/**
 * Adresse d'expédition.
 *
 * Le repli n'est PAS un confort : c'est le dernier rempart contre un envoi
 * refusé en silence. `EMAIL_FROM` a porté `noreply@africgreen.africa` puis
 * `…@mail.africgreen.africa` — l'ancien nom du projet — pendant que le compte
 * Resend ne vérifiait que les domaines `greengate.africa`. Chaque envoi était
 * rejeté pour domaine non vérifié : relances, pro-formas, liens de connexion,
 * relevés. Sans bruit, puisque `sendEmail` capture l'erreur et rend
 * `{ success: false }` que la plupart des appelants ne traitent pas comme
 * bloquant.
 *
 * AVERTIR NE SUFFISAIT PAS. La panne est revenue le 2026-09-04 par la porte de
 * l'environnement, et un avertissement que personne ne lit n'a sauvé aucun
 * e-mail. Un `EMAIL_FROM` dont le domaine n'est pas vérifié est donc REMPLACÉ
 * par le repli : mieux vaut un expéditeur légitime mais inattendu qu'aucun
 * e-mail du tout. Le remplacement est journalisé en erreur, une fois.
 *
 * La liste est surchargeable par `EMAIL_VERIFIED_SENDER_DOMAINS` (séparés par
 * des virgules) : le jour où un domaine est vérifié chez Resend, on l'ajoute
 * par l'environnement, sans quoi ce garde-fou refuserait un expéditeur devenu
 * légitime.
 */
const DEFAULT_VERIFIED_SENDER_DOMAINS = [
    'greengate.africa',
    'mail.greengate.africa',
    'noreply.greengate.africa',
];
const FALLBACK_SENDER = 'noreply@greengate.africa';

function verifiedSenderDomains(): string[] {
    const raw = process.env.EMAIL_VERIFIED_SENDER_DOMAINS?.trim();
    if (!raw) return DEFAULT_VERIFIED_SENDER_DOMAINS;
    const list = raw.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
    return list.length > 0 ? list : DEFAULT_VERIFIED_SENDER_DOMAINS;
}

let senderWarned = false;

function fromAddress(): string {
    const configured = process.env.EMAIL_FROM?.trim();
    if (!configured) return FALLBACK_SENDER;

    // Le contrôle ne vaut que pour Resend : c'est lui qui refuse un domaine non
    // vérifié. Un serveur SMTP a ses propres règles d'expéditeur autorisé, et
    // substituer une adresse enverrait chercher au mauvais endroit.
    if (selectedTransport() !== 'resend') return configured;

    const domains = verifiedSenderDomains();
    const domain = configured.split('@')[1]?.toLowerCase() ?? '';
    if (domains.includes(domain)) return configured;

    if (!senderWarned) {
        senderWarned = true;
        console.error(
            `[Email] EMAIL_FROM=${configured} : domaine « ${domain} » absent des domaines vérifiés `
            + `(${domains.join(', ')}). Envoi replié sur ${FALLBACK_SENDER} — corriger EMAIL_FROM, `
            + `ou déclarer le domaine dans EMAIL_VERIFIED_SENDER_DOMAINS s'il est vérifié chez Resend.`,
        );
    }
    return FALLBACK_SENDER;
}

function replyTo(): string | undefined {
    return process.env.EMAIL_REPLY_TO || undefined;
}

/**
 * Etat souverain porte en pied des e-mails transactionnels. Le Somaliland est
 * l'emetteur historique : les envois qui ne resolvent pas la juridiction de
 * leur transaction retombent dessus, comme le faisait `emailLayout`.
 */
const DEFAULT_SOVEREIGN = 'Republic of Somaliland';

/**
 * Montant en dollars, formate explicitement en en-US.
 *
 * `toLocaleString()` sans locale suit celle du PROCESSUS : le meme montant
 * sort « 11,492 » sur un hote anglophone et « 11 492 » sur un hote francophone,
 * avec une espace insecable etroite. Une facture ne doit pas dependre de la
 * configuration ICU de la machine qui l'envoie.
 */
function usd(amountUsd: number): string {
    return `$${amountUsd.toLocaleString('en-US')}`;
}

function appUrl(): string {
    return appBaseUrl();
}

// ── Result type ────────────────────────────────────────────────────────────

export interface EmailResult {
    success: boolean;
    id?: string;
    error?: string;
}

async function sendEmail(params: {
    to: string | string[];
    cc?: string[];
    subject: string;
    html: string;
    text?: string;
    attachments?: Array<{ filename: string; content: Buffer | Uint8Array | string }>;
}): Promise<EmailResult> {
    try {
        // Hors production, tout part vers EMAIL_REDIRECT_TO. La redirection est
        // appliquée ici, au seul endroit qui parle à l'acheminement, pour
        // qu'aucun des douze expéditeurs de ce fichier ne puisse l'oublier.
        const { message: sortant, redirected, originalRecipients } =
            applyEmailRedirect(params);
        if (redirected) {
            console.info(
                `[Email] REDIRIGÉ vers ${redirectTarget()} — aurait été envoyé à : ` +
                `${originalRecipients.join(', ') || '(aucun)'} — sujet : ${params.subject}`,
            );
        }
        const result = await deliver({
            from: fromAddress(),
            to: Array.isArray(sortant.to) ? sortant.to : [sortant.to],
            ...(sortant.cc?.length ? { cc: sortant.cc } : {}),
            subject: sortant.subject,
            html: sortant.html ?? '',
            text: sortant.text,
            replyTo: replyTo(),
            attachments: params.attachments?.map((a) => ({
                filename: a.filename,
                content: a.content as Buffer,
            })),
        });

        if (result.error) {
            // Le nom de l'acheminement est journalisé : sans lui, une panne
            // SMTP se lit comme une panne Resend et l'on cherche du mauvais
            // côté, ce qui a déjà coûté plusieurs jours.
            console.error(`[Email] échec d'envoi (${selectedTransport() ?? 'aucun acheminement'}) :`, result.error);
            return { success: false, error: result.error };
        }

        return { success: true, id: result.id };
    } catch (err) {
        console.error('[Email] Send failed:', err);
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
        };
    }
}

// ── Shared layout ──────────────────────────────────────────────────────────

// Bordure du séparateur. Une couleur pleine et non un rgba() : Outlook ignore
// l'alpha et rendrait un trait noir. #1F2A26 est le rendu exact de
// rgba(255,255,255,0.06) sur le fond de carte #111C18.
const META_BORDER = '#1F2A26';

/**
 * Une ligne « étiquette → valeur » d'un bloc de métadonnées.
 *
 * En **table**, pas en flexbox : Gmail supprime `display:flex`, et les deux
 * cellules retombaient alors collées l'une à l'autre (« VesselGG DEMO STAR »).
 * Les styles sont **en ligne** pour la même raison : le `<style>` de l'en-tête
 * n'est pas garanti hors du client web de Gmail.
 *
 * N'échappe rien : l'appelant passe déjà des valeurs échappées, et certaines
 * lignes portent délibérément du balisage.
 */
function metaRow(
    label: string,
    value: string,
    styles?: { label?: string; value?: string },
): string {
    const cell = `padding:10px 0;border-bottom:1px solid ${META_BORDER};font-size:13px;`;
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%">
<tr>
<td align="left" style="${cell}color:#64748B;${styles?.label ?? ''}">${label}</td>
<td align="right" style="${cell}color:#FFFFFF;font-weight:600;${styles?.value ?? ''}">${value}</td>
</tr>
</table>`;
}

function emailLayout(content: string, options?: { previewText?: string; sovereignLine?: string }): string {
    const preview = options?.previewText ?? '';
    // Pied de page souverain. Par défaut le Somaliland (émetteur historique) ;
    // les documents fiscaux passent l'autorité de leur propre juridiction pour
    // qu'une facture djiboutienne ne soit pas signée par le Somaliland.
    const sovereignLine = options?.sovereignLine ?? 'Republic of Somaliland · Maritime Carbon Tax Authority';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Green Gate</title>
<style>
    body { margin:0; padding:0; background:#0A1110; font-family: 'IBM Plex Sans', 'Open Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
    .preheader { display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; }
    .container { max-width: 600px; margin: 0 auto; padding: 24px 16px; }
    .card { background: #111C18; border-radius: 16px; border: 1px solid rgba(255,255,255,0.08); overflow: hidden; }
    .accent-bar { height: 4px; background: linear-gradient(90deg, #047857 0%, #10B981 50%, #EAB308 100%); }
    .header { padding: 24px; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .brand { display: flex; align-items: center; gap: 12px; }
    .logo-box { width: 36px; height: 36px; border-radius: 8px; background: #10B981; display: flex; align-items: center; justify-content: center; font-weight: 800; color: #0A1110; font-size: 14px; }
    .brand-text { font-size: 15px; font-weight: 800; color: #FFFFFF; letter-spacing: -0.3px; line-height: 1; }
    .brand-sub { font-size: 9px; font-weight: 700; color: #10B981; letter-spacing: 1.5px; margin-top: 3px; }
    .body { padding: 28px 24px; color: #CBD5E1; font-size: 14px; line-height: 1.6; }
    h1 { color: #FFFFFF; font-size: 22px; font-weight: 700; margin: 0 0 12px; letter-spacing: -0.3px; }
    h2 { color: #10B981; font-size: 13px; font-weight: 700; margin: 24px 0 10px; text-transform: uppercase; letter-spacing: 1.5px; }
    p { margin: 0 0 14px; color: #CBD5E1; }
    .btn { display: inline-block; padding: 12px 24px; background: #10B981; color: #0A1110 !important; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px; letter-spacing: 0.3px; margin: 16px 0; }
    .btn-outline { background: transparent; border: 1px solid #10B981; color: #10B981 !important; }
    .alert { padding: 12px 14px; border-radius: 8px; font-size: 13px; margin: 14px 0; }
    .alert-warn { background: rgba(234,179,8,0.08); border-left: 3px solid #EAB308; color: #FDE68A; }
    .alert-danger { background: rgba(239,68,68,0.08); border-left: 3px solid #EF4444; color: #FCA5A5; }
    .alert-success { background: rgba(16,185,129,0.08); border-left: 3px solid #10B981; color: #6EE7B7; }
    .footer { padding: 16px 24px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 11px; color: #64748B; text-align: center; }
    .footer a { color: #10B981; text-decoration: none; }
</style>
</head>
<body>
<span class="preheader">${escapeHtml(preview)}</span>
<div class="container">
    <div class="card">
        <div class="accent-bar"></div>
        <div class="header">
            <div class="brand">
                <div class="logo-box">G</div>
                <div>
                    <div class="brand-text">GREEN-GATE</div>
                    <div class="brand-sub">SOVEREIGN CARBON PLATFORM</div>
                </div>
            </div>
        </div>
        <div class="body">${content}</div>
        <div class="footer">
            <p style="margin:0">${escapeHtml(sovereignLine)}</p>
            <p style="margin:4px 0 0">This is an automated message. <a href="${appUrl()}">Visit the portal</a> · AES-256 Encrypted</p>
        </div>
    </div>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ── 1. Pro-forma / Invoice email ───────────────────────────────────────────

export interface InvoiceEmailParams {
    to: string;
    /** Copies résolues par resolveInvoiceRecipients. */
    cc?: string[];
    recipientName: string;
    vesselName: string;
    invoiceRef: string;
    amountUsd: number;
    dueDate: string;
    mode: 'proforma' | 'invoice';
    badge: 'TO PAY' | 'PAID' | 'OVERDUE' | 'DISPUTED' | 'EXEMPT';
    pdfBuffer: Uint8Array;
    verifyUrl: string;
    /** Nom souverain de l'État émetteur, résolu depuis la juridiction de la transaction. */
    jurisdictionName: string;
}

export async function sendInvoiceEmail(p: InvoiceEmailParams): Promise<EmailResult> {
    const isInvoice = p.mode === 'invoice';
    const docName = isInvoice ? 'Tax Invoice' : 'Pro-forma Invoice';
    const subject = `[${p.badge}] ${docName} ${p.invoiceRef} — ${p.vesselName}`;

    // Gabarit « 1c » issu du projet design : tables inline, 600 px, Outlook-safe.
    // Les valeurs sont echappees par renderEmailTemplate — ne rien pre-formater
    // en HTML ici.
    const html = renderEmailTemplate(TX_PROFORMA_INVOICE_HTML, {
        docName,
        docNameLower: docName.toLowerCase(),
        invoiceRef: p.invoiceRef,
        recipientName: p.recipientName,
        vesselName: p.vesselName,
        jurisdictionName: p.jurisdictionName,
        amount: usd(p.amountUsd),
        dueDate: p.dueDate,
        badge: p.badge,
        verifyUrl: p.verifyUrl,
    });

    return sendEmail({
        to: p.to,
        cc: p.cc,
        subject,
        html,
        text: `${docName} ${p.invoiceRef}\n\nVessel: ${p.vesselName}\nAmount: $${p.amountUsd.toLocaleString()}\nStatus: ${p.badge}\nDue: ${p.dueDate}\n\nVerify at: ${p.verifyUrl}`,
        attachments: [
            {
                filename: `${p.mode}-${p.invoiceRef}.pdf`,
                content: Buffer.from(p.pdfBuffer),
            },
        ],
    });
}

// ── 2. Payment confirmation email ──────────────────────────────────────────

export interface PaymentConfirmationParams {
    to: string;
    recipientName: string;
    vesselName: string;
    invoiceRef: string;
    amountUsd: number;
    paidAt: string;
    receiptUrl?: string;
    receiptRef?: string;          // RCT-YYYY-XXXX
    receiptPdfBuffer?: Uint8Array; // Attach the receipt PDF directly
    /** Etat souverain porte en pied. Defaut : l'emetteur historique. */
    jurisdictionName?: string;
}

export async function sendPaymentConfirmationEmail(p: PaymentConfirmationParams): Promise<EmailResult> {
    const subject = `Payment Received — ${p.invoiceRef} ($${p.amountUsd.toLocaleString()})`;
    const html = renderEmailTemplate(TX_PAYMENT_CONFIRMATION_HTML, {
        recipientName: p.recipientName,
        vesselName: p.vesselName,
        invoiceRef: p.invoiceRef,
        // Le recu est optionnel : un encaissement confirme avant generation du
        // PDF ne doit pas bloquer l'envoi.
        receiptRef: p.receiptRef ?? '—',
        amount: usd(p.amountUsd),
        paidAt: p.paidAt,
        portalUrl: `${appUrl()}${OWNER_INVOICES_PATH}`,
        jurisdictionName: p.jurisdictionName ?? DEFAULT_SOVEREIGN,
    });

    return sendEmail({
        to: p.to,
        subject,
        html,
        text: `Payment confirmed for ${p.invoiceRef}\nReceipt: ${p.receiptRef || 'see attachment'}\nVessel: ${p.vesselName}\nAmount: $${p.amountUsd.toLocaleString()}\nPaid: ${p.paidAt}`,
        attachments: p.receiptPdfBuffer
            ? [{
                filename: `${p.receiptRef || 'receipt'}.pdf`,
                content: Buffer.from(p.receiptPdfBuffer),
            }]
            : undefined,
    });
}

// ── 3. Registration approval email ─────────────────────────────────────────

export interface RegistrationApprovalParams {
    to: string;
    recipientName: string;
    role: string;
    operationalSite: string;
    activationUrl: string;
    temporaryPassword?: string;
}

export async function sendRegistrationApprovalEmail(p: RegistrationApprovalParams): Promise<EmailResult> {
    const subject = `Welcome to Green Gate — Your account has been approved`;
    const content = `
        <h1>Account Approved ✓</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>Your application to access the Green Gate Sovereign Carbon Platform has been reviewed and <strong>approved</strong>.</p>

        <h2>Account Details</h2>
        ${metaRow(`Email`, escapeHtml(p.to))}
        ${metaRow(`Role`, escapeHtml(p.role.replace('_', ' ')))}
        ${metaRow(`Site`, escapeHtml(p.operationalSite.replace('_', ' ')))}

        ${p.temporaryPassword
            ? `<div class="alert alert-warn">A temporary password has been set: <strong style="font-family:monospace">${escapeHtml(p.temporaryPassword)}</strong>. You will be required to change it on first login.</div>`
            : ''}

        <a href="${escapeHtml(p.activationUrl)}" class="btn">Activate Your Account →</a>

        <p style="margin-top:24px">If you did not request access to this platform, please ignore this email or contact our security team.</p>
    `;

    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: `Your Green Gate account is now active` }),
        text: `Welcome to Green Gate\n\nYour account has been approved.\nRole: ${p.role}\nSite: ${p.operationalSite}\n\nActivate: ${p.activationUrl}`,
    });
}

// ── 4. Partnership request confirmation email ──────────────────────────────

export interface PartnershipConfirmationParams {
    to: string;
    contactName: string;
    organizationName: string;
    partnershipType: string;
    requestId: string;
}

export async function sendPartnershipConfirmationEmail(p: PartnershipConfirmationParams): Promise<EmailResult> {
    const subject = `Partnership Request Received — ${p.organizationName}`;
    const content = `
        <h1>Thank You for Your Interest</h1>
        <p>Dear ${escapeHtml(p.contactName)},</p>
        <p>We have received your partnership request from <strong>${escapeHtml(p.organizationName)}</strong>. Our team will review it and respond within <strong>5 business days</strong>.</p>

        <h2>Request Summary</h2>
        ${metaRow(`Reference`, escapeHtml(p.requestId), { value: 'font-family:monospace' })}
        ${metaRow(`Organization`, escapeHtml(p.organizationName))}
        ${metaRow(`Type`, escapeHtml(p.partnershipType.replace('_', ' ')))}

        <div class="alert alert-success">Your request is in our queue. Please reference <strong>${escapeHtml(p.requestId)}</strong> in any follow-up correspondence.</div>

        <p>In the meantime, feel free to explore our public dashboard to learn more about how Green Gate is securing Africa's maritime climate wealth.</p>

        <a href="${appUrl()}" class="btn-outline btn">Visit Our Platform →</a>
    `;

    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: `Your partnership request has been received` }),
        text: `Partnership request received\n\nOrganization: ${p.organizationName}\nReference: ${p.requestId}\n\nWe'll respond within 5 business days.`,
    });
}

// ── 5. (supprimé) Relance « overdue » du cron pré-Plan 7 ─────────────────────
// Le cron /api/cron/overdue-alerts fabriquait une référence INV-<année>-<segment>
// et un lien /verify sans signature : chaque destinataire tombait sur « Unknown
// Document ». La relance vit dans le moteur de recouvrement (collection-reminders).

// ── 6. Armateur invitation email ─────────────────────────────────────────────
//
// Sent by MANAGER / PORT_OFFICER / SUPERADMIN when onboarding a new shipping
// agent. The recipient clicks the link → /auth/sl exchanges it for a Supabase
// session → /auth/setup-password lets them choose their password → /dashboard.
//
// The link has a 6h TTL (configurable). The signed envelope is generated via
// lib/auth/signedLink.ts so it cannot be forged.

export interface ArmateurInviteParams {
    to: string;
    recipientName: string;
    inviterName: string;       // who sent the invite (e.g. "Hassan Mahdi, Operations Manager")
    orgName?: string;          // optional org name for personalization
    inviteUrl: string;         // signed link — /auth/sl?t=...&r=/auth/setup-password
    ttlHours: number;          // for the "valid for X hours" message
}

export async function sendArmateurInviteEmail(p: ArmateurInviteParams): Promise<EmailResult> {
    const subject = `You're invited to Green Gate — Set up your shipping agent account`;
    const html = renderEmailTemplate(TX_AGENT_INVITE_HTML, {
        recipientName: p.recipientName,
        inviterName: p.inviterName,
        email: p.to,
        orgName: p.orgName ?? '—',
        ttlHours: p.ttlHours,
        inviteUrl: p.inviteUrl,
    });

    return sendEmail({
        to: p.to,
        subject,
        html,
        text: `You've been invited to Green Gate as a Shipping Agent by ${p.inviterName}.\n\nActivate your account: ${p.inviteUrl}\n\nThis link expires in ${p.ttlHours} hours.`,
    });
}

// ── 7. Shipowner registration rejection email ──────────────────────────────

export interface ShipownerRejectionParams {
    to: string;
    reason: string;
    language: string;
}

export async function sendShipownerRejectionEmail(p: ShipownerRejectionParams): Promise<EmailResult> {
    const subject = p.language === 'fr'
        ? "Demande d'inscription rejetée"
        : 'Registration rejected';

    const content = p.language === 'fr'
        ? `
        <h1>Demande d'inscription rejetée</h1>
        <p>Bonjour,</p>
        <p>Malheureusement, votre demande d'inscription au portail armateur a été rejetée pour le motif suivant :</p>
        <div class="alert alert-danger" style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(p.reason)}</div>
        <p>Vous pouvez soumettre une nouvelle demande à tout moment si vous souhaitez nous fournir des informations supplémentaires ou clarifier les points relevés.</p>
        <a href="${appUrl()}" class="btn">Revenir au portail →</a>
        <p style="margin-top:24px;font-size:12px;color:#94A3B8">Si vous avez des questions, veuillez contacter notre équipe support.</p>
        `
        : `
        <h1>Registration Rejected</h1>
        <p>Hello,</p>
        <p>Unfortunately, your shipowner portal registration has been rejected for the following reason:</p>
        <div class="alert alert-danger" style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(p.reason)}</div>
        <p>You may submit a new request at any time if you wish to provide additional information or clarify the points raised.</p>
        <a href="${appUrl()}" class="btn">Return to Portal →</a>
        <p style="margin-top:24px;font-size:12px;color:#94A3B8">If you have questions, please contact our support team.</p>
        `;

    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: p.language === 'fr' ? 'Votre demande a été rejetée' : 'Your request has been rejected' }),
        text: p.language === 'fr'
            ? `Votre demande d'inscription au portail armateur a été rejetée.\n\nMotif:\n${p.reason}\n\nVous pouvez soumettre une nouvelle demande à tout moment.`
            : `Your shipowner portal registration has been rejected.\n\nReason:\n${p.reason}\n\nYou may submit a new request at any time.`,
    });
}

// ── 8. Shipowner registration completion request email ────────────────────

export interface ShipownerCompletionRequestParams {
    shipownerId: string;
    missingItems: string;
}

export async function sendShipownerCompletionRequestEmail(p: ShipownerCompletionRequestParams): Promise<void> {
    const { createPlatformClient } = await import('@/lib/supabase/tenant');
    // Reads one shipowner by id to populate the email; the calling action already
    // enforced the jurisdiction gate. Global helper → UNSCOPED platform client.
    const supabase = createPlatformClient();

    const { data: row } = await supabase
        .from('shipowners')
        .select('official_email, preferred_language')
        .eq('id', p.shipownerId)
        .single();

    if (!row?.official_email) return;

    const language = row.preferred_language ?? 'en';
    const subject = language === 'fr'
        ? 'Information complémentaire requise'
        : 'Additional information required';

    const content = language === 'fr'
        ? `
        <h1>Information complémentaire requise</h1>
        <p>Bonjour,</p>
        <p>Notre équipe a examiné votre demande d'inscription au portail armateur. Nous avons besoin des éléments suivants pour finaliser votre inscription :</p>
        <div class="alert alert-warn" style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(p.missingItems)}</div>
        <p>Veuillez nous transmettre ces documents ou informations en répondant à ce courriel. Notre équipe vous contactera une fois les éléments reçus.</p>
        <a href="${appUrl()}" class="btn">Accéder au portail →</a>
        <p style="margin-top:24px;font-size:12px;color:#94A3B8">N'hésitez pas à nous contacter si vous avez des questions.</p>
        `
        : `
        <h1>Additional Information Required</h1>
        <p>Hello,</p>
        <p>Our team has reviewed your shipowner portal registration request. We need the following items to complete your registration:</p>
        <div class="alert alert-warn" style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(p.missingItems)}</div>
        <p>Please send us these documents or information by replying to this email. Our team will contact you once we have received the items.</p>
        <a href="${appUrl()}" class="btn">Access Portal →</a>
        <p style="margin-top:24px;font-size:12px;color:#94A3B8">Feel free to contact us if you have any questions.</p>
        `;

    const result = await sendEmail({
        to: row.official_email,
        subject,
        html: emailLayout(content, { previewText: language === 'fr' ? 'Information complémentaire requise' : 'Additional information required' }),
        text: language === 'fr'
            ? `Information complémentaire requise\n\nÉléments manquants:\n${p.missingItems}\n\nVeuillez nous transmettre ces documents en répondant à ce courriel.`
            : `Additional information required\n\nMissing items:\n${p.missingItems}\n\nPlease send us these documents by replying to this email.`,
    });

    if (!result.success) {
        throw new Error(`Email send failed: ${result.error ?? 'unknown error'}`);
    }
}

// ── 9. Payment rejected email (Plan 7F) ────────────────────────────────────

export interface PaymentRejectedParams {
    to: string;
    recipientName: string;
    invoiceRef: string;
    reason: string;
}

export async function sendPaymentRejectedEmail(p: PaymentRejectedParams): Promise<EmailResult> {
    const subject = `Payment declined — ${p.invoiceRef}`;
    const content = `
        <h1 style="color:#EF4444">Payment Declined</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>We were unable to confirm your payment for invoice <strong style="font-family:monospace">${escapeHtml(p.invoiceRef)}</strong>.</p>

        <div class="alert alert-danger" style="white-space: pre-wrap; word-wrap: break-word;"><strong>Reason:</strong> ${escapeHtml(p.reason)}</div>

        <h2>Next Steps</h2>
        <p>Please review the reason above and submit a new payment via your portal. If you believe this is an error, contact our support team.</p>

        <a href="${appUrl()}${OWNER_INVOICES_PATH}" class="btn">Review Invoice →</a>

        <p style="margin-top:24px;font-size:12px;color:#94A3B8">Reference: ${escapeHtml(p.invoiceRef)}</p>
    `;

    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: `Payment declined for ${p.invoiceRef}` }),
        text: `Payment declined for ${p.invoiceRef}\n\nReason: ${p.reason}\n\nPlease submit a new payment via your portal.`,
    });
}

// ── 10. Pro-forma reminder email (Plan 7F) ─────────────────────────────────

export interface ProformaReminderParams {
    to: string;
    cc?: string[];
    recipientName: string;
    invoiceRef: string;
    amountUsd: number;
    ageDays: number;
    /** Palier de relance — pilote le ton. Absent = rappel courtois générique. */
    tier?: 'J3' | 'J7' | 'J15' | 'J30' | 'J45';
    /** PDF de la pro-forma, joint quand il est disponible. Absent = envoi quand même. */
    pdfBuffer?: Uint8Array;
}

/** Objet + bandeau d'alerte selon le palier. */
function reminderTone(tier: ProformaReminderParams['tier'], invoiceRef: string, ageDays: number): {
    subject: string;
    heading: string;
    alertClass: string;
    alertText: string;
} {
    switch (tier) {
        case 'J30':
            return {
                subject: `Formal notice — overdue invoice ${invoiceRef}`,
                heading: 'Formal Notice of Overdue Payment',
                alertClass: 'alert-danger',
                alertText: 'This is a formal demand for payment. Failure to settle this invoice may lead to enforcement proceedings and additional recovery costs.',
            };
        case 'J45':
            return {
                subject: `Final notice before bailiff referral — ${invoiceRef}`,
                heading: 'Final Notice — Bailiff Referral Imminent',
                alertClass: 'alert-danger',
                alertText: 'Unless this invoice is settled without further delay, the file will be referred to a bailiff (huissier) for legal recovery, at your expense.',
            };
        case 'J15':
            return {
                subject: `Reminder: invoice ${invoiceRef} still unpaid`,
                heading: 'Payment Reminder',
                alertClass: 'alert-warn',
                alertText: 'Please settle this invoice promptly to avoid escalation and late-payment interest.',
            };
        default: // J3, J7, ou absence de tier
            return {
                subject: `Reminder: invoice ${invoiceRef} pending (${ageDays} days)`,
                heading: 'Payment Reminder',
                alertClass: 'alert-warn',
                alertText: 'Please settle this invoice at your earliest convenience to avoid port-clearance delays and late-payment interest.',
            };
    }
}

export async function sendProformaReminderEmail(p: ProformaReminderParams): Promise<EmailResult> {
    const t = reminderTone(p.tier, p.invoiceRef, p.ageDays);
    const content = `
        <h1>${t.heading}</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>Pro-forma invoice <strong style="font-family:monospace">${escapeHtml(p.invoiceRef)}</strong> has been outstanding for <strong>${p.ageDays} days</strong>.</p>

        <h2>Summary</h2>
        ${metaRow(`Invoice`, escapeHtml(p.invoiceRef), { value: 'font-family:monospace' })}
        ${metaRow(`Amount Due`, `$${p.amountUsd.toLocaleString('en-US')}`, { value: 'color:#EAB308;font-size:16px' })}
        ${metaRow(`Age`, `${p.ageDays} days`)}

        <div class="alert ${t.alertClass}">${t.alertText}</div>

        <a href="${appUrl()}${OWNER_INVOICES_PATH}" class="btn">Pay Invoice →</a>

        <p style="margin-top:24px;font-size:12px;color:#94A3B8">Reference: ${escapeHtml(p.invoiceRef)}</p>
    `;

    return sendEmail({
        to: p.to,
        cc: p.cc,
        subject: t.subject,
        html: emailLayout(content, { previewText: `${p.invoiceRef} — $${p.amountUsd.toLocaleString('en-US')}` }),
        text: `${t.subject}\nAmount: $${p.amountUsd.toLocaleString('en-US')}\n\nPay at: ${appUrl()}${OWNER_INVOICES_PATH}`,
        attachments: p.pdfBuffer
            ? [{ filename: `${p.invoiceRef}.pdf`, content: Buffer.from(p.pdfBuffer) }]
            : undefined,
    });
}

// ── Collection escalation notice (B3 — manual bailiff/judicial) ────────────
// Distinct from the automatic reminders: a legal-recovery NOTIFICATION (not a
// legal service of process) sent by staff, with the invoice PDF attached and
// the issuing jurisdiction's sovereign footer.

export interface CollectionEscalationParams {
    tier: 'BAILIFF' | 'JUDICIAL';
    to: string;
    cc?: string[];
    recipientName: string;
    invoiceRef: string;
    amountUsd: number;
    jurisdictionName: string;
    vesselName?: string;
    pdfBuffer: Uint8Array;
}

function escalationTone(tier: 'BAILIFF' | 'JUDICIAL', invoiceRef: string): {
    subject: string; heading: string; alertText: string;
} {
    if (tier === 'JUDICIAL') {
        return {
            subject: `Judicial recovery proceedings — ${invoiceRef}`,
            heading: 'Notice of Judicial Recovery Proceedings',
            alertText: 'Judicial recovery proceedings have been initiated for this outstanding debt. You are urged to settle immediately to avoid further legal costs.',
        };
    }
    return {
        subject: `Bailiff referral — ${invoiceRef}`,
        heading: 'Notice of Referral to Bailiff (Huissier)',
        alertText: 'This outstanding debt has been referred to a bailiff (huissier) for legal recovery, at your expense. Immediate settlement is required to halt enforcement.',
    };
}

export async function sendCollectionEscalationEmail(p: CollectionEscalationParams): Promise<EmailResult> {
    const t = escalationTone(p.tier, p.invoiceRef);
    const vesselRow = p.vesselName
        ? metaRow(`Vessel`, escapeHtml(p.vesselName))
        : '';
    const content = `
        <h1>${t.heading}</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>Regarding outstanding pro-forma invoice <strong style="font-family:monospace">${escapeHtml(p.invoiceRef)}</strong>:</p>

        <h2>Summary</h2>
        ${metaRow(`Invoice`, escapeHtml(p.invoiceRef), { value: 'font-family:monospace' })}
        ${vesselRow}
        ${metaRow(`Amount Due`, `$${p.amountUsd.toLocaleString()}`, { value: 'color:#EF4444;font-size:16px' })}

        <div class="alert alert-danger">${t.alertText}</div>

        <p style="margin-top:24px;font-size:12px;color:#94A3B8">This is an automated notification. Reference: ${escapeHtml(p.invoiceRef)}</p>
    `;

    return sendEmail({
        to: p.to,
        cc: p.cc,
        subject: t.subject,
        html: emailLayout(content, {
            previewText: `${t.subject} — $${p.amountUsd.toLocaleString()}`,
            sovereignLine: `${p.jurisdictionName} · Maritime Carbon Tax Authority`,
        }),
        text: `${t.subject}\nInvoice: ${p.invoiceRef}\nAmount: $${p.amountUsd.toLocaleString()}\n\n${t.alertText}`,
        attachments: [
            { filename: `invoice-${p.invoiceRef}.pdf`, content: Buffer.from(p.pdfBuffer) },
        ],
    });
}

// ── 10b. Pro-forma ISSUED email (issuance-time notice) ─────────────────────
// Sent when a pro-forma is first issued. On the AIR path there is no matched
// agent, so this is how the operator is emailed about a freshly-billed
// proforma (dispatched via notifyOwner / notification-email-loop).

export interface ProformaIssuedParams {
    to: string;
    recipientName: string;
    invoiceRef: string;
    amountUsd: number;
    vesselName?: string;
}

export async function sendProformaIssuedEmail(p: ProformaIssuedParams): Promise<EmailResult> {
    const subject = `Pro-forma invoice ${p.invoiceRef} — $${p.amountUsd.toLocaleString()}`;
    const assetRow = p.vesselName
        ? metaRow(`Asset`, escapeHtml(p.vesselName))
        : '';
    const content = `
        <h1>Pro-forma Invoice Issued</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>A pro-forma carbon-tax invoice <strong style="font-family:monospace">${escapeHtml(p.invoiceRef)}</strong> has been issued for your account.</p>

        <h2>Summary</h2>
        ${metaRow(`Invoice`, escapeHtml(p.invoiceRef), { value: 'font-family:monospace' })}
        ${assetRow}
        ${metaRow(`Amount Due`, `$${p.amountUsd.toLocaleString()}`, { value: 'color:#EAB308;font-size:16px' })}

        <div class="alert alert-warn">Please review and settle this pro-forma invoice from your portal. Late settlement may incur port-clearance delays and interest.</div>

        <a href="${appUrl()}${OWNER_INVOICES_PATH}" class="btn">View Invoice →</a>

        <p style="margin-top:24px;font-size:12px;color:#94A3B8">Reference: ${escapeHtml(p.invoiceRef)}</p>
    `;

    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: `${p.invoiceRef} issued — $${p.amountUsd.toLocaleString()}` }),
        text: `Pro-forma invoice ${p.invoiceRef} issued\nAmount: $${p.amountUsd.toLocaleString()}\n\nView at: ${appUrl()}${OWNER_INVOICES_PATH}`,
    });
}

// ── Monthly statement email (chantier C) ───────────────────────────────────

export interface StatementReadyParams {
    to: string;
    recipientName: string;
    periodLabel: string;
    totalOutstandingUsd: number;
    pdfBuffer?: Uint8Array;
    /** Nombre de pro-formas emis sur la periode, affiche au recapitulatif. */
    invoiceCount?: number;
    /** Etat souverain porte en pied. Defaut : l'emetteur historique. */
    jurisdictionName?: string;
}

export async function sendStatementReadyEmail(p: StatementReadyParams): Promise<EmailResult> {
    const subject = `Account statement — ${p.periodLabel}`;
    const html = renderEmailTemplate(TX_MONTHLY_STATEMENT_HTML, {
        recipientName: p.recipientName,
        periodLabel: p.periodLabel,
        invoiceCount: p.invoiceCount ?? 0,
        amount: usd(p.totalOutstandingUsd),
        portalUrl: `${appUrl()}${OWNER_INVOICES_PATH}`,
        jurisdictionName: p.jurisdictionName ?? DEFAULT_SOVEREIGN,
    });
    return sendEmail({
        to: p.to,
        subject,
        html,
        text: `Account statement ${p.periodLabel}\nTotal outstanding: $${p.totalOutstandingUsd.toLocaleString()}\n\nView at: ${appUrl()}${OWNER_INVOICES_PATH}`,
        attachments: p.pdfBuffer ? [{ filename: `statement-${p.periodLabel.replace(/\s/g, '-')}.pdf`, content: Buffer.from(p.pdfBuffer) }] : undefined,
    });
}

// ── Consolidated collection recap email (Task 12 — on-demand, not archived) ─
// Distinct from sendStatementReadyEmail above: that one announces an
// INFORMATIONAL monthly statement and points to the portal ("not an
// invoice"). This one carries a recovery tone, lists every open pro-forma
// with its age, and always attaches the PDF (never optional) — it is a
// collection gesture sent on demand by staff, not a courtesy notice.
// Mixing the two tones would blur what the recipient is being told.

export interface CollectionRecapParams {
    to: string;
    cc?: string[];
    recipientName: string;
    lines: { invoiceRef: string; vesselName: string; issuedAt: string; ageDays: number; outstandingUsd: number }[];
    totalOutstandingUsd: number;
    jurisdictionName: string;
    pdfBuffer: Uint8Array;
}

export async function sendCollectionRecapEmail(p: CollectionRecapParams): Promise<EmailResult> {
    const subject = `Consolidated statement of account — $${p.totalOutstandingUsd.toLocaleString('en-US')} outstanding`;
    const rows = p.lines.map((l) => `
        ${metaRow(`${escapeHtml(l.invoiceRef)} · ${escapeHtml(l.vesselName)} · ${l.ageDays}d`, `$${l.outstandingUsd.toLocaleString('en-US')}`, { label: 'font-family:monospace' })}`).join('');
    const content = `
        <h1>Consolidated Recovery Statement</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>The following pro-forma invoices remain unpaid on your account with the ${escapeHtml(p.jurisdictionName)} Maritime Carbon Tax Authority.</p>

        <h2>Outstanding Invoices (${p.lines.length})</h2>
        ${rows}

        <div class="alert alert-warn">Total outstanding: <strong>$${p.totalOutstandingUsd.toLocaleString('en-US')}</strong>. Please settle these invoices promptly to avoid further collection action.</div>

        <a href="${appUrl()}${OWNER_INVOICES_PATH}" class="btn">Pay Outstanding Invoices →</a>

        <p style="margin-top:24px;font-size:12px;color:#94A3B8">A consolidated statement is attached as a PDF for your records.</p>
    `;

    return sendEmail({
        to: p.to,
        cc: p.cc,
        subject,
        html: emailLayout(content, {
            previewText: `${p.lines.length} invoice(s) — $${p.totalOutstandingUsd.toLocaleString('en-US')} outstanding`,
            sovereignLine: `${p.jurisdictionName} · Maritime Carbon Tax Authority`,
        }),
        text: `Consolidated statement of account\n\n${p.lines.map((l) => `${l.invoiceRef} — ${l.vesselName} — ${l.ageDays}d — $${l.outstandingUsd.toLocaleString('en-US')}`).join('\n')}\n\nTotal outstanding: $${p.totalOutstandingUsd.toLocaleString('en-US')}\n\nPay at: ${appUrl()}${OWNER_INVOICES_PATH}`,
        attachments: [
            { filename: `consolidated-recap-${new Date().toISOString().slice(0, 10)}.pdf`, content: Buffer.from(p.pdfBuffer) },
        ],
    });
}

// ── 11. Wallet top-up email (Plan 7F) ──────────────────────────────────────

export interface WalletTopupParams {
    to: string;
    recipientName: string;
    amountUsd: number;
    newBalanceUsd: number;
}

export async function sendWalletTopupEmail(p: WalletTopupParams): Promise<EmailResult> {
    const subject = `Wallet topped up — +$${p.amountUsd.toLocaleString()}`;
    const content = `
        <h1>Wallet Topped Up ✓</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>Your Green Gate wallet has been credited successfully.</p>

        <div class="alert alert-success">Credit applied: <strong>+$${p.amountUsd.toLocaleString()}</strong></div>

        <h2>Wallet Summary</h2>
        ${metaRow(`Top-up Amount`, `+$${p.amountUsd.toLocaleString()}`, { value: 'color:#10B981;font-size:16px' })}
        ${metaRow(`New Balance`, `$${p.newBalanceUsd.toLocaleString()}`, { value: 'color:#10B981;font-size:16px' })}

        <p>Your wallet balance can be applied automatically to future pro-forma invoices, or manually from the portal.</p>

        <a href="${appUrl()}${OWNER_WALLET_PATH}" class="btn">View Wallet →</a>
    `;

    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: `Wallet credited: +$${p.amountUsd.toLocaleString()}` }),
        text: `Wallet topped up: +$${p.amountUsd.toLocaleString()}\nNew balance: $${p.newBalanceUsd.toLocaleString()}\n\nView at: ${appUrl()}${OWNER_WALLET_PATH}`,
    });
}

// ── 12. KYC / registration rejection email (Plan 7F) ───────────────────────

export interface KycRejectedParams {
    to: string;
    recipientName: string;
    reason: string;
}

export async function sendKycRejectedEmail(p: KycRejectedParams): Promise<EmailResult> {
    const subject = `Registration not approved`;
    const content = `
        <h1 style="color:#EF4444">Registration Not Approved</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>Thank you for your interest in the Green Gate Sovereign Carbon Platform. After review, we are unable to approve your registration at this time.</p>

        <div class="alert alert-danger" style="white-space: pre-wrap; word-wrap: break-word;"><strong>Reason:</strong> ${escapeHtml(p.reason)}</div>

        <h2>Next Steps</h2>
        <p>You may submit a new registration request at any time with additional information or clarifications. If you have questions, please contact our support team.</p>

        <a href="${appUrl()}" class="btn">Return to Portal →</a>

        <p style="margin-top:24px;font-size:12px;color:#94A3B8">If you believe this decision was made in error, please reply to this email.</p>
    `;

    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: `Your registration was not approved` }),
        text: `Registration not approved\n\nReason: ${p.reason}\n\nYou may submit a new request at any time.`,
    });
}

// ── 12b. Vessel access code email (public claim funnel) ────────────────────
//
// Sent by requestVesselAccessCode when a shipowner requests self-service
// account linking from the public vessel-lookup page. The code is minted
// server-side via admin.auth.admin.generateLink({ type: 'magiclink' }) and
// mailed here as plain text — GoTrue's own "Magic Link" / "Confirm signup"
// templates only carry {{ .ConfirmationURL }}, never {{ .Token }} (every
// [auth.email.template.*] block is commented out in supabase/config.toml),
// so relying on supabase.auth.signInWithOtp() to deliver a six-digit code
// does not work. This function is the custom-email half of that pattern —
// no i18n: the destination is always shipowners.official_email, never a
// visitor-facing surface, so a single English copy is sufficient (see spec
// 2026-08-12 G4).

export interface LoginLinkParams {
    to: string;
    recipientName?: string;
    /** Lien miné par generateLink — à usage unique et de courte durée. */
    link: string;
    /**
     * Code à six chiffres, issu du MÊME jeton que le lien : consommer l'un
     * consomme l'autre. Les deux sont proposés ensemble parce qu'un client de
     * messagerie qui réécrit ou neutralise les liens condamnerait l'accès.
     */
    code: string;
    /** Navire ayant permis de retrouver le compte, quand l'accès vient d'un IMO. */
    vesselName?: string | null;
}

/**
 * Lien de connexion au portail.
 *
 * Le lien est miné côté serveur puis envoyé par Resend, comme le code d'accès
 * navire : les modèles GoTrue ne sont pas configurés (tous les blocs
 * [auth.email.template.*] sont commentés dans supabase/config.toml), et
 * laisser Supabase l'envoyer produirait un courriel par défaut, hors charte,
 * et non traduit.
 *
 * Le message ne dit jamais quel dossier il ouvre : il part parfois vers une
 * adresse simplement reconnue, et nommer l'armateur renseignerait un tiers
 * sur qui est débiteur.
 */
export async function sendLoginLinkEmail(p: LoginLinkParams): Promise<EmailResult> {
    // Rappelle le navire quand l'accès a été demandé par IMO ou MMSI : c'est
    // souvent un manager qui reçoit, pour une flotte entière. Sans cette ligne
    // il ne saurait pas de quel dossier il s'agit.
    const vesselLine = p.vesselName
        ? metaRow(`Vessel`, escapeHtml(p.vesselName))
        : '';

    const content = `
        <h1>Sign in to Green Gate</h1>
        <p>Dear ${escapeHtml(p.recipientName ?? 'Shipowner')},</p>
        <p>Use the button below to open your Green Gate account, or enter the code on the sign-in page. No password is required.</p>
        ${vesselLine}

        <a href="${p.link}" class="btn">Sign In →</a>

        <div style="text-align:center;margin:20px 0">
            <span style="display:inline-block;padding:14px 28px;background:rgba(16,185,129,0.1);border:1px solid #10B981;border-radius:10px;font-size:28px;font-weight:800;letter-spacing:6px;color:#10B981;font-family:monospace">${escapeHtml(p.code)}</span>
        </div>

        <div class="alert alert-warn">The link and the code are the same single-use credential — using either one consumes both. They expire shortly. If you did not request this, you can safely ignore this email: no account changes will be made.</div>

        <p style="margin-top:24px;font-size:12px;color:#94A3B8">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${escapeHtml(p.link)}</span></p>
    `;

    return sendEmail({
        to: p.to,
        subject: `Your Green Gate sign-in code: ${p.code}`,
        html: emailLayout(content, { previewText: `Sign-in code ${p.code} — single use, expires shortly` }),
        text: `Sign in to Green Gate\n\n${p.vesselName ? `Vessel: ${p.vesselName}\n\n` : ''}Code: ${p.code}\n\nOr open this link (single use, expires shortly):\n${p.link}\n\nThe link and the code are the same credential — using either one consumes both. If you did not request this, ignore this email; no account changes will be made.`,
    });
}

export interface MemberInvitedParams {
    to: string;
    recipientName?: string;
    memberName: string;
    memberEmail: string;
    invitedBy: string;
    /** Libellés des droits accordés ; vide = consultation seule. */
    granted: string[];
    updated: boolean;
}

/**
 * Prévient le titulaire qu'un membre a ouvert (ou modifié) un accès au compte.
 *
 * Écrit à l'adresse officielle du dossier : c'est le seul canal qui atteint le
 * titulaire sans qu'il ait à ouvrir le portail. Le message dit qui a agi — sans
 * cela, il ne reste qu'un accès apparu de nulle part.
 */
export async function sendMemberInvitedEmail(p: MemberInvitedParams): Promise<EmailResult> {
    const rights = p.granted.length > 0
        ? p.granted.map((g) => escapeHtml(g)).join(', ')
        : 'View only';
    const verb = p.updated ? 'updated the access of' : 'granted access to';

    const content = `
        <h1>${p.updated ? 'Account access updated' : 'New access to your account'}</h1>
        <p>Dear ${escapeHtml(p.recipientName ?? 'Shipowner')},</p>
        <p>${escapeHtml(p.invitedBy)} ${verb} <strong>${escapeHtml(p.memberName)}</strong> (${escapeHtml(p.memberEmail)}) on your Green Gate account.</p>
        ${metaRow(`Rights`, rights)}
        <a href="${appUrl()}/owner/profile" class="btn">Review account members →</a>
        <div class="alert alert-warn">If this access was not expected, remove it from the members section of your profile. Removing an access takes effect immediately.</div>
    `;

    return sendEmail({
        to: p.to,
        subject: p.updated
            ? `Access updated for ${p.memberEmail}`
            : `New access to your Green Gate account: ${p.memberEmail}`,
        html: emailLayout(content, { previewText: `${p.memberEmail} — ${rights}` }),
        text: `${p.invitedBy} ${verb} ${p.memberName} (${p.memberEmail}) on your Green Gate account.
Rights: ${p.granted.length > 0 ? p.granted.join(', ') : 'View only'}

Review members: ${appUrl()}/owner/profile

If this access was not expected, remove it from your profile.`,
    });
}

export interface MemberRevokedParams {
    to: string;
    recipientName?: string;
    memberEmail: string;
    revokedBy: string;
}

/**
 * Prévient le titulaire qu'un accès au compte a été fermé.
 *
 * Le pendant de `sendMemberInvitedEmail` : `can_invite` porte les deux gestes,
 * donc un membre peut fermer l'accès d'un autre. Ne signaler que l'ouverture
 * laisserait passer le retrait, qui est le plus lourd de conséquences.
 */
export async function sendMemberRevokedEmail(p: MemberRevokedParams): Promise<EmailResult> {
    const content = `
        <h1>Account access removed</h1>
        <p>Dear ${escapeHtml(p.recipientName ?? 'Shipowner')},</p>
        <p>${escapeHtml(p.revokedBy)} removed <strong>${escapeHtml(p.memberEmail)}</strong>&apos;s access to your Green Gate account. The removal took effect immediately.</p>
        <a href="${appUrl()}/owner/profile" class="btn">Review account members →</a>
        <div class="alert alert-warn">If this removal was not intended, you can invite the person again from the members section of your profile.</div>
    `;

    return sendEmail({
        to: p.to,
        subject: `Access removed for ${p.memberEmail}`,
        html: emailLayout(content, { previewText: `${p.memberEmail} no longer has access` }),
        text: `${p.revokedBy} removed ${p.memberEmail}'s access to your Green Gate account.

Review members: ${appUrl()}/owner/profile`,
    });
}

export interface MemberAccessParams {
    to: string;
    recipientName: string;
    accountName: string;
    invitedBy: string;
    /** Libellés des droits accordés ; vide = consultation seule. */
    granted: string[];
    link: string;
    code: string;
}

/**
 * Annonce à la personne invitée qu'un accès lui a été ouvert.
 *
 * Distinct de `sendMemberInvitedEmail`, qui prévient le TITULAIRE. Celui-ci part
 * à l'invité et porte de quoi entrer : `provisionOwnerAccount` crée le compte
 * délibérément en silence — sans ce message, la personne aurait un accès dont
 * elle ignore l'existence.
 */
export async function sendMemberAccessEmail(p: MemberAccessParams): Promise<EmailResult> {
    const rights = p.granted.length > 0 ? p.granted.map((g) => escapeHtml(g)).join(', ') : 'View only';

    const content = `
        <h1>You have access to ${escapeHtml(p.accountName)}</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>${escapeHtml(p.invitedBy)} gave you access to the Green Gate account of <strong>${escapeHtml(p.accountName)}</strong>. Use the button below to sign in, or enter the code on the sign-in page. No password is required.</p>
        ${metaRow('Rights', rights)}

        <a href="${p.link}" class="btn">Sign In →</a>

        <div style="text-align:center;margin:20px 0">
            <span style="display:inline-block;padding:14px 28px;background:rgba(16,185,129,0.1);border:1px solid #10B981;border-radius:10px;font-size:28px;font-weight:800;letter-spacing:6px;color:#10B981;font-family:monospace">${escapeHtml(p.code)}</span>
        </div>

        <div class="alert alert-warn">The link and the code are the same single-use credential — using either one consumes both. They expire shortly. If you were not expecting this, you can ignore this email; you can also ask ${escapeHtml(p.invitedBy)} to remove the access.</div>
    `;

    return sendEmail({
        to: p.to,
        subject: `Access to ${p.accountName} on Green Gate`,
        html: emailLayout(content, { previewText: `${p.accountName} — sign-in code ${p.code}` }),
        text: `${p.invitedBy} gave you access to the Green Gate account of ${p.accountName}.
Rights: ${p.granted.length > 0 ? p.granted.join(', ') : 'View only'}

Code: ${p.code}

Or open this link (single use, expires shortly):
${p.link}`,
    });
}

export interface VesselAccessCodeParams {
    to: string;
    recipientName?: string;
    code: string;
}

export async function sendVesselAccessCodeEmail(p: VesselAccessCodeParams): Promise<EmailResult> {
    const subject = `Your Green Gate access code: ${p.code}`;
    const html = renderEmailTemplate(TX_VESSEL_ACCESS_CODE_HTML, {
        recipientName: p.recipientName ?? 'Shipowner',
        code: p.code,
    });

    return sendEmail({
        to: p.to,
        subject,
        html,
        text: `Your Green Gate access code: ${p.code}\n\nEnter this code on the portal to link your account. This code can only be used once and expires shortly.`,
    });
}

// ── 13. Refund issued email (Plan 7G) ──────────────────────────────────────

export interface RefundIssuedParams {
    to: string;
    recipientName: string;
    invoiceRef: string;
    amountUsd: number;
    refundRail:
        | 'WALLET'
        | 'WIRE_TRANSFER'
        | 'STRIPE'
        | 'CASH'
        | 'CHEQUE'
        | 'MOBILE_MONEY'
        | 'THIRD_PARTY'
        | 'BANK_GUARANTEE'
        | 'NETTING'
        | 'LETTER_OF_CREDIT';
    executedAt: string; // ISO timestamp or pre-formatted display string
}

const REFUND_RAIL_LABELS: Record<RefundIssuedParams['refundRail'], string> = {
    WALLET: 'Owner wallet',
    WIRE_TRANSFER: 'Wire transfer',
    STRIPE: 'Stripe refund',
    CASH: 'Cash',
    CHEQUE: 'Cheque',
    MOBILE_MONEY: 'Mobile money',
    THIRD_PARTY: 'Third-party settlement',
    BANK_GUARANTEE: 'Bank guarantee release',
    NETTING: 'Netting',
    LETTER_OF_CREDIT: 'Letter of credit',
};

export async function sendRefundIssuedEmail(p: RefundIssuedParams): Promise<EmailResult> {
    const subject = `Refund issued for ${p.invoiceRef}`;
    const railLabel = REFUND_RAIL_LABELS[p.refundRail] ?? p.refundRail;

    // Rail-specific guidance text (kept short; full ledger view is in the portal)
    let railGuidance = '';
    if (p.refundRail === 'WALLET') {
        railGuidance = `<p>The refunded amount has been credited to your Green Gate wallet. It will be applied automatically to future pro-forma invoices, or you can use it manually from the portal.</p>`;
    } else if (p.refundRail === 'WIRE_TRANSFER') {
        railGuidance = `<p>The wire transfer has been initiated to your registered bank account. Please allow 2–5 business days for the funds to settle.</p>`;
    } else if (p.refundRail === 'STRIPE') {
        railGuidance = `<p>The refund has been submitted to Stripe and will appear on your original card statement within 5–10 business days, depending on your issuing bank.</p>`;
    } else {
        railGuidance = `<p>Settlement details for this refund method have been recorded by our finance team. Please contact support if you have any questions.</p>`;
    }

    const content = `
        <h1>Refund Issued ✓</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>A refund of <strong>$${p.amountUsd.toLocaleString()}</strong> has been issued for invoice <strong>${escapeHtml(p.invoiceRef)}</strong>.</p>

        <div class="alert alert-success">Refund amount: <strong>$${p.amountUsd.toLocaleString()}</strong></div>

        <h2>Refund Summary</h2>
        ${metaRow(`Invoice`, escapeHtml(p.invoiceRef), { value: 'font-family:monospace' })}
        ${metaRow(`Amount`, `$${p.amountUsd.toLocaleString()}`, { value: 'color:#10B981;font-size:16px' })}
        ${metaRow(`Method`, escapeHtml(railLabel))}
        ${metaRow(`Executed`, escapeHtml(p.executedAt))}

        ${railGuidance}

        <a href="${appUrl()}${OWNER_INVOICES_PATH}" class="btn">View Invoices →</a>

        <p style="margin-top:24px;font-size:12px;color:#94A3B8">— Solid Technology</p>
    `;

    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: `Refund of $${p.amountUsd.toLocaleString()} issued for ${p.invoiceRef}` }),
        text: `Refund issued for ${p.invoiceRef}\nAmount: $${p.amountUsd.toLocaleString()}\nMethod: ${railLabel}\nExecuted: ${p.executedAt}\n\nView at: ${appUrl()}${OWNER_INVOICES_PATH}`,
    });
}
