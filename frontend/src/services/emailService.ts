import { Resend } from 'resend';

/**
 * Centralized email service for Green Gate OS notifications.
 *
 * All emails go through Resend (https://resend.com). Templates are inline
 * HTML strings with the same emerald/dark institutional brand as the rest
 * of the platform.
 *
 * Required env:
 *   - RESEND_API_KEY    (server-side only, from resend.com dashboard)
 *   - EMAIL_FROM        (verified sender address, e.g. "noreply@greengate.africa")
 *
 * Optional env:
 *   - EMAIL_REPLY_TO    (e.g. "support@greengate.africa")
 *   - NEXT_PUBLIC_APP_URL (used to build links inside emails — defaults to localhost:3300)
 */

// ── Singleton client ────────────────────────────────────────────────────────

let resendClient: Resend | null = null;

function getResend(): Resend {
    if (resendClient) return resendClient;
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
        throw new Error('RESEND_API_KEY is not configured');
    }
    resendClient = new Resend(apiKey);
    return resendClient;
}

function fromAddress(): string {
    return process.env.EMAIL_FROM || 'noreply@greengate.africa';
}

function replyTo(): string | undefined {
    return process.env.EMAIL_REPLY_TO || undefined;
}

function appUrl(): string {
    return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3300';
}

// ── Result type ────────────────────────────────────────────────────────────

export interface EmailResult {
    success: boolean;
    id?: string;
    error?: string;
}

async function sendEmail(params: {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    attachments?: Array<{ filename: string; content: Buffer | Uint8Array | string }>;
}): Promise<EmailResult> {
    try {
        const resend = getResend();
        const result = await resend.emails.send({
            from: fromAddress(),
            to: Array.isArray(params.to) ? params.to : [params.to],
            subject: params.subject,
            html: params.html,
            text: params.text,
            replyTo: replyTo(),
            attachments: params.attachments?.map((a) => ({
                filename: a.filename,
                content: a.content as Buffer,
            })),
        });

        if (result.error) {
            console.error('[Email] Resend error:', result.error);
            return { success: false, error: result.error.message };
        }

        return { success: true, id: result.data?.id };
    } catch (err) {
        console.error('[Email] Send failed:', err);
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
        };
    }
}

// ── Shared layout ──────────────────────────────────────────────────────────

