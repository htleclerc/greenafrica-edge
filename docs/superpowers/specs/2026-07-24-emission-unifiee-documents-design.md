# Émission unifiée des documents fiscaux (Chantier A)

**Date :** 2026-07-24
**Statut :** Design approuvé — prêt pour writing-plans
**Chantier :** A sur 3 (A → émission unifiée · B → moteur de relance + traçabilité · C → relevé de compte mensuel)

## Objectif

Faire en sorte qu'une pro-forma émise **automatiquement** soit un document de plein droit : archivée sous une nomenclature unique, envoyée aux bons destinataires, vérifiable par son QR, et téléchargeable depuis le portail armateur.

Aujourd'hui elle ne l'est pas. Le pipeline automatique rend bien le PDF, l'uploade et l'envoie, mais il ne persiste ni `invoice_ref`, ni `content_hash`, ni `verify_signature` — il ne renseigne que `invoice_pdf_url` ([proformaPipelineService.ts:358-368](../../../frontend/src/services/proformaPipelineService.ts#L358-L368)). Comme `/verify/[ref]` et `/api/invoices/[ref]/download` résolvent tous deux la transaction **par `invoice_ref`**, une colonne NULL rend le QR mort et le téléchargement introuvable, et le portail armateur n'a pas de quoi construire un lien. Le document existe dans le bucket mais nulle part dans l'application.

Contrainte forte : **unifier l'existant, ne rien reconstruire.** On réutilise `invoiceIssuanceService` (extrait de la route le 2026-07-24), `transactions`, le bucket `documents`, `emailService`, et le patron de liens signés.

## Décisions de conception (approuvées PO 2026-07-24)

1. **Un seul émetteur.** `issueInvoiceDocument` est le seul chemin qui produit un document fiscal. Le pipeline automatique lui délègue au lieu d'entretenir sa copie. *Approche retenue parmi trois ; l'alternative « noyau bas niveau partagé » laissait subsister deux constructions d'`InvoiceData`, c'est-à-dire la cause même de la divergence actuelle.*
2. **Nomenclature par juridiction, année et mois** : `<code>/<type>/<YYYY>/<MM>/<REF>.pdf`. Le préfixe par État sert la restructuration multi-tenant v8 ; le découpage année/mois sert l'archivage et la purge par période.
3. **Une seule fabrique de référence** : `mintInvoiceRef`, au format `{PRO|INV}-YYYY-WW-<8 hex d'UUID><4 hex d'entropie>`. Le format concurrent du pipeline automatique disparaît.
4. **Destinataire en cascade** : contact de facturation de l'armateur → agent maritime → propriétaire du navire, avec l'agent en copie et une copie systématique de la plateforme.
5. **Copie plateforme à deux niveaux** : `jurisdictions.billing_cc_emails` (par État, éditable par son staff) + `PLATFORM_BILLING_CC` (variable d'environnement). *`app_config` a été écarté : sa RLS est `USING (true)` ([mig 009:16-18](../../../supabase/migrations/009_create_app_config.sql#L16-L18)), une boîte interne y serait publiquement lisible.*
6. **Échec de persistance = échec d'émission.** Le `console.warn` non fatal actuel est ce qui produit le bug d'origine.

## Périmètre

**Inclus :** extension d'`issueInvoiceDocument` (lignes personnalisables, résolution des destinataires, nomenclature) ; branchement des deux chemins de `proformaPipelineService` (maritime et aérien) ; colonne `jurisdictions.billing_cc_emails` ; migration des objets de stockage existants ; audit `INVOICE_SENT` multi-destinataires ; rattrapage des transactions sans document.

**Exclus :** moteur de relance et écran d'historique (chantier B) ; relevé de compte mensuel (chantier C) ; pro-forma consolidée payable (chantier ultérieur) ; `reconcilePipelineService`, qui écrit aussi `invoice_pdf_url` et devra suivre, mais dont le flux de réconciliation n'est pas exercé ici.

## Architecture & fichiers

### Service d'émission — `frontend/src/services/invoiceIssuanceService.ts`

Deux ajouts à `IssueInvoiceInput` :

- `lineItems?: InvoiceData['lineItems']` — permet au pipeline de conserver son libellé métier (« Carbon Emissions Tax — pro-forma estimate, IMO Cubic Law ») au lieu de la ligne générique. **Validé** : si `Σ lineItems[].amount` s'écarte de `tax_amount_usd` de plus d'un cent, le service refuse d'émettre. Un document fiscal dont le détail contredit le total n'a pas à exister.
- `skipStorage?` / `skipEmail?` — reprise des drapeaux `dryRunStorage` / `dryRunEmail` du pipeline, dont ses tests dépendent.

Deux choses restent délibérément hors de la signature. L'année et le mois du chemin de stockage dérivent de `transactions.created_at`, que le service relit déjà — aucun appelant ne choisit où le document est rangé. Les destinataires sont résolus par le service lui-même — aucun appelant ne peut rediriger un document fiscal.

Trois fonctions pures nouvelles, exportées et testables isolément :

```ts
mintInvoiceRef(transactionId: string, mode: InvoiceMode, createdAt: Date): string
// → 'PRO-2026-30-81be71091a2b'
//         │    │  └─ 8 hex du premier segment d'UUID + 4 hex d'entropie
//         │    └──── semaine ISO 8601 de createdAt, sur deux chiffres
//         └───────── année civile de createdAt

buildStoragePath(input: {
  jurisdictionCode: string;   // 'SO' | 'DJ' | …
  mode: InvoiceMode;          // 'proforma' | 'invoice'
  createdAt: Date;
  invoiceRef: string;
}): string
// → 'SO/proformas/2026/07/PRO-2026-30-81be71091a2b.pdf'

resolveInvoiceRecipients(input: {
  shipownerBillingEmail: string | null;
  agentEmail: string | null;
  vesselOwnerEmail: string | null;
  jurisdictionCcEmails: string[];
  platformCcEmail: string | null;
}): { to: string; cc: string[] } | null
```

`mintInvoiceRef` prend désormais `createdAt` au lieu de lire l'horloge : l'année et la semaine décrivent la créance, pas l'instant où on la rattrape. **L'année reste l'année civile de `createdAt`**, jamais l'année ISO 8601, afin de rester alignée avec le dossier de stockage. Aux trois derniers jours de décembre, la semaine ISO peut donc valoir `01` dans une référence portant l'année précédente ; c'est cosmétique et sans effet sur l'unicité, que garantit le suffixe d'entropie sous l'index UNIQUE de [mig 017:30](../../../supabase/migrations/017_invoice_security.sql#L30).

Compatibilité de lecture vérifiée : `parseInvoiceRef` applique `^(PRO|INV|RCT)-(\d{4})-(.+)$`, dont le dernier groupe absorbe le segment supplémentaire ; et son champ `idSuffix`, que le commentaire annonce comme destiné à un `ILIKE` sur l'UUID, n'est consommé par aucun appelant — `/verify` ne lit que `parsed.type` et cherche sur le `invoice_ref` complet. Le commentaire trompeur sera corrigé au passage.

`buildStoragePath` remplace la version actuelle, qui ne prend que `(invoiceRef, mode)`. Sa signature élargie oblige le service à charger le `code` de la juridiction — une lecture de plus, sur un chemin déjà asynchrone.

`resolveInvoiceRecipients` renvoie `null` quand aucun destinataire principal n'est résoluble ; le service émet alors le document (la créance existe) et trace l'absence de destinataire dans l'audit, sans échouer.

### Pipeline automatique — `frontend/src/services/proformaPipelineService.ts`

Les deux chemins, maritime (~lignes 258-386) et aérien (~lignes 520-630), perdent chacun leur bloc rendu → upload → e-mail → persistance et appellent `issueInvoiceDocument` après l'insertion de la transaction. Ce qu'ils conservent : détection, calcul CO₂, résolution du tarif, insertion, transition d'`arrival_alerts`.

Le service ayant besoin d'un acteur pour l'audit, le pipeline lui passe un acteur système. `audit_logs.user_id` étant `NOT NULL REFERENCES profiles(id)` ([mig 003:180](../../../supabase/migrations/003_core_domain_tables.sql#L180)), on résout un profil staff de la juridiction plutôt que d'inventer un UUID — même règle que les scripts (`SUPERADMIN` → `FINANCE_ADMIN` → `PORT_OFFICER`).

Les drapeaux `dryRunStorage` / `dryRunEmail`, utilisés par les tests du pipeline, deviennent des options du service.

### Migration base — `supabase/migrations/109_jurisdictions_billing_cc.sql`

```sql
ALTER TABLE public.jurisdictions
  ADD COLUMN IF NOT EXISTS billing_cc_emails TEXT[] NOT NULL DEFAULT '{}';
```

Additive, sans valeur par défaut métier. La RLS existante de `jurisdictions` s'applique — à vérifier explicitement lors de l'implémentation : cette colonne ne doit pas être lisible par un armateur.

### Migration stockage — `scripts/migrate-document-storage.ts`

Sept objets vivent sous `invoices/` avec l'ancienne convention. Le script les déplace en copie → vérification → suppression, puis réécrit `invoice_pdf_url` (colonne **FREE** dans [mig 089:77](../../../supabase/migrations/089_greengate_transactions_immutable.sql#L77), donc modifiable). Dry-run par défaut, `--execute` pour agir. La suppression de la source n'intervient qu'après lecture réussie de la destination : tant qu'elle n'est pas confirmée, l'opération est réversible.

`proformas/` est vide — le pipeline automatique n'a jamais tourné sur la base hébergée — donc aucun objet à migrer de ce côté.

Les références déjà émises ne sont **pas** reformatées : `invoice_ref` est gelé au premier écrit, et les PDF distribués portent l'ancienne valeur dans leur QR. Le nouveau chemin est donc construit autour de la référence existante, sans segment de semaine — `SO/invoices/2026/03/INV-2026-200000007b95.pdf`. Les deux formats cohabitent par conception ; seuls les documents émis à partir de ce chantier portent la semaine.

### Rattrapage — `scripts/issue-invoice-documents.ts` (existant)

Déjà écrit. Émet le document des transactions dont `invoice_pdf_url` est NULL. Idempotent : une transaction portant déjà une paire ref/hash la réutilise, ce qui préserve les PDF éventuellement distribués.

## Flux de données

```
arrival_alert (MATCHED_AUTO)
      │
      ▼
runProformaPipeline ── calcul CO₂, tarif ──▶ INSERT transactions (PENDING, PROFORMA)
      │
      ▼
issueInvoiceDocument
      ├─ relit la transaction (source de vérité, pas l'appelant)
      ├─ mintInvoiceRef ─────────────▶ PRO-2026-30-<8hex><4hex>
      ├─ hashInvoiceFields ──────────▶ content_hash
      ├─ signInvoiceRef ─────────────▶ verify_signature
      ├─ buildVerifyUrl ─────────────▶ QR du PDF
      ├─ generateInvoicePdf
      ├─ upload  SO/proformas/2026/07/<REF>.pdf
      ├─ UPDATE transactions (invoice_ref, content_hash, verify_signature, invoice_pdf_url)
      │        └─ en échec ⇒ émission échouée
      ├─ audit INVOICE_GENERATED
      ├─ resolveInvoiceRecipients ──▶ { to, cc[] }
      ├─ sendInvoiceEmail            (échec ⇒ tracé, non bloquant)
      └─ audit INVOICE_SENT { to, cc[], delivery }
      │
      ▼
arrival_alert → PROFORMA_SENT
```

Le portail armateur consomme ensuite `invoice_ref` + `content_hash` + `invoice_pdf_url` via `buildInvoiceDownloadUrl`, et le QR imprimé résout par `invoice_ref` sur `/verify`.

## Gestion des erreurs

| Étape en échec | Comportement | Justification |
|---|---|---|
| Rendu du PDF | Émission échouée, alerte inchangée | Rejouable au prochain passage |
| Upload | Émission échouée, alerte inchangée | Idem |
| **Persistance ref/hash/chemin** | **Émission échouée** | Durcissement. Un PDF dans le bucket sans ref en base est invisible dans l'application — c'est le bug d'origine |
| Résolution des destinataires vide | Document émis, absence tracée | La créance existe indépendamment de la joignabilité du débiteur |
| Envoi e-mail | Document émis, échec tracé dans l'audit | Un e-mail se rejoue ; une créance ne doit pas dépendre de Resend |

L'alerte ne transitionne vers `PROFORMA_SENT` que si l'émission a réussi, afin que le pipeline reste rejouable sans produire de doublon.

## Tests

**Unitaires.** `mintInvoiceRef` : semaine ISO sur deux chiffres, préfixe `PRO` / `INV` selon le mode, année civile de `created_at` et non l'horloge, et les bornes du calendrier — 1ᵉʳ janvier tombant en semaine 52 ou 53 de l'année précédente, 31 décembre tombant en semaine 01, année à 53 semaines. Le format produit doit rester accepté par `parseInvoiceRef`. `buildStoragePath` : juridiction, type, année et mois issus de `created_at` ; mois sur deux chiffres ; référence héritée sans segment de semaine rangée correctement. `resolveInvoiceRecipients` : chaque cran de la cascade, agent absent, dédoublonnage insensible à la casse entre destinataire principal et copies, `null` quand aucun destinataire. Validation de `lineItems` : somme conforme, somme divergente rejetée, tolérance au cent.

**Intégration.** Le pipeline automatique produit une transaction dont `invoice_ref`, `content_hash`, `verify_signature` et `invoice_pdf_url` sont tous renseignés et mutuellement cohérents, et un objet au chemin attendu.

**Régression.** Le QR d'un document émis par le pipeline automatique se vérifie sur `/verify` — c'est le défaut que personne n'aurait vu sans document réellement émis. Le lien de téléchargement d'un tel document renvoie 302 et non 404.

**Invariant.** Aucun chemin d'écriture ne laisse `invoice_pdf_url` renseigné alors que `content_hash` est NULL.

## Risques et points ouverts

- **`INVOICE_SIGNING_SECRET` absent en local.** `verify_signature` est first-write-only ([mig 089:303](../../../supabase/migrations/089_greengate_transactions_immutable.sql#L303)) : émettre depuis un environnement au secret différent grave une signature que l'environnement déployé ne saura pas vérifier. Le rattrapage doit tourner avec le secret réel. Le lien de téléchargement, lui, est signé au rendu de la page et reste valide partout.
- **`reconcilePipelineService`** écrit également `invoice_pdf_url` et devra converger vers le service. Hors périmètre ici faute de flux exercé, à traiter avant que la réconciliation ne serve en production.
- **Reçus incohérents** : `RCT-2026-65E28CEB.pdf` et `RCT-2026-81BE7109.pdf` existent dans le bucket pour deux pro-formas `PENDING`. Un reçu pour une créance impayée est une anomalie à instruire séparément.
- **Localisation** : les documents et e-mails sont produits en anglais quelle que soit la locale de l'armateur, alors que le portail gère sept langues. Non traité ici.

## Entrées pour les chantiers suivants

**Chantier B — moteur de relance.** `collection_reminders` ([mig 094](../../../supabase/migrations/094_collection_reminders.sql)) existe déjà avec ses paliers J15/J30/J45/BAILIFF/JUDICIAL, ses destinataires, son modèle de réponse du débiteur et son unicité `(transaction_id, tier)` — seul le seed d'onboarding l'alimente. En parallèle, [mig 065](../../../supabase/migrations/065_proforma_reminders_cron.sql) fait tourner un cron J+3/J+7 qui n'écrit que des notifications in-app, sans e-mail ni trace dans la table. Les deux mécanismes s'ignorent et doivent être absorbés dans un moteur unique. Le chantier inclut un écran staff d'historique avec saisie de la réponse du débiteur.

**Chantier C — relevé de compte mensuel.** Produit **en début de mois, portant sur le mois écoulé**, affichant le solde dû de l'armateur. Version informative en phase 1 : liste des pro-formas ouvertes, montants, ancienneté, total dû — aucune créance nouvelle, pas de référence fiscale, pas de QR. La pro-forma consolidée payable, avec sa propre référence et la répartition d'un règlement groupé sur les transactions filles, constitue une phase 2 distincte.
