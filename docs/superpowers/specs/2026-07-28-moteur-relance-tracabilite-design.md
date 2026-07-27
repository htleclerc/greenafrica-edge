# Moteur de relance + traçabilité (Chantier B1)

**Date :** 2026-07-28
**Statut :** Design approuvé — prêt pour writing-plans
**Chantier :** B sur 3 (A → émission unifiée, LIVRÉ · **B → relance + traçabilité** · C → relevé mensuel). B est découpé : **B1 = moteur + registre + cron + destinataires (ce spec)** ; B2 = écran staff + escalades manuelles huissier/judiciaire.

## Objectif

Faire de chaque relance de pro-forma impayée une **entrée traçable et durable**. Aujourd'hui les relances partent (in-app + e-mail) mais ne laissent **aucune trace auditable** du parcours de recouvrement, et la cadence d'escalade contentieuse (J+15 amicale → J+30 mise en demeure → J+45 pré-huissier) n'existe pas.

État réel de l'existant (corrige le spec A, qui affirmait à tort « le cron n'envoie pas d'e-mail ») :

- `pg_cron proforma-reminders-daily` (mig 065, 08:00 UTC) scanne les pro-formas PENDING âgées de 3 ou 7 jours et **insère une notif in-app** `PROFORMA_REMINDER`.
- `Vercel cron notification-email-loop` (mig — route TS, 09:00 UTC) reprend ces notifs, **envoie l'e-mail** via `sendProformaReminderEmail`, stampe `emailed_at`, avec back-off 5 tentatives.
- `collection_reminders` (mig 094 — le registre de recouvrement : paliers J15/J30/J45/BAILIFF/JUDICIAL, `sent_email`, `cc_emails`, `template_used`, réponse du débiteur, unicité `(transaction_id, tier)`) n'est alimenté **que par le seed d'onboarding**. Le système live n'y écrit rien.

## Décisions de conception (approuvées PO 2026-07-28)

1. **Un seul registre pour toutes les cadences.** Chaque relance — courtoise (J+3/J+7) comme contentieuse (J+15/J+30/J+45) — écrit une ligne `collection_reminders`. L'enum `reminder_tier` est étendu avec `J3` et `J7`.
2. **Frontière auto/manuel.** J+3, J+7, J+15, J+30, J+45 partent **automatiquement par âge**. `BAILIFF` et `JUDICIAL` sont des **actions manuelles** du staff (chantier B2) — un humain engage la procédure contentieuse.
3. **Moteur en TypeScript, pas en plpgsql.** La résolution du destinataire (cascade armateur → agent → propriétaire + copies) vit déjà en TS (`resolveInvoiceRecipients`, chantier A). La réécrire en SQL dupliquerait cette logique — exactement l'anti-pattern que le chantier A a corrigé. Le `pg_cron` 065 est donc **désactivé** (`cron.unschedule`) et remplacé par une route Vercel cron TS qui écrit `collection_reminders` **et** `owner_notifications`. L'e-mail continue de partir via le `notification-email-loop` existant — infra d'envoi éprouvée réutilisée telle quelle.
4. **Règles d'arrêt/pause.** Le moteur n'escalade que `PENDING`/`OVERDUE`. Une réponse débiteur `DISPUTE` (ou un statut `DISPUTED`) met l'escalade **en pause** ; `PAYMENT_PROMISE` la met en pause 7 jours (grâce) ; `SILENT`/`ACKNOWLEDGE` la laissent continuer. Tout statut de clôture (PAID, EXEMPT, VOID, WAIVED) l'**arrête**.
5. **Copies huissier par juridiction.** À partir de J+45, le cabinet huissier de la juridiction est mis en copie. Stocké dans la table privée `jurisdiction_billing_cc` (nouvelle colonne `bailiff_cc_emails`) — même raison RGPD qu'au chantier A (jamais sur `jurisdictions`, RLS `USING(true)`).

## Périmètre

**Inclus (B1) :** extension enum `reminder_tier` (J3, J7) + colonne `jurisdiction_billing_cc.bailiff_cc_emails` ; service pur `collectionReminderService` (palier dû, règles pause/arrêt) ; route cron TS `/api/cron/collection-reminders` (scan par âge → écrit `collection_reminders` + `owner_notifications`) ; désactivation du `pg_cron` 065 ; e-mails par palier (templates amicale/formelle/pré-huissier) ; réutilisation de `resolveInvoiceRecipients` + `jurisdiction_billing_cc`.

**Exclus (B2) :** écran staff `admin/collections`, timeline, saisie de la réponse du débiteur, boutons d'escalade manuelle BAILIFF/JUDICIAL. **Exclus (C) :** relevé de compte mensuel.

## Architecture & fichiers

