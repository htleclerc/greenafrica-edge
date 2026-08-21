/**
 * Regroupe les relances MANUAL nées d'un même envoi consolidé.
 *
 * sendConsolidatedRecap (Tâche 12) insère UNE ligne collection_reminders par
 * facture incluse dans le récapitulatif, toutes au palier MANUAL et avec le
 * MÊME sent_at (calculé une seule fois côté serveur) — c'est cette égalité,
 * combinée à template_used ('manual_recap'), qui identifie un lot. Sans
 * regroupement, un récap sur un portefeuille comme celui d'arm-014 (83
 * pro-formas) produirait 83 lignes qui noieraient n'importe quelle timeline.
 *
 * sendManualReminder (Tâche 11), lui, insère une ligne MANUAL isolée par
 * envoi : sa clé (sent_at, template_used) n'est en pratique jamais partagée
 * par une autre ligne, donc elle traverse cette fonction inchangée (kind:
 * 'single'), exactement comme un palier automatique (J3…JUDICIAL).
 *
 * Un groupe n'est émis que lorsqu'au moins DEUX lignes MANUAL partagent la
 * même clé — une ligne MANUAL isolée reste 'single', peu importe son
 * template_used. L'ordre chronologique d'entrée est préservé : un groupe
 * apparaît à la position de la première ligne du lot dans `rows`.
 */

interface ManualReminderInput {
    id: string;
    tier: string;
    sent_at: string;
    template_used: string;
}

export interface ManualReminderGroup {
    kind: 'group';
    sentAt: string;
    templateUsed: string;
    count: number;
    id: string;
}

export type GroupedReminderRow<T extends ManualReminderInput> =
    | ({ kind: 'single' } & T)
    | ManualReminderGroup;

function groupKey(row: ManualReminderInput): string {
    return `${row.sent_at}|${row.template_used}`;
}

export function groupManualReminders<T extends ManualReminderInput>(
    rows: T[],
): GroupedReminderRow<T>[] {
    // Premier passage : taille de chaque lot MANUAL par clé (sent_at, template_used).
    const batchSize = new Map<string, number>();
    for (const row of rows) {
        if (row.tier !== 'MANUAL') continue;
        const key = groupKey(row);
        batchSize.set(key, (batchSize.get(key) ?? 0) + 1);
    }

    // Second passage : émission dans l'ordre d'entrée. Une ligne MANUAL dont le
    // lot ne compte qu'un seul membre reste 'single' — seuls les lots de 2+
    // sont repliés. `emitted` évite de ré-émettre le groupe pour chacun de ses
    // membres suivants.
    const emitted = new Set<string>();
    const out: GroupedReminderRow<T>[] = [];
    for (const row of rows) {
        if (row.tier !== 'MANUAL') {
            out.push({ kind: 'single', ...row });
            continue;
        }
        const key = groupKey(row);
        const size = batchSize.get(key) ?? 1;
        if (size <= 1) {
            out.push({ kind: 'single', ...row });
            continue;
        }
        if (emitted.has(key)) continue;
        emitted.add(key);
        out.push({ kind: 'group', sentAt: row.sent_at, templateUsed: row.template_used, count: size, id: key });
    }
    return out;
}
