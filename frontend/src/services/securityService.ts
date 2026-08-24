import type { SupabaseClient } from '@supabase/supabase-js';

/** Un facteur TOTP tel que l'écran en a besoin — jamais son secret. */
export interface MfaFactorView {
    id: string;
    friendlyName: string | null;
    /** Date de vérification, qui est celle où la protection a réellement pris effet. */
    enrolledAt: string;
}

export interface SessionView {
    id: string;
    createdAt: string;
    lastSeenAt: string;
    userAgent: string | null;
    ip: string | null;
    /** Vrai si cette session a passé un second facteur. */
    elevated: boolean;
    /** La session depuis laquelle l'écran est consulté : on ne la ferme pas par mégarde. */
    isCurrent: boolean;
}

export interface SecurityOverview {
    factors: MfaFactorView[];
    sessions: SessionView[];
    /** Vrai dès qu'un facteur vérifié existe : c'est ce que la page a le droit d'affirmer. */
    mfaEnabled: boolean;
}

interface RawSession {
    id: string;
    created_at: string | null;
    refreshed_at: string | null;
    not_after: string | null;
    user_agent: string | null;
    ip: string | null;
    aal: string | null;
    is_current: boolean | null;
}

/**
 * Ce que la page Sécurité a le droit de dire.
 *
 * Tout vient de la session de l'appelant : les facteurs de l'API GoTrue, les
 * sessions d'une fonction bornée à `auth.uid()` (mig 137). Aucun paramètre
 * n'entre ici — il n'y a donc rien à falsifier pour lire le compte d'autrui.
 *
 * Les erreurs ne remontent pas : une page de sécurité qui refuse de s'afficher
 * pousse à ignorer la sécurité. Elle montre ce qu'elle sait et tait le reste —
 * mais elle ne prétend JAMAIS qu'une protection existe : `mfaEnabled` est faux
 * quand la lecture échoue, jamais vrai par défaut.
 */
export async function loadSecurityOverview(db: SupabaseClient): Promise<SecurityOverview> {
    const [factorsRes, sessionsRes] = await Promise.all([
        db.auth.mfa.listFactors(),
        db.rpc('current_user_sessions'),
    ]);

    const verified = (factorsRes.data?.totp ?? []).filter((f) => f.status === 'verified');
    const factors: MfaFactorView[] = verified.map((f) => ({
        id: f.id,
        friendlyName: f.friendly_name ?? null,
        enrolledAt: f.updated_at ?? f.created_at,
    }));

    const rows = (sessionsRes.data ?? []) as unknown as RawSession[];
    const sessions: SessionView[] = rows.map((r) => ({
        id: r.id,
        createdAt: r.created_at ?? '',
        // GoTrue ne date le rafraîchissement qu'au premier renouvellement : une
        // session toute neuve n'a que sa date de création.
        lastSeenAt: r.refreshed_at ?? r.created_at ?? '',
        userAgent: r.user_agent,
        ip: r.ip,
        elevated: r.aal === 'aal2',
        isCurrent: r.is_current === true,
    }));

    return { factors, sessions, mfaEnabled: factors.length > 0 };
}
