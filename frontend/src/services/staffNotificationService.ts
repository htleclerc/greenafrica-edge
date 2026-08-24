import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/supabase.generated';

type Client = SupabaseClient<Database>;

/**
 * Faits notifiables du staff (mig 133).
 *
 * Peu nombreux, et volontairement : un type ne se crée que si son texte, son
 * lien profond ET son destinataire diffèrent réellement d'un type existant.
 */
export type StaffNotificationKind = Database['public']['Enums']['staff_notification_kind'];

// Le sous-ensemble de `user_role` qui reçoit des notifications staff.
// `Extract` plutôt qu'une union libre : renommer un rôle en base casse ici,
// à la compilation, plutôt qu'à l'insertion.
export type StaffRole = Extract<
    Database['public']['Enums']['user_role'],
    'PORT_OFFICER' | 'FINANCE_ADMIN' | 'MANAGER' | 'SUPERADMIN'
>;

/**
 * Qui reçoit quoi, par défaut.
 *
 * Le SUPERADMIN n'y figure jamais : la policy de la mig 133 le rend destinataire
 * de tout par construction, l'ajouter ici ne ferait que le dire deux fois.
 *
 * Le MANAGER n'apparaît que sur ce qu'il peut réellement traiter. L'arbitrage
 * du recouvrement l'a exclu du rail monétaire : lui pousser une escalade
 * l'enverrait sur un écran vide.
 */
export const DEFAULT_AUDIENCE: Record<StaffNotificationKind, StaffRole[]> = {
    VALIDATION_PENDING:     ['PORT_OFFICER'],
    REGISTRATION_SUBMITTED: ['PORT_OFFICER'],
    COLLECTION_ESCALATED:   ['FINANCE_ADMIN', 'PORT_OFFICER'],
    DEBTOR_RESPONDED:       ['FINANCE_ADMIN'],
    CASH_PAYMENT_RECORDED:  ['FINANCE_ADMIN'],
    DISPUTE_OPENED:         ['PORT_OFFICER', 'FINANCE_ADMIN'],
};

const NS = 'StaffNotifications.kind';

export function titleKeyFor(kind: StaffNotificationKind): string {
    return `${NS}.${kind}.title`;
}
export function bodyKeyFor(kind: StaffNotificationKind): string {
    return `${NS}.${kind}.body`;
}

export interface NotifyStaffInput {
    jurisdictionId: string;
    kind: StaffNotificationKind;
    /** Interpolations du message. Restent en JSONB, jamais de texte pré-traduit. */
    // `Json` et non `Record<string, unknown>` : la colonne est du jsonb, et
    // `unknown` laisserait passer une valeur non sérialisable qui n'échouerait
    // qu'à l'insertion.
    params?: Record<string, Json>;
    deepLink?: string;
    /**
     * Clé métier stable — identifiant de transaction, de proposition. Rend
     * l'émission idempotente : rejouer l'action ne crée pas un second fait.
     */
    dedupKey?: string;
    /** Surcharge de l'audience par défaut. Rare : à réserver aux cas justifiés. */
    audience?: StaffRole[];
}

export type NotifyStaffResult =
    | { ok: true; id: string | null; deduped: boolean }
    | { ok: false; reason: string };

/**
 * Émet une notification à destination du staff.
 *
 * **Doit être appelée avec un client service-role** : la mig 133 n'expose
 * aucune policy d'écriture sur `staff_notifications`, délibérément — un agent
 * capable de s'écrire une notification pourrait s'en fabriquer une au nom d'un
 * autre rôle.
 *
 * L'échec est **doux**. Une notification est un signal, pas la transaction
 * métier : une escalade de recouvrement qui a réussi ne doit pas être rapportée
 * comme un échec parce que la cloche n'a pas pu être remplie. L'appelant reçoit
 * le détail et décide — en pratique, il journalise.
 */
export async function notifyStaff(
    db: Client,
    input: NotifyStaffInput,
): Promise<NotifyStaffResult> {
    const audience = input.audience ?? DEFAULT_AUDIENCE[input.kind];
    if (!audience || audience.length === 0) {
        return { ok: false, reason: `notifyStaff: aucune audience pour ${input.kind}` };
    }

    const row = {
        jurisdiction_id: input.jurisdictionId,
        kind: input.kind,
        audience_roles: audience,
        title_key: titleKeyFor(input.kind),
        body_key: bodyKeyFor(input.kind),
        body_params: input.params ?? {},
        deep_link: input.deepLink ?? null,
        dedup_key: input.dedupKey ?? null,
    };

    const { data, error } = await db
        .from('staff_notifications')
        .insert(row)
        .select('id')
        .maybeSingle();

    if (error) {
        // 23505 = violation d'unicité : l'index partiel de dédup a fait son
        // travail, le fait existe déjà. Ce n'est pas une erreur, c'est le but.
        if (error.code === '23505') return { ok: true, id: null, deduped: true };
        return { ok: false, reason: error.message };
    }

    return { ok: true, id: data?.id ?? null, deduped: false };
}

/**
 * Émet sans jamais lever, en journalisant l'échec.
 *
 * Le point d'appel usuel depuis une action métier : on veut la notification,
 * on ne veut pas qu'elle puisse faire échouer le geste qu'elle accompagne.
 */
export async function notifyStaffSafe(db: Client, input: NotifyStaffInput): Promise<void> {
    try {
        const result = await notifyStaff(db, input);
        if (!result.ok) console.error('[notifyStaff]', input.kind, result.reason);
    } catch (e) {
        console.error('[notifyStaff]', input.kind, e);
    }
}
