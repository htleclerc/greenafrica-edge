export interface ChecklistFacts {
    /** shipowners.account_state */
    accountState: string;
    /** au moins une transaction pointant sur cet armateur */
    hasAttachedVessel: boolean;
    /** coordonnées de facturation complètes au sens du BillingWizard */
    billingComplete: boolean;
    /** au moins un payment en CONFIRMED */
    hasConfirmedPayment: boolean;
}

export interface ChecklistItem {
    key: 'account' | 'vessel' | 'billing' | 'payment';
    done: boolean;
}

/**
 * Dérive la progression d'onboarding depuis l'état réel des tables.
 *
 * Rien n'est persisté : pas de colonne de progression, pas de drapeau
 * « tutoriel vu ». Une checklist dérivée ne peut pas mentir — elle se décoche
 * si l'état régresse (coordonnées de facturation vidées, par exemple), et elle
 * disparaît d'elle-même une fois complète.
 */
export function derivePaymentChecklist(facts: ChecklistFacts): ChecklistItem[] {
    return [
        { key: 'account', done: facts.accountState === 'ACTIVE' },
        { key: 'vessel', done: facts.hasAttachedVessel },
        { key: 'billing', done: facts.billingComplete },
        { key: 'payment', done: facts.hasConfirmedPayment },
    ];
}

export function isChecklistComplete(items: ChecklistItem[]): boolean {
    return items.every((i) => i.done);
}