### Migration — `supabase/migrations/110_collection_reminder_tiers.sql`

```sql
-- Étend les paliers avec les rappels courtois précoces (avant J15).
-- ALTER TYPE ... ADD VALUE ... BEFORE conserve l'ordre logique de l'enum.
ALTER TYPE public.reminder_tier ADD VALUE IF NOT EXISTS 'J3' BEFORE 'J15';
ALTER TYPE public.reminder_tier ADD VALUE IF NOT EXISTS 'J7' BEFORE 'J15';

-- Cabinet huissier en copie à partir de J45. Table déjà privée (staff-only,
-- mig 109) — jamais sur jurisdictions (RLS USING(true) → fuite).
ALTER TABLE public.jurisdiction_billing_cc
  ADD COLUMN IF NOT EXISTS bailiff_cc_emails TEXT[] NOT NULL DEFAULT '{}';

-- Désactive l'ancien enqueueur pg_cron : remplacé par la route TS
-- /api/cron/collection-reminders. Idempotent (ignore si déjà absent).
SELECT cron.unschedule('proforma-reminders-daily')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'proforma-reminders-daily');
```

**Note enum Postgres :** `ALTER TYPE ... ADD VALUE` ne peut pas s'exécuter dans un bloc transactionnel avec d'autres usages de la valeur ; la migration place ces `ADD VALUE` en tête, avant tout usage.

### Service pur — `frontend/src/services/collectionReminderService.ts`

Logique métier testable sans base :

```ts
export type ReminderTier = 'J3' | 'J7' | 'J15' | 'J30' | 'J45';  // paliers auto
export type DebtorResponseType =
  'SILENT' | 'ACKNOWLEDGE' | 'DISPUTE' | 'PAYMENT_PROMISE' | 'PARTIAL_PAYMENT' | 'PAID' | 'REFUSED';

/** Âge (jours) → palier attendu, ou null si aucun palier atteint. */
export function tierForAge(ageDays: number): ReminderTier | null;
// J+3→J3, J+7→J7, J+15→J15, J+30→J30, J+45→J45 ; <3 → null ; entre deux → le plus récent atteint

/** Le palier dû pour une transaction, compte tenu de ce qui a déjà été envoyé
 *  et des règles d'arrêt/pause. null = rien à envoyer cette passe. */
export function dueTier(input: {
  status: string;                 // transaction_status
  ageDays: number;
  sentTiers: ReminderTier[];      // paliers déjà en base pour cette transaction
  latestResponse: DebtorResponseType | null;
  latestResponseAt: Date | null;
  now: Date;
}): ReminderTier | null;

/** Contenu e-mail par palier (objet + ton). */
export function reminderTemplate(tier: ReminderTier): { templateId: string; subjectKey: string; tone: 'courtesy' | 'amicable' | 'formal' | 'pre-bailiff' };
```

Règles encodées dans `dueTier` :
- `status ∉ {PENDING, OVERDUE}` → `null` (arrêt).
- `latestResponse === 'DISPUTE'` → `null` (pause contentieuse).
- `latestResponse === 'PAYMENT_PROMISE'` et `now < latestResponseAt + 7j` → `null` (grâce).
- Sinon, palier attendu pour l'âge ; si déjà dans `sentTiers` → `null` (idempotence) ; sinon ce palier.

### Route cron — `frontend/src/app/api/cron/collection-reminders/route.ts`

Patron identique à `notification-email-loop` (auth `Bearer CRON_SECRET`, `createPlatformClient`, logger scoped, lookback, limites). Par passe :

1. Charge les pro-formas `PENDING`/`OVERDUE` (`document_type='PROFORMA'`, `shipowner_id NOT NULL`) avec leur âge.
2. Pour chacune, charge les `sentTiers` (collection_reminders existants) + la dernière réponse débiteur.
3. `dueTier(...)` → palier dû, ou skip.
4. Résout les destinataires via `resolveInvoiceRecipients` (armateur + `jurisdiction_billing_cc` + `PLATFORM_BILLING_CC` ; + `bailiff_cc_emails` si tier === 'J45').
5. **Insère la notif `owner_notifications` `PROFORMA_REMINDER` d'abord** (body_params : invoice_ref, amount_usd, vessel_name, tier) — c'est elle qui pilote l'envoi e-mail par le `notification-email-loop`.
6. **Puis insère `collection_reminders`** (tier, sent_at, sent_email, cc_emails, template_used). Cet ordre garantit qu'une ligne de registre n'existe jamais sans notif correspondante (donc jamais de trace sans e-mail déclenché). L'unicité `(transaction_id, tier)` de mig 094 est le garde-fou dur contre un doublon en cas de passes concurrentes.