function emailLayout(content: string, options?: { previewText?: string }): string {
    const preview = options?.previewText ?? '';
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
    .meta-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px; }
    .meta-label { color: #64748B; }
    .meta-value { color: #FFFFFF; font-weight: 600; }
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
                <div class="logo-box">A</div>
                <div>
                    <div class="brand-text">AFRICGREEN</div>
                    <div class="brand-sub">SOVEREIGN CARBON PLATFORM</div>
                </div>
            </div>
        </div>
        <div class="body">${content}</div>
        <div class="footer">
            <p style="margin:0">Republic of Somaliland · Maritime Carbon Tax Authority</p>
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
    recipientName: string;
    vesselName: string;
    invoiceRef: string;
    amountUsd: number;
    dueDate: string;
    mode: 'proforma' | 'invoice';
    badge: 'TO PAY' | 'PAID' | 'OVERDUE' | 'DISPUTED' | 'EXEMPT';
    pdfBuffer: Uint8Array;
    verifyUrl: string;
}

export async function sendInvoiceEmail(p: InvoiceEmailParams): Promise<EmailResult> {
    const isInvoice = p.mode === 'invoice';
    const docName = isInvoice ? 'Tax Invoice' : 'Pro-forma Invoice';
    const subject = `[${p.badge}] ${docName} ${p.invoiceRef} — ${p.vesselName}`;

    const badgeColors: Record<string, { bg: string; fg: string }> = {
        'PAID':     { bg: '#10B981', fg: '#0A1110' },
        'EXEMPT':   { bg: '#0EA5E9', fg: '#FFFFFF' },
        'OVERDUE':  { bg: '#DC2626', fg: '#FFFFFF' },
        'DISPUTED': { bg: '#F97316', fg: '#FFFFFF' },
        'TO PAY':   { bg: '#EAB308', fg: '#0A1110' },
    };
    const badge = badgeColors[p.badge];

    const content = `
        <h1>${docName} ${escapeHtml(p.invoiceRef)}</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>Please find attached the ${docName.toLowerCase()} for vessel <strong>${escapeHtml(p.vesselName)}</strong>, issued by the Maritime Carbon Tax Authority of the Republic of Somaliland.</p>

        <div style="display:inline-block;padding:6px 14px;background:${badge.bg};color:${badge.fg};font-weight:800;letter-spacing:1.5px;border-radius:4px;font-size:12px;margin:8px 0">${p.badge}</div>

        <h2>Summary</h2>
        <div class="meta-row"><span class="meta-label">Reference</span><span class="meta-value" style="font-family:monospace">${escapeHtml(p.invoiceRef)}</span></div>
        <div class="meta-row"><span class="meta-label">Vessel</span><span class="meta-value">${escapeHtml(p.vesselName)}</span></div>
        <div class="meta-row"><span class="meta-label">Amount Due</span><span class="meta-value" style="color:#10B981;font-size:16px">$${p.amountUsd.toLocaleString()}</span></div>
        <div class="meta-row"><span class="meta-label">Due Date</span><span class="meta-value" style="color:${p.badge === 'OVERDUE' ? '#EF4444' : '#FFFFFF'}">${escapeHtml(p.dueDate)}</span></div>

        ${isInvoice
            ? '<div class="alert alert-success">This invoice has been settled. Document attached for your records.</div>'
            : '<div class="alert alert-warn">Payment is required within 30 days of issuance. Late payment incurs 1.5% monthly interest.</div>'}

        <p>You can verify the authenticity and current status of this document at any time by clicking below or scanning the QR code on the PDF.</p>

        <a href="${escapeHtml(p.verifyUrl)}" class="btn">Verify Document Status →</a>

        <p style="margin-top:24px;font-size:12px;color:#64748B">Reference this document number in any correspondence: <strong style="color:#FFFFFF">${escapeHtml(p.invoiceRef)}</strong></p>
    `;

    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: `${docName} ${p.invoiceRef} — $${p.amountUsd.toLocaleString()} ${p.badge}` }),
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
}

