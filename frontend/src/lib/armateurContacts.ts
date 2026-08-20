/**
 * Plafond de copies de facturation (billing_cc_emails) par armateur.
 *
 * Module neutre (pas de directive 'use server'/'use client') : consommé à la
 * fois par l'action serveur (frontend/src/actions/updateArmateurContacts.ts,
 * pour la contrainte Zod qui refuse un dépassement) et par le client
 * (frontend/src/app/(dashboard)/admin/armateurs/[id]/ArmateurDetail.tsx, pour
 * bloquer l'ajout et afficher le plafond avant l'envoi). Un fichier
 * 'use server' ne peut exporter que des fonctions async une fois importé
 * côté client — voir ALLOWED_LANGS dans frontend/src/lib/kyc/kycSchema.ts
 * pour le même motif déjà en place dans ce dépôt.
 */
export const MAX_CC_EMAILS = 10;

/**
 * Normalise la liste de copies : minuscules, élagage, déduplication, retrait de
 * l'adresse principale (sinon l'armateur recevrait deux fois le même e-mail).
 *
 * NE plafonne PAS elle-même : tronquer ici masquerait un dépassement au lieu de
 * le signaler. Le plafond est appliqué en amont, au niveau du schéma Zod
 * (`.max(MAX_CC_EMAILS)`, dans updateArmateurContacts.ts), qui refuse la requête
 * entière avec `{ ok: false }` plutôt que d'enregistrer une liste raccourcie
 * sans le dire.
 *
 * Vit ici, dans ce module neutre, pour la même raison que MAX_CC_EMAILS
 * ci-dessus : déclarée directement dans updateArmateurContacts.ts ('use
 * server'), elle échouait au build de production avec « Server Actions must
 * be async functions » — Next.js exige que TOUT export d'un fichier 'use
 * server' soit une fonction async, y compris un simple utilitaire pur jamais
 * destiné à être appelé en RPC. `tsc --noEmit`, vitest et eslint ne
 * détectent pas cette contrainte (propre au bundler Next/Turbopack) ; seul
 * `next build` la fait apparaître.
 */
export function normalizeCcEmails(list: string[], primary: string): string[] {
    const seen = new Set<string>([primary.trim().toLowerCase()]);
    const out: string[] = [];
    for (const raw of list) {
        const email = raw.trim().toLowerCase();
        if (!email || seen.has(email)) continue;
        seen.add(email);
        out.push(email);
    }
    return out;
}