Le registre `collection_reminders` **est** la trace d'audit du recouvrement (immuable, hors purge RGPD) : aucune entrée `audit_logs` séparée n'est nécessaire, elle serait redondante.

Ajout à `vercel.json` : `{ "path": "/api/cron/collection-reminders", "schedule": "0 8 * * *" }` (08:00 UTC, avant le loop e-mail de 09:00).

### E-mail par palier — `frontend/src/services/emailService.ts`

`sendProformaReminderEmail` (existant, générique sur `ageDays`) est étendu pour porter le **ton du palier** : objet et corps distincts pour courtoisie (J3/J7), amicale (J15), formelle/mise en demeure (J30), pré-huissier (J45). Un paramètre `tier` remplace/complète `ageDays`. Le `dispatchNotificationEmail` (branche `PROFORMA_REMINDER`) passe `tier` depuis `body_params`.

## Flux de données

```
pg_cron 065 (DÉSACTIVÉ)                    Vercel cron 08:00
                                                  │
                                    /api/cron/collection-reminders
                                                  │
                    pro-formas PENDING/OVERDUE ── âge ──▶ dueTier()
                                                  │ (palier dû, sinon skip)
                                                  ▼
                              resolveInvoiceRecipients (+ bailiff si J45)
                                                  │
                        ┌─────────────────────────┴───────────────────────┐
                        ▼ (1) d'abord                          (2) puis     ▼
             INSERT owner_notifications                    INSERT collection_reminders
             (PROFORMA_REMINDER, tier)                     (registre durable, immuable)
                        │
                                                          Vercel cron 09:00 (existant)
                                                          notification-email-loop
                                                                           │
                                                          sendProformaReminderEmail(tier)
                                                          → stampe emailed_at
```

## Gestion des erreurs

| Étape | Comportement |
|---|---|
| Pré-lecture registre : palier déjà présent | Skip (idempotence) — cas nominal majoritaire avec `dueTier` null. |
| Insert `owner_notifications` échoue | Skip cette transaction, loggé ; on n'écrit PAS le registre. Rien n'a été envoyé, la passe suivante rejoue. |
| Insert `collection_reminders` échoue/conflit APRÈS la notif | Loggé (WARN). La notif existe → l'e-mail partira via le loop, mais la trace registre manque pour ce palier. Le conflit `(txn, tier)` est bénin (déjà tracé) ; un échec réel est un incident ops rare (single-instance cron). |
| Destinataire non résoluble | Skip cette transaction, loggé ; ni notif ni registre. |
| `dueTier` renvoie null | Skip silencieux (arrêt/pause/idempotence). |

## Tests

**Unitaires (`collectionReminderService`).** `tierForAge` : bornes 3/7/15/30/45, entre-deux, <3. `dueTier` : arrêt hors PENDING/OVERDUE ; pause sur DISPUTE ; grâce PAYMENT_PROMISE (avant/après 7j) ; idempotence (palier déjà envoyé) ; progression normale J3→J7→…→J45.

**Intégration (route cron).** Faux client : une pro-forma à J+15 sans relance → écrit `collection_reminders` tier J15 + notif ; seconde passe → aucune écriture (idempotent). Une pro-forma DISPUTED → rien. Auth : sans `CRON_SECRET` → 401.

**Régression.** Les relances J+3/J+7 continuent de produire une notif que le `notification-email-loop` envoie (chaîne e-mail intacte). Le `pg_cron` 065 ne double plus les notifs (désactivé).

## Risques et points ouverts

- **Bascule cron sans trou.** Désactiver 065 et activer la route TS doivent être simultanés au déploiement, sinon une journée sans relance. Séquencé dans le runbook de bascule.
- **`ALTER TYPE ADD VALUE`** doit précéder tout usage transactionnel de la nouvelle valeur (contrainte Postgres) — la migration l'isole en tête.
- **Double e-mail théorique** : si un jour une relance passe aussi par un appel inline `notifyOwner` (EMAIL_KINDS), un même palier pourrait s'envoyer deux fois. B1 n'insère les notifs que via le cron, donc pas de double chemin ici.
- **`bailiff_cc_emails` vides en prod** : J+45 partira sans copie huissier tant que le staff ne les a pas saisis (écran B2). Acceptable — l'escalade huissier réelle est B2/manuelle.

## Entrées pour B2

L'écran staff `admin/collections` lira `collection_reminders` (timeline par transaction/armateur), éditera `debtor_response_type`/`debtor_response_at`, et ajoutera les boutons d'escalade manuelle `BAILIFF`/`JUDICIAL` qui appelleront le même `collectionReminderService` en mode manuel (bypass de l'âge, écriture registre + notice). La colonne `bailiff_cc_emails` (B1) sera éditable depuis cet écran.
