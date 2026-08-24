import type { SupabaseClient } from '@supabase/supabase-js';
import { listPendingProposals, type EquasisProposal } from './equasisProposalService';
import { listPendingDestinationProposals, type DestinationProposal } from './destinationProposalService';

/**
 * Les trois familles d'éléments qu'un agent d'autorité arbitre.
 *
 * Elles vivaient sur trois écrans séparés (`equasis-proposals`,
 * `dashboard/validations`, `origin-port-proposals`). Le geste est pourtant le
 * même — comparer ce qui est déclaré à ce que dit la source, puis approuver ou
 * rejeter — et le regrouper évite qu'une file reste sans surveillance parce
 * qu'elle a son propre onglet dans un coin.
 *
 * Les exonérations n'ont pas de file d'attente dans le schéma : elles sont
 * créées directement en paramètres de taxe, sans arbitrage. Elles n'ont donc pas
 * d'onglet ici tant que ce n'est pas le cas.
 */
export type ValidationKind = 'vessel-identity' | 'agent' | 'origin-port';

export interface ComparisonRow {
    field: string;
    /** Ce que porte aujourd'hui le dossier — vide si le champ n'est pas renseigné. */
    declared: string;
    /** Ce qu'affirme la source officielle. */
    source: string;
    /**
     * Vrai quand les deux valeurs existent et diffèrent. C'est le seul cas qui
     * demande un arbitrage humain : un champ vide qu'on remplit n'écrase rien.
     */
    diverges: boolean;
    /** Rend la valeur en monospace (tonnage, IMO, e-mail, code pays). */
    mono?: boolean;
}

export interface ValidationItem {
    id: string;
    kind: ValidationKind;
    /** Ligne d'identité : « MSC ADEN — IMO 9703291 ». */
    title: string;
    /** Origine de la soumission, telle qu'elle est enregistrée. */
    submittedBy: string | null;
    submittedAt: string;
    /** Grille de comparaison, quand l'élément est un conflit de données. */
    comparison?: ComparisonRow[];
    /** Phrase de contexte, quand il n'y a rien à comparer. */
    summary?: string;
    /** Écran spécialisé, pour les arbitrages qui demandent plus que oui/non. */
    href: string;
    /**
     * Un élément est conforme quand aucune de ses valeurs ne diverge : l'approuver
     * ne fait que remplir des champs vides. C'est ce qui rend le traitement en lot
     * défendable — le lot ne touche jamais à un écart.
     */
    conforming: boolean;
}

export interface ValidationQueue {
    items: ValidationItem[];
    counts: Record<ValidationKind, number>;
    /** Les éléments approuvables en lot, tous types confondus. */
    conformingCount: number;
}

/** Compose une ligne de comparaison en déduisant elle-même la divergence. */
export function comparisonRow(
    field: string,
    declared: string | null | undefined,
    source: string | null | undefined,
    mono = false,
): ComparisonRow {
    const d = declared?.trim() ?? '';
    const s = source?.trim() ?? '';
    return {
        field,
        declared: d || '—',
        source: s || '—',
        diverges: d !== '' && s !== '' && d !== s,
        mono,
    };
}

/**
 * Traduit une proposition Equasis en élément de file.
 *
 * `official_email_source` porte la chaîne de confiance : un e-mail posé par un
 * agent portuaire ne se fait pas écraser par le scraper. Cette contrainte est
 * appliquée côté serveur par `applyEquasisProposal` ; on la reflète ici en
 * marquant la ligne comme divergente, pour que l'écran ne promette pas un
 * changement qui n'aura pas lieu.
 */
export function equasisToItem(p: EquasisProposal): ValidationItem {
    const owner = p.shipowner;
    const comparison = [
        comparisonRow('email', owner?.official_email, p.proposed_email, true),
        comparisonRow('ownerName', owner?.name, p.proposed_owner_name),
        comparisonRow('country', owner?.country_code, p.proposed_country, true),
        comparisonRow('manager', null, p.proposed_manager),
    ];
    return {
        id: p.id,
        kind: 'vessel-identity',
        title: `${owner?.name ?? p.proposed_owner_name ?? '—'} — IMO ${p.imo_number}`,
        submittedBy: p.source,
        submittedAt: p.scraped_at,
        comparison,
        href: '/admin/equasis-proposals',
        conforming: !comparison.some((r) => r.diverges),
    };
}

