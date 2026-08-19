# Escalade manuelle huissier/judiciaire + édition des CC (Chantier B3)

**Date :** 2026-07-28
**Statut :** Design approuvé — prêt pour writing-plans
**Chantier :** B sur 3 (A → émission unifiée, LIVRÉ · B → relance + traçabilité · C → relevé mensuel). B découpé : B1 (moteur + registre + cron, LIVRÉ) · B2 (écran + saisie réponse, LIVRÉ) · **B3 = escalade manuelle + édition CC (ce spec, dernier de la série B)**.

## Objectif

Donner au staff le moyen d'**escalader manuellement** une créance impayée vers une notice **huissier** puis **judiciaire**, avec envoi d'une notice contentieuse (facture en pièce jointe), trace au registre `collection_reminders`, et copie du cabinet huissier. Et lui donner le premier **éditeur** des adresses en copie par juridiction (`bailiff_cc_emails` / `billing_cc_emails`), aujourd'hui seulement modifiables en SQL — sans quoi l'escalade part sans le cabinet en copie.

Contrainte forte : **étendre l'existant, ne rien reconstruire.** On réutilise `escalateToOwner` (patron d'action auditée + téléchargement PDF), `resolveInvoiceRecipients` + `fetchJurisdictionBailiffCc` (chantiers A/B1), le registre `collection_reminders` (paliers BAILIFF/JUDICIAL déjà dans l'enum, mig 094), le panneau détail B2, et la page `admin/jurisdictions`.

## Décisions de conception (approuvées PO 2026-07-28)

1. **Rampe souple, imposée côté serveur.** `BAILIFF` exige qu'une relance `J45` (pré-huissier) existe déjà pour la transaction ; `JUDICIAL` exige qu'une `BAILIFF` existe. Ordre non respecté → refus avec raison claire. Le déclenchement reste **manuel** (un humain décide), la rampe empêche seulement une notice huissier à froid.
2. **PDF requis.** Comme `escalateToOwner`, l'escalade est refusée si la transaction n'a pas de PDF stocké (`invoice_pdf_url`) — un dossier contentieux sans la facture est faible. La facture est jointe à la notice.
3. **Anti-doublon** par l'index unique `(transaction_id, tier)` (mig 094) : une seule notice BAILIFF et une seule JUDICIAL par créance ; ré-escalade → refus explicite (jamais une 23505 non gérée).
4. **Éditeur CC sur `admin/jurisdictions`.** Édition de `billing_cc_emails` **et** `bailiff_cc_emails` par juridiction, sur la page de config existante — foyer naturel, un seul endroit pour la config d'État.
5. **Gabarit e-mail dédié.** Les paliers manuels sont hors du moteur auto (`reminderTone`/`reminderTemplate` ne couvrent que J3..J45) : une fonction `sendCollectionEscalationEmail` distincte, ton contentieux, PDF joint.
6. **Audit sans migration d'enum** : `action:'TRANSACTION_UPDATED'` + `details_json.event:'ESCALATED_BAILIFF'|'ESCALATED_JUDICIAL'`, `severity:'WARNING'`.

## Périmètre

**Inclus (B3) :** action `escalateCollection` (rampe, PDF, CC huissier, insert registre `escalated_bailiff=true`, audit) ; e-mail `sendCollectionEscalationEmail` (BAILIFF/JUDICIAL, PDF joint) ; boutons d'escalade + état de rampe dans le panneau détail B2 + affichage `escalated_bailiff`/BAILIFF/JUDICIAL dans la timeline ; éditeur `bailiff_cc_emails`/`billing_cc_emails` sur `admin/jurisdictions` + action `updateJurisdictionCcEmails` ; i18n (6 locales).

**Exclus :** toute modification du moteur/cron B1 ; le relevé mensuel (chantier C) ; l'automatisation des paliers BAILIFF/JUDICIAL (ils restent manuels par conception) ; le suivi post-notice (réponse du cabinet huissier, etc.) — la réponse débiteur reste saisie via le dialogue B2 existant.

## Architecture & fichiers

### Action d'escalade — `frontend/src/actions/escalateCollection.ts`

```ts
'use server';
// input: { transactionId: string, tier: 'BAILIFF' | 'JUDICIAL' }
// retour: { ok: true; tier: 'BAILIFF'|'JUDICIAL' } | { ok: false; reason: string }
```

Flux (patrons `escalateToOwner` + `recordDebtorResponse`) :
1. Zod : `transactionId` uuid, `tier ∈ {BAILIFF, JUDICIAL}`.
2. Auth + rôle staff (`profiles.role ∈ {PORT_OFFICER, FINANCE_ADMIN, SUPERADMIN}`) + `is_active`.
3. Charge la transaction via `createPlatformClient()` : `id, jurisdiction_id, invoice_ref, tax_amount_usd, shipowner_id, agent_profile_id, invoice_pdf_url, vessel:vessels(name,imo_number), shipowner:shipowners(name, official_email), agent:profiles!…(email)`.
4. **Isolation explicite** : non-SUPERADMIN et `jurisdiction_id ≠ getServerJurisdictionId()` → `{ ok:false, reason:'forbidden' }`.
5. Charge les relances existantes de la transaction (`tier` seulement, toutes) → `sentTiers: string[]`.
   - **Rampe** : `tier==='BAILIFF'` et `!sentTiers.includes('J45')` → `{ ok:false, reason:'ramp: J45 (pre-bailiff) reminder required first' }`. `tier==='JUDICIAL'` et `!sentTiers.includes('BAILIFF')` → `{ ok:false, reason:'ramp: bailiff notice required first' }`.
   - **Anti-doublon** : `sentTiers.includes(tier)` → `{ ok:false, reason:'already escalated to <tier>' }`.
6. **PDF requis** : `!invoice_pdf_url` → `{ ok:false, reason:'no stored PDF — regenerate first' }`. Télécharge le PDF (`admin.storage.from('documents').download(invoice_pdf_url)` → `Uint8Array`, patron `escalateToOwner`).
7. Résout les destinataires : `resolveInvoiceRecipients({ shipownerBillingEmail: shipowner.official_email, agentEmail: agent.email, vesselOwnerEmail: null, jurisdictionCcEmails: [...await fetchJurisdictionBillingCc, ...await fetchJurisdictionBailiffCc], platformCcEmail: process.env.PLATFORM_BILLING_CC ?? null })`. Aucun destinataire résoluble → `{ ok:false, reason:'no reachable recipient' }`.
8. Résout le nom souverain : `fetchJurisdictionName(admin, jurisdiction_id)`.
9. Envoie `sendCollectionEscalationEmail({ tier, to, cc, recipientName: shipowner.name, invoiceRef, amountUsd, jurisdictionName, vesselName, pdfBuffer })`. Échec e-mail → `{ ok:false, reason }` (contrairement aux relances best-effort : une escalade contentieuse dont l'e-mail n'est pas parti ne doit pas être tracée comme envoyée).
10. Insert `collection_reminders` : `{ transaction_id, tier, sent_at: now, sent_email: recipients.to, cc_emails: recipients.cc, template_used: '<tier>_notice', escalated_bailiff: true, debtor_response_type: 'SILENT' }`. Conflit `(txn,tier)` (course) → traité comme « déjà escaladé », `{ ok:false }`.
11. Audit : `audit_logs.insert({ action:'TRANSACTION_UPDATED', severity:'WARNING', entity_type:'Transaction', entity_id:transactionId, jurisdiction_id, details_json:{ event:'ESCALATED_'+tier, tier, recipient: recipients.to, cc: recipients.cc } })`.
12. `revalidatePath('/admin/collections')`.

Écriture via `createPlatformClient()` (service, ciblée ; `collection_reminders` n'est pas tenant-scopée, l'isolation est vérifiée en 4).

### E-mail contentieux — `frontend/src/services/emailService.ts`

Nouvelle fonction exportée :

```ts
export interface CollectionEscalationParams {
  tier: 'BAILIFF' | 'JUDICIAL';
  to: string;
  cc?: string[];
  recipientName: string;
  invoiceRef: string;
  amountUsd: number;
  jurisdictionName: string;
  vesselName?: string;
  pdfBuffer: Uint8Array;
}
export async function sendCollectionEscalationEmail(p: CollectionEscalationParams): Promise<EmailResult>;
```

Deux tons distincts (au-delà du J45 « bailiff imminent ») :
- `BAILIFF` : sujet « Bailiff referral — <ref> », corps « This debt has been referred to a bailiff (huissier) for legal recovery. », `alert-danger`.
- `JUDICIAL` : sujet « Judicial proceedings — <ref> », corps « Judicial recovery proceedings have been initiated for this debt. », `alert-danger`.

Passe `cc: p.cc`, `attachments: [{ filename: \`invoice-<ref>.pdf\`, content: Buffer.from(pdfBuffer) }]`, et `emailLayout(content, { previewText, sovereignLine: \`${p.jurisdictionName} · Maritime Carbon Tax Authority\` })`.

### UI — `frontend/src/app/(dashboard)/admin/collections/CollectionsAdminList.tsx`

Dans `DetailPanel` :
- Ajout de `escalated_bailiff` au `.select(...)` des relances + à l'interface `ReminderRow`, et affichage dans la timeline (badge quand `escalated_bailiff` ou tier ∈ {BAILIFF, JUDICIAL}).
- Deux boutons dans l'en-tête : « Escalate → bailiff » / « Escalate → judicial ». État **dérivé des relances chargées** (miroir client de la garde serveur) :
  - BAILIFF activé ssi `reminders` contient un `J45` **et** pas de `BAILIFF`.
  - JUDICIAL activé ssi `reminders` contient un `BAILIFF` **et** pas de `JUDICIAL`.
  - Sinon désactivé, avec une infobulle expliquant le prérequis manquant.
- Chaque bouton ouvre un dialogue Radix de confirmation (patron du dialogue de réponse) qui appelle `escalateCollection({ transactionId, tier })` dans `useTransition`, affiche l'erreur serveur le cas échéant, et sur succès ferme + `onSaved()` (refresh).

### Éditeur CC — `admin/jurisdictions`

- `page.tsx` : ajouter au `Promise.all` `platform.from('jurisdiction_billing_cc').select('jurisdiction_id, cc_emails, bailiff_cc_emails')`, passer les lignes (mappées par `jurisdiction_id`) au composant `AdminJurisdictions`.
- `AdminJurisdictions` (client) : par juridiction, une section « Recovery CC » avec deux listes d'e-mails éditables (facturation, huissier). Bouton « Save » → action.
- Action `frontend/src/actions/updateJurisdictionCcEmails.ts` (`'use server'`) : `{ jurisdictionId: uuid, billingCcEmails: string[], bailiffCcEmails: string[] }`. Rôle staff + `is_active` ; **isolation explicite** (non-SUPERADMIN confiné à `getServerJurisdictionId()`) — `jurisdiction_billing_cc` a une RLS staff-only **non** scopée par juridiction, l'isolation doit être en dur. Validation : chaque entrée est un e-mail (Zod), listes bornées (ex. ≤ 20). `upsert` par `jurisdiction_id` (PK) via `createPlatformClient()` : `{ jurisdiction_id, cc_emails, bailiff_cc_emails, updated_at: now }`. Audit : l'enum `audit_action` est figé, donc `action:'TRANSACTION_UPDATED'` (l'action « update » générique, même choix qu'en B2) mais `entity_type:'Jurisdiction'`, `entity_id:jurisdictionId`, `severity:'INFO'`, `details_json.event:'JURISDICTION_CC_UPDATED'`. `revalidatePath('/admin/jurisdictions')`.

### i18n — `frontend/messages/{en,fr,pt,so,sw,ar}.json`

- `AdminCollections` : `escalate_bailiff`, `escalate_judicial`, `escalate_dialog_title`, `escalate_dialog_subtitle`, `escalate_confirm`, `escalate_ramp_bailiff` (infobulle prérequis J45), `escalate_ramp_judicial` (prérequis BAILIFF), `escalated_badge`.
- `AdminJurisdictions` : `recovery_cc_title`, `billing_cc_label`, `bailiff_cc_label`, `cc_add`, `cc_save`, `cc_saved`.
- `en` référence ; pt/sw/so/ar = baseline auto (dette connue).

## Flux de données

```
admin/collections → DetailPanel (relances chargées, RLS anon)
   │  boutons Escalate (état = rampe dérivée des relances)
   ▼
escalateCollection (server action)
   ├─ role + is_active + isolation juridiction explicite
   ├─ rampe (J45→BAILIFF→JUDICIAL) + anti-doublon (unique index)
   ├─ PDF requis → download depuis bucket documents
   ├─ resolveInvoiceRecipients + fetchJurisdictionBailiffCc  → { to, cc }
   ├─ sendCollectionEscalationEmail (PDF joint, ton contentieux)  ← échec = abandon
   ├─ INSERT collection_reminders (tier, escalated_bailiff=true, cc_emails)
   └─ audit TRANSACTION_UPDATED / event ESCALATED_<tier> / WARNING

admin/jurisdictions → section Recovery CC
   ▼
updateJurisdictionCcEmails → upsert jurisdiction_billing_cc (billing + bailiff) → audit
```

## Gestion des erreurs

| Cas | Comportement |
|---|---|
| Rampe non respectée | Refus `{ok:false, reason: 'ramp: …'}` — le bouton est déjà désactivé côté client, la garde serveur est le vrai rempart. |
| Palier déjà escaladé | Refus `already escalated to <tier>` (avant insert) + conflit 23505 géré si course. |
| Pas de PDF | Refus `no stored PDF — regenerate first`. |
| Aucun destinataire | Refus `no reachable recipient` — pas d'insert (rien n'est parti). |
| Échec e-mail | Refus (pas d'insert) — une escalade contentieuse ne se trace pas si la notice n'est pas partie. |
| Hors juridiction | 403. |
| CC e-mail invalide (éditeur) | Rejet Zod, `{ok:false}`. |

## Tests

**Action escalade (`escalateCollection`).** Rampe : J45→BAILIFF accepté, BAILIFF→JUDICIAL accepté ; BAILIFF sans J45 refusé, JUDICIAL sans BAILIFF refusé. Anti-doublon : tier déjà présent refusé. PDF requis : refus si absent. Destinataires : CC huissier inclus. Insert : `escalated_bailiff=true` + bon `template_used`. Audit : `event=ESCALATED_BAILIFF/JUDICIAL`, `severity=WARNING`. Isolation : hors juridiction refusé ; SUPERADMIN cross-juridiction accepté. Échec e-mail → pas d'insert.

**E-mail (`sendCollectionEscalationEmail`).** Ton/sujet distincts BAILIFF vs JUDICIAL ; pièce jointe PDF présente ; `sovereignLine` = juridiction émettrice ; `cc` transmis.

**Action CC (`updateJurisdictionCcEmails`).** Rôle/`is_active`/isolation ; e-mails invalides rejetés ; upsert correct (billing + bailiff) ; audit `JURISDICTION_CC_UPDATED`.

**UI.** État des boutons dérivé des relances (rampe) ; `escalated_bailiff` rendu dans la timeline.

## Risques et points ouverts

- **Notice contentieuse = e-mail, pas acte juridique.** B3 envoie une notification et trace l'escalade ; l'acte huissier réel est hors système (le cabinet en copie agit). Le libellé des gabarits doit rester une **notification**, pas prétendre être une signification légale.
- **`jurisdiction_billing_cc` RLS non scopée par juridiction** : tout officer passe la RLS ; l'isolation par juridiction des éditions repose entièrement sur la vérification en dur de l'action (comme B2). À ne pas oublier.
- **`escalated_bailiff` sémantique** : le flag est `true` pour BAILIFF **et** JUDICIAL (les deux sont des escalades contentieuses) ; le `tier` distingue les deux. Documenté pour éviter une lecture erronée.
- **Traductions non-anglaises** = baseline auto à relire natif.
- **Réponse débiteur post-escalade** : saisie via le dialogue B2 existant (`recordDebtorResponse`), qui stampe la relance la plus récente — donc potentiellement la ligne BAILIFF/JUDICIAL. Cohérent (la réponse au dernier contact).

## Fin de la série B

B3 clôt le triptyque relance : moteur (B1) → consultation/réponse (B2) → escalade contentieuse (B3). Reste le chantier **C** (relevé de compte mensuel), indépendant.
