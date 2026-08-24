import type { CSSProperties } from 'react';

/**
 * Niveau d'urgence d'une ligne, d'une carte ou d'une pastille.
 *
 * C'est le vocabulaire commun des écrans admin et opérateur : une ligne de
 * tableau, un liseré de carte, une pastille de délai et un point de timeline
 * qui décrivent le même dossier portent le même accent. Le balayage vertical
 * d'un tableau donne alors l'ancienneté de la dette avant toute lecture.
 */
export type OsAccent = 'danger' | 'warning' | 'mid' | 'info' | 'success' | 'neutral';

const ACCENT_VAR: Record<OsAccent, string> = {
    danger:  'var(--os-red)',        // en retard, en défaut, escaladé
    warning: 'var(--os-yellow)',     // échéance proche, relance 1, KYC incomplet
    mid:     'var(--os-orange)',     // mise en demeure — l'étape intermédiaire
    info:    'var(--os-blue)',       // à vérifier, contesté
    success: 'var(--os-green)',      // réglé, conforme
    neutral: 'var(--os-text-muted)',
};

/**
 * Pose `--os-accent` sur un élément. Ses descendants portant `.os-accent-text`,
 * `.os-accent-tint` ou `.os-accent-edge` (globals.css) en dérivent couleur, fond
 * à 12 % et bordure à 28 % — 9 % / 30 % en thème clair.
 */
export function accentStyle(accent: OsAccent, extra?: CSSProperties): CSSProperties {
    return { ...extra, ['--os-accent' as string]: ACCENT_VAR[accent] } as CSSProperties;
}

/** Couleur brute de l'accent, pour un `borderLeftColor` ou un point de timeline. */
export function accentColor(accent: OsAccent): string {
    return ACCENT_VAR[accent];
}
