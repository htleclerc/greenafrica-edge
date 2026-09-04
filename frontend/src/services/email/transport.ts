import { Resend } from 'resend';

/**
 * Couche d'acheminement des e-mails.
 *
 * Le service d'e-mail ne doit pas dependre d'un fournisseur unique : la prod a
 * passe des semaines sans envoyer un seul lien de connexion, et aucun repli
 * n'etait possible sans rouvrir le code.
 *
 * Deux acheminements, choisis par l'environnement :
 *
 *   — `resend` : l'API HTTP de Resend. Reste le defaut quand `RESEND_API_KEY`
 *                est pose, car c'est ce que la prod utilise aujourd'hui.
 *   — `smtp`   : n'importe quel serveur SMTP — Gmail, le SMTP d'un domaine
 *                propre, ou celui d'un tiers. C'est le meme serveur qu'on
 *                renseigne cote Supabase en SMTP personnalise, de sorte que
 *                les e-mails de l'application et ceux de GoTrue partent enfin
 *                par le meme tuyau.
 *
 * `EMAIL_TRANSPORT` tranche explicitement quand les deux sont configures.
 * Sans elle, la selection se deduit de ce qui est renseigne — un deploiement
 * qui n'a que du SMTP fonctionne sans variable supplementaire.
 */

export type TransportName = 'resend' | 'smtp';

export interface OutboundEmail {
    from: string;
    to: string[];
    cc?: string[];
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
    attachments?: Array<{ filename: string; content: Buffer }>;
}

export interface DeliveryResult {
    id?: string;
    error?: string;
}

/** Configuration SMTP resolue, ou null si l'hote n'est pas renseigne. */
interface SmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
}

function smtpConfig(): SmtpConfig | null {
    const host = process.env.EMAIL_SMTP_HOST?.trim();
    if (!host) return null;

    // 465 est le seul port implicitement chiffre de bout en bout (SMTPS). 587
    // et 25 montent en TLS par STARTTLS, que nodemailer negocie avec
    // `secure: false`. Poser `secure: true` sur 587 fait pendre la connexion
    // jusqu'au delai d'attente, sans message utile — c'est le piege classique.
    const port = Number(process.env.EMAIL_SMTP_PORT ?? 587);
    const secureRaw = process.env.EMAIL_SMTP_SECURE?.trim().toLowerCase();
    const secure = secureRaw ? secureRaw === 'true' : port === 465;

    return {
        host,
        port,
        secure,
        user: process.env.EMAIL_SMTP_USER?.trim() || undefined,
        pass: process.env.EMAIL_SMTP_PASSWORD || undefined,
    };
}

/**
 * Acheminement retenu, ou null si rien n'est configure. Expose pour que le
 * diagnostic puisse dire quel tuyau est actif sans rien envoyer.
 */
export function selectedTransport(): TransportName | null {
    const forced = process.env.EMAIL_TRANSPORT?.trim().toLowerCase();
    if (forced === 'smtp') return smtpConfig() ? 'smtp' : null;
    if (forced === 'resend') return process.env.RESEND_API_KEY ? 'resend' : null;

    if (process.env.RESEND_API_KEY) return 'resend';
    if (smtpConfig()) return 'smtp';
    return null;
}

// ── Resend ─────────────────────────────────────────────────────────────────

let resendClient: Resend | null = null;
let resendKey: string | null = null;

function getResend(): Resend {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY is not configured');
    // La cle est relue a chaque appel : un client memorise sur une ancienne
    // valeur survivrait a une rotation pendant toute la vie du processus.
    if (resendClient && resendKey === apiKey) return resendClient;
    resendClient = new Resend(apiKey);
    resendKey = apiKey;
    return resendClient;
}

async function deliverViaResend(message: OutboundEmail): Promise<DeliveryResult> {
    const resend = getResend();
    const result = await resend.emails.send({
        from: message.from,
        to: message.to,
        // Resend rejette un tableau vide : on omet le champ plutot que de
        // l'envoyer vide.
        ...(message.cc?.length ? { cc: message.cc } : {}),
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
        attachments: message.attachments,
    });

    if (result.error) return { error: result.error.message };
    return { id: result.data?.id };
}

// ── SMTP ───────────────────────────────────────────────────────────────────

// `nodemailer` est charge a la demande : il ne doit pas peser sur les
// deploiements qui n'envoient que par Resend.
type NodemailerTransport = {
    sendMail(options: Record<string, unknown>): Promise<{ messageId?: string }>;
};

let smtpTransport: NodemailerTransport | null = null;
let smtpSignature: string | null = null;

async function getSmtpTransport(config: SmtpConfig): Promise<NodemailerTransport> {
    const signature = `${config.host}:${config.port}:${config.secure}:${config.user ?? ''}`;
    if (smtpTransport && smtpSignature === signature) return smtpTransport;

    const nodemailer = await import('nodemailer');
    smtpTransport = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        ...(config.user ? { auth: { user: config.user, pass: config.pass } } : {}),
    }) as unknown as NodemailerTransport;
    smtpSignature = signature;
    return smtpTransport;
}

async function deliverViaSmtp(message: OutboundEmail): Promise<DeliveryResult> {
    const config = smtpConfig();
    if (!config) return { error: 'EMAIL_SMTP_HOST is not configured' };

    const transport = await getSmtpTransport(config);
    const info = await transport.sendMail({
        from: message.from,
        to: message.to,
        ...(message.cc?.length ? { cc: message.cc } : {}),
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    });
    return { id: info.messageId };
}

/**
 * Achemine un message par le tuyau configure. Rend une erreur PORTEE plutot
 * que de lever : l'appelant journalise et rend `{ success: false }`, comme il
 * le faisait deja.
 */
export async function deliver(message: OutboundEmail): Promise<DeliveryResult> {
    const transport = selectedTransport();
    if (!transport) {
        return {
            error: 'Aucun acheminement e-mail configure : poser RESEND_API_KEY, ou '
                + 'EMAIL_SMTP_HOST (+ EMAIL_SMTP_USER / EMAIL_SMTP_PASSWORD) pour un envoi SMTP.',
        };
    }
    return transport === 'smtp' ? deliverViaSmtp(message) : deliverViaResend(message);
}