/**
 * Traduit une proposition de port d'origine.
 *
 * `fuzzy_score` n'est pas une confiance : c'est la **distance de Levenshtein**
 * entre la destination AIS normalisée et le nom canonique du port (backend,
 * `internal/originport/matcher.go`). Plus elle est basse, meilleur est le
 * rapprochement, et le watcher ne stocke jamais au-delà de 2 — les seules
 * valeurs vues ici sont donc 0, 1 et 2.
 *
 * À distance 1 ou moins, un seul caractère sépare la destination du port : le
 * lot peut passer. A 2, l'écart mérite un œil.
 */
export const ORIGIN_PORT_CONFIDENT_DISTANCE = 1;

export function destinationToItem(p: DestinationProposal): ValidationItem {
    const confident = p.fuzzy_score <= ORIGIN_PORT_CONFIDENT_DISTANCE && !!p.matched_port_guess;
    const comparison = [
        comparisonRow('rawDestination', p.raw_destination, p.normalized, true),
        comparisonRow('matchedPort', p.matched_port_guess, p.matched_port_guess),
        comparisonRow('editDistance', null, String(p.fuzzy_score), true),
    ];
    return {
        id: p.id,
        kind: 'origin-port',
        title: `${p.vessel_name ?? p.mmsi} — ${p.raw_destination}`,
        submittedBy: p.imo_number ? `IMO ${p.imo_number}` : `MMSI ${p.mmsi}`,
        submittedAt: p.created_at,
        comparison,
        href: '/admin/origin-port-proposals',
        conforming: confident,
    };
}

/**
 * Une inscription d'opérateur en attente de revue.
 *
 * La file vivante est `shipowners` en `PENDING_REVIEW`, PAS
 * `registration_requests` : cette dernière n'a plus de producteur depuis que
 * l'inscription staff est passée sur invitation (la route publique rend 410) et
 * que le self-service opérateur dépose directement un armateur à revoir.
 */
interface PendingOwnerRow {
    id: string;
    name: string | null;
    official_email: string | null;
    country_code: string | null;
    imo_company_no: string | null;
    kyc_level_b_completed_at: string | null;
    proof_doc_url: string | null;
    is_ofac_sdn: boolean | null;
    is_un_prohibited: boolean | null;
    created_at: string;
}

/**
 * Traduit une inscription en attente.
 *
 * Il n'y a rien à comparer ici : on lit une candidature, pas un écart entre deux
 * sources.
 *
 * Est « conforme » — donc approuvable en lot — un dossier dont la pièce
 * justificative est déposée, le KYC-B complété, l'adresse officielle connue, et
 * qui ne porte aucune sanction. Approuver active le compte : le lot ne doit
 * jamais toucher un dossier incomplet ni une entité sanctionnée.
 */
export function pendingOwnerToItem(r: PendingOwnerRow): ValidationItem {
    const sanctioned = Boolean(r.is_ofac_sdn) || Boolean(r.is_un_prohibited);
    const complete = Boolean(r.kyc_level_b_completed_at) && Boolean(r.proof_doc_url) && Boolean(r.official_email);
    return {
        id: r.id,
        kind: 'agent',
        title: `${r.name ?? '—'} — ${r.official_email ?? '—'}`,
        submittedBy: r.official_email,
        submittedAt: r.created_at,
        summary: [
            r.country_code,
            r.imo_company_no ? `IMO ${r.imo_company_no}` : null,
            sanctioned ? 'sanctionné' : null,
        ].filter(Boolean).join(' · '),
        href: '/admin/registrations',
        conforming: complete && !sanctioned,
    };
}

/** Charge les trois files et les fusionne, du plus ancien au plus récent. */
export async function loadValidationQueue(db: SupabaseClient): Promise<ValidationQueue> {
    const [equasis, destinations, registrations] = await Promise.all([
        listPendingProposals(db),
        listPendingDestinationProposals(),
        db.from('shipowners')
            .select('id, name, official_email, country_code, imo_company_no, kyc_level_b_completed_at, proof_doc_url, is_ofac_sdn, is_un_prohibited, created_at')
            .eq('account_state', 'PENDING_REVIEW')
            .order('created_at', { ascending: true }),
    ]);

    if (registrations.error) throw new Error(`loadValidationQueue(registrations): ${registrations.error.message}`);

    const items = [
        ...equasis.map(equasisToItem),
        ...destinations.map(destinationToItem),
        ...((registrations.data ?? []) as PendingOwnerRow[]).map(pendingOwnerToItem),
    ].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));

    return {
        items,
        counts: {
            'vessel-identity': items.filter((i) => i.kind === 'vessel-identity').length,
            'agent':           items.filter((i) => i.kind === 'agent').length,
            'origin-port':     items.filter((i) => i.kind === 'origin-port').length,
        },
        conformingCount: items.filter((i) => i.conforming).length,
    };
}