export async function sendPaymentConfirmationEmail(p: PaymentConfirmationParams): Promise<EmailResult> {
    const subject = `Payment Received — ${p.invoiceRef} ($${p.amountUsd.toLocaleString()})`;
    const content = `
        <h1>Payment Confirmed ✓</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>We have successfully received payment for vessel <strong>${escapeHtml(p.vesselName)}</strong>. Thank you for your prompt settlement.</p>

        <div class="alert alert-success">Your account is now in good standing. Port clearance has been issued.</div>

        <h2>Payment Details</h2>
        <div class="meta-row"><span class="meta-label">Invoice</span><span class="meta-value" style="font-family:monospace">${escapeHtml(p.invoiceRef)}</span></div>
        ${p.receiptRef
            ? `<div class="meta-row"><span class="meta-label">Receipt</span><span class="meta-value" style="font-family:monospace;color:#10B981">${escapeHtml(p.receiptRef)}</span></div>`
            : ''}
        <div class="meta-row"><span class="meta-label">Vessel</span><span class="meta-value">${escapeHtml(p.vesselName)}</span></div>
        <div class="meta-row"><span class="meta-label">Amount</span><span class="meta-value" style="color:#10B981;font-size:16px">$${p.amountUsd.toLocaleString()}</span></div>
        <div class="meta-row"><span class="meta-label">Settled On</span><span class="meta-value">${escapeHtml(p.paidAt)}</span></div>

        ${p.receiptPdfBuffer
            ? '<p style="margin-top:16px;font-size:13px;color:#10B981"><strong>Your official receipt is attached to this email as a PDF.</strong> Retain it for your records and tax filings.</p>'
            : ''}

        ${p.receiptUrl
            ? `<a href="${escapeHtml(p.receiptUrl)}" class="btn">Download Receipt Online →</a>`
            : ''}

        <p style="margin-top:20px">A complete transaction record is available in your portal under <em>Invoices &amp; Payments</em>.</p>
    `;

    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: `Payment of $${p.amountUsd.toLocaleString()} confirmed` }),
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
        <div class="meta-row"><span class="meta-label">Email</span><span class="meta-value">${escapeHtml(p.to)}</span></div>
        <div class="meta-row"><span class="meta-label">Role</span><span class="meta-value">${escapeHtml(p.role.replace('_', ' '))}</span></div>
        <div class="meta-row"><span class="meta-label">Site</span><span class="meta-value">${escapeHtml(p.operationalSite.replace('_', ' '))}</span></div>

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
        <div class="meta-row"><span class="meta-label">Reference</span><span class="meta-value" style="font-family:monospace">${escapeHtml(p.requestId)}</span></div>
        <div class="meta-row"><span class="meta-label">Organization</span><span class="meta-value">${escapeHtml(p.organizationName)}</span></div>
        <div class="meta-row"><span class="meta-label">Type</span><span class="meta-value">${escapeHtml(p.partnershipType.replace('_', ' '))}</span></div>

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

// ── 5. Overdue alert email ─────────────────────────────────────────────────

export interface OverdueAlertParams {
    to: string;
    recipientName: string;
    vesselName: string;
    invoiceRef: string;
    amountUsd: number;
    daysOverdue: number;
    verifyUrl: string;
}

export async function sendOverdueAlertEmail(p: OverdueAlertParams): Promise<EmailResult> {
    const subject = `URGENT: Overdue Payment — ${p.vesselName} (${p.daysOverdue}d)`;
    const content = `
        <h1 style="color:#EF4444">⚠ Overdue Payment Notice</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>

        <div class="alert alert-danger"><strong>Port Gate Locked.</strong> Vessel <strong>${escapeHtml(p.vesselName)}</strong> has an overdue carbon tax obligation that requires immediate attention.</div>

        <h2>Outstanding Balance</h2>
        <div class="meta-row"><span class="meta-label">Invoice</span><span class="meta-value" style="font-family:monospace">${escapeHtml(p.invoiceRef)}</span></div>
        <div class="meta-row"><span class="meta-label">Vessel</span><span class="meta-value">${escapeHtml(p.vesselName)}</span></div>
        <div class="meta-row"><span class="meta-label">Amount Due</span><span class="meta-value" style="color:#EF4444;font-size:16px">$${p.amountUsd.toLocaleString()}</span></div>
        <div class="meta-row"><span class="meta-label">Days Overdue</span><span class="meta-value" style="color:#EF4444">${p.daysOverdue} days</span></div>

        <p>To restore port clearance, please settle the outstanding balance immediately. Late payment incurs <strong>1.5% monthly interest</strong> as per the Maritime Carbon Tax Act (2024).</p>

        <a href="${escapeHtml(p.verifyUrl)}" class="btn">Pay Now →</a>

        <p style="margin-top:20px;font-size:12px;color:#94A3B8">If you believe this notice was issued in error, you may file a dispute through the portal within 7 days.</p>
    `;

    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: `${p.daysOverdue} days overdue — $${p.amountUsd.toLocaleString()}` }),
        text: `OVERDUE: ${p.invoiceRef}\nVessel: ${p.vesselName}\nAmount: $${p.amountUsd.toLocaleString()}\nDays overdue: ${p.daysOverdue}\n\nPay at: ${p.verifyUrl}`,
    });
}
