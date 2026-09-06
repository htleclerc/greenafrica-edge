/**
 * Les volets de `/admin/settings`, par intention — pas par table.
 *
 * L'ancienne page `/admin/tax-settings` mélangeait un tableau de bord de
 * recettes, un avis « les taux ont déménagé » et vingt-cinq clés `app_config`
 * à plat, où un seuil de rapprochement côtoyait un secret de file d'attente.
 * Ici chaque clé a UN volet, et chaque volet répond à une question :
 * « qu'est-ce qu'on facture », « qu'est-ce qu'on imprime », « comment on
 * relance », « comment on détecte », « ce que voit l'armateur », « la plomberie ».
 */
export type SettingsTab = 'fiscalite' | 'documents' | 'relance' | 'detection' | 'portail' | 'systeme';

export const SETTINGS_TABS: readonly SettingsTab[] = [
    'fiscalite', 'documents', 'relance', 'detection', 'portail', 'systeme',
] as const;

export const DEFAULT_SETTINGS_TAB: SettingsTab = 'fiscalite';

export function parseSettingsTab(raw: string | undefined | null): SettingsTab {
    return (SETTINGS_TABS as readonly string[]).includes(raw ?? '') ? (raw as SettingsTab) : DEFAULT_SETTINGS_TAB;
}

/** Clés `app_config` de chaque volet. Les volets sans clé lisent d'autres tables. */
export const PIPELINE_KEYS_BY_TAB: Readonly<Record<SettingsTab, readonly string[]>> = {
    fiscalite: [],
    documents: ['proforma.languages_default'],
    relance: ['owner_escalation.delay_days', 'owner_escalation.reminder_count'],
    detection: [
        'arrival.corridor_radius_nm',
        'arrival.claim_sla_hours',
        'arrival.escalation_eta_buffer_h',
        'reconciliation.tolerance_pct',
        'reconciliation.check_interval_min',
        'feature.ais_global_enabled',
        'feature.equasis_scraper_enabled',
        'feature.vessel_detention_enabled',
    ],
    portail: [
        'feature.shipowner_portal_enabled',
        'feature.shipowner_portal_v1_enabled',
        'feature.shipowner_self_service_enabled',
        'feature.online_payment_stripe_enabled',
        'feature.wallet_topup_enabled',
        'feature.show_unavailable_rails',
    ],
    systeme: ['queue.worker_url', 'queue.worker_secret', 'feature.notification_sms_enabled'],
};

/** Volet réservé au SUPERADMIN : secrets et plomberie. */
export const SUPERADMIN_ONLY_TABS: ReadonlySet<SettingsTab> = new Set(['systeme']);

/** Toutes les clés pilotées par l'éditeur, dans l'ordre des volets. */
export const ALL_PIPELINE_KEYS: readonly string[] = SETTINGS_TABS.flatMap((t) => PIPELINE_KEYS_BY_TAB[t]);
