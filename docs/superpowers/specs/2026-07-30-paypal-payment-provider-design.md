# PayPal — nouveau rail de paiement en ligne (portail armateur)

> Spec de design — 2026-07-30
> Décidé avec le PO en session de brainstorming. Statut : validé, prêt pour `writing-plans`.

## 1. Objectif

Permettre à un armateur de payer sa facture de taxe carbone **par PayPal** depuis le portail
`/owner`, avec confirmation automatique de la transaction — au même niveau de service que le
rail STRIPE existant.

## 2. Décisions de cadrage

| Question | Décision | Raison |
|---|---|---|
| Surface | **Portail armateur v7** (PayDialog + `initiatePayment`) | C'est le parcours réellement emprunté par les armateurs. Le chemin legacy `/dashboard` (`payment_config` + `/api/payments/create`) n'est **pas** touché. |
| Modélisation | **Nouveau rail `PAYPAL`** dans l'enum `payment_rail` | Suit le précédent `STRIPE` : un rail nommé par provider pour un checkout en ligne auto-confirmé. Réutiliser `THIRD_PARTY` aurait collisionné avec Payoneer (le PayDialog n'expose qu'un provider par rail) et mélangé rail manuel / rail automatique. |
| Compte marchand | **Un seul compte plateforme**, comme Stripe | Le reversement aux souverainetés passe par le rapport de settlement existant (L8). Une paire de credentials, un webhook. |
| Capture | **Capture au retour navigateur + webhook en filet** | PayPal Orders v2 exige un `captureOrder` explicite après approbation (fenêtre 6 h). Capturer au retour donne à l'armateur une facture PAYÉE immédiate ; le webhook couvre l'onglet fermé. |
| Client API | **SDK officiel `@paypal/paypal-server-sdk`** | Gère le renouvellement du token OAuth2 client_credentials et les types Orders v2. La vérification de signature webhook n'étant pas exposée par le SDK, elle se fait en `fetch` sur `/v1/notifications/verify-webhook-signature`. |

### Hors périmètre (explicite)

- Le chemin legacy `/dashboard` : **aucune ligne `payment_config` pour PayPal**, exactement
  comme Stripe (« Stripe is its own provider — no row in payment_config »).
- **Remboursements automatisés** : `executeRefund` automatise WALLET et STRIPE uniquement.
  Le rail PAYPAL rejoint les autres rails (CASH, CHEQUE, MOBILE_MONEY, THIRD_PARTY…) :
  remboursement manuel, sans effet de bord API. L'automatisation
  (`/v2/payments/captures/{id}/refund`) est un chantier ultérieur.
- Devises autres que **USD** : le rail est USD-only, comme tout le pipeline fiscal.
- Mode `topup` du wallet : PayPal y est disponible sans code spécifique (le PayDialog gère
  déjà `transaction_id = null`), mais n'est pas la cible de validation.

## 3. Architecture

Trois nouveaux modules, une responsabilité chacun :

| Fichier | Rôle | Dépendances |
|---|---|---|
| `frontend/src/services/paypalService.ts` | Wrapper SDK **pur API, zéro accès DB** : `createOrder`, `captureOrder`, `getOrder`, `verifyWebhookSignature`. Calqué sur `stripeService.ts`. | SDK PayPal, env |
| `frontend/src/services/paypalConfirmation.ts` | **Seul** point qui fait bouger une ligne `payments` du rail PAYPAL : `confirmPaypalPayment()`. Appelé par les 3 chemins. | Supabase, paypalService, paymentConfirmationEffects |
| `frontend/src/services/paymentConfirmationEffects.ts` | Extraction du bloc « reçu PDF + e-mail + `notifyOwner` » aujourd'hui inliné dans le webhook Stripe (`route.ts` L210-303). Partagé Stripe / PayPal. | receiptService, emailService, notificationService |

Routes :

| Route | Méthode | Rôle |
|---|---|---|
| `/api/payments/paypal/return` | GET | Retour navigateur depuis PayPal → capture → confirmation → redirect |
| `/api/webhooks/paypal` | POST | Webhook PayPal (filets 1 et 2) |
| `/api/cron/paypal-reconcile-pending` | GET | Filet 3 : janitor quotidien |
| `/api/cron/payments-reconcile-all` | GET | Remplace `stripe-reconcile-all`, chaîne les 3 reconcilers |

Fichiers modifiés : `actions/initiatePayment.ts`, `api/owner/payment-availability/route.ts`,
`lib/feature-flags.ts`, `services/paymentService.ts` (type `PaymentRail`),
`components/owner/PayDialog/{usePayDialogContext,StepRailPicker,StepConfirm}.tsx`,
les 6 `messages/*.json`, `vercel.json`, `api/webhooks/stripe/route.ts` (extraction des effets).

### Le refactor `paymentConfirmationEffects`

C'est le seul geste hors périmètre strict, et il est nécessaire : sans lui on duplique ~90
lignes de génération de reçu PDF, d'envoi d'e-mail et de notification in-app. L'extraction est
**à iso-comportement pour Stripe** — même ordre d'opérations, même `fail-soft`, même
distinction `topup` (`transaction_id === null` → `WALLET_TOPPED_UP`) vs facture
(`PAYMENT_RECEIVED` avec `skipEmail: true` et le PDF en pièce jointe).

Signature :

```ts
export async function applyPaymentConfirmationEffects(
    admin: SupabaseClient,
    payment: { id: string; shipowner_id: string; transaction_id: string | null; amount_usd_minor: number },
    confirmedAt: string,
): Promise<void>   // fail-soft : ne throw jamais, log les échecs
```

## 4. Flux

### 4.1 Nominal

1. PayDialog → `StepConfirm` → `initiatePayment({ rail: 'PAYPAL', … })`
2. `paypalService.createOrder` : `intent = CAPTURE`, `custom_id = transactionId`,
   `return_url = ${APP_URL}/api/payments/paypal/return`,
   `cancel_url = ${APP_URL}/owner/invoices?paypal=cancel` → `{ orderId, approveUrl }`
3. INSERT `payments` : `rail = PAYPAL`, `status = PROCESSING`,
   `external_reference = orderId`, `rail_details.paypal_order_id = orderId`
4. Retour `{ ...row, checkoutUrl: approveUrl }` → `StepConfirm` redirige (la branche STRIPE
   existante est élargie aux deux rails à checkout)
5. L'armateur approuve sur PayPal → redirection vers
   `/api/payments/paypal/return?token=<orderId>&PayerID=<payerId>`
6. La route : `requireOwner()` → charge la ligne `payments` par
   `external_reference = token AND rail = 'PAYPAL'` → **vérifie
   `shipowner_id === ctx.shipowner.id`** → `captureOrder(orderId)` →
   `confirmPaypalPayment(...)` → `redirect('/owner/invoices?paypal=success')`

La facture est PAYÉE avant que la page ne s'affiche.

### 4.2 Les trois filets

Tous convergent vers la même `confirmPaypalPayment`.

| Panne | Filet | Mécanisme |
|---|---|---|
| L'armateur approuve puis ferme l'onglet avant le retour | **Webhook** `CHECKOUT.ORDER.APPROVED` | Capture côté serveur puis confirmation. PayPal retente la livraison pendant ~3 jours — c'est le vrai filet, largement dans la fenêtre de 6 h. |
| Capture réussie mais notre process meurt avant l'`UPDATE` | **Webhook** `PAYMENT.CAPTURE.COMPLETED` | Confirmation directe (la capture existe déjà côté PayPal). |
| Webhook perdu **et** onglet fermé | **Cron** `paypal-reconcile-pending` | Janitor quotidien : lignes PAYPAL `PROCESSING` de plus de 10 min → `getOrder` → `COMPLETED` = confirmer, `APPROVED` = capturer puis confirmer, `VOIDED` ou créée il y a plus de 6 h = `CANCELLED`. |

Événements webhook traités :

| Événement PayPal | Effet |
|---|---|
| `CHECKOUT.ORDER.APPROVED` | Si la ligne est encore `PROCESSING` : `captureOrder` puis confirmation |
| `PAYMENT.CAPTURE.COMPLETED` | Confirmation |
| `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.DECLINED` | `REJECTED` + `rejected_reason = 'PayPal: <raison>'` + notification `PAYMENT_REJECTED` |
| `CHECKOUT.ORDER.VOIDED` | `CANCELLED` |
| autres | log `webhook_unhandled_event` + 200 |

Codes de retour du webhook, alignés sur le webhook Stripe : **400** si signature absente ou
invalide ; **200** en succès, sur événement ignoré volontairement, *et même sur erreur interne*
(loguée) — pour ne jamais déclencher de tempête de retry.

### 4.3 Cadence du cron — contrainte Vercel

Le plan Vercel refuse toute expression cron plus fréquente qu'une fois par jour (c'est
documenté dans `stripe-reconcile-all`, créé exactement pour ça : deux reconcilers en `*/15`
échouaient au déploiement). Conséquence :

- Le cron PayPal est un **janitor quotidien**, pas un filet temps réel.
- La fenêtre de capture de 6 h est couverte par le **webhook** (retry PayPal ~3 jours), pas par
  le cron. C'est cohérent : le cron nettoie les traînards et annule les ordres expirés.
- Pour ne consommer **aucun nouveau créneau cron**, `stripe-reconcile-all` est renommé
  `payments-reconcile-all` et chaîne désormais trois sous-reconcilers
  (`stripe-reconcile-pending`, `stripe-refund-reconcile-pending`, `paypal-reconcile-pending`).
  `vercel.json` est repointé ; le fichier `stripe-reconcile-all/route.ts` (pur chaîneur, sans
  logique) est supprimé. Chaque sous-reconciler garde sa propre garde `CRON_SECRET` et reste
  appelable individuellement pour l'ops.

### 4.4 Idempotence

`confirmPaypalPayment` est le seul écrivain, et sa transition est gardée :

```ts
const { data: updated } = await admin
    .from('payments')
    .update({ status: 'CONFIRMED', confirmed_at, confirmed_by: systemActorId, rail_details })
    .eq('id', payment.id)
    .eq('status', 'PROCESSING')     // garde de course
    .select('id');
if (!updated?.length) return { outcome: 'IDEMPOTENT_SKIP' };  // une autre voie a gagné
```

Trois conséquences :

- Les effets de bord (reçu PDF, e-mail, notification) ne s'exécutent **qu'après** avoir gagné la
  course, donc exactement une fois. C'est mieux que le comportement actuel de
  `stripe-reconcile-pending`, qui confirme sans jamais émettre de reçu quand le webhook a été
  perdu.
- Les statuts terminaux (`CONFIRMED`, `REJECTED`, `CANCELLED`, `REFUNDED`) sortent avant l'UPDATE.
- Un index UNIQUE partiel sur `external_reference WHERE rail = 'PAYPAL'` interdit deux lignes
  pour le même ordre PayPal.

### 4.5 Sécurité du montant

Le montant crédité est **toujours** `payments.amount_usd_minor`, calculé à l'initiation depuis
la transaction — jamais celui du payload PayPal. La capture PayPal sert uniquement de contrôle :

- devise ≠ `USD` → `REJECTED` + audit `PAYMENT_AMOUNT_MISMATCH` en `WARNING`
- écart > `$0.01` → idem
- montant illisible → `REJECTED` + audit

C'est la discipline exacte du webhook unifié (`api/webhooks/payment/route.ts` L281-354).

### 4.6 Le piège `invoice_id`

On n'utilise **pas** `purchase_units[].invoice_id`. PayPal en impose l'unicité par compte
marchand : un armateur qui abandonne un paiement puis réessaie recevrait un
`DUPLICATE_INVOICE_ID` et serait bloqué. À la place :

- `custom_id` = `transactionId` (aucune contrainte d'unicité)
- `description` = `Carbon Tax Invoice <invoiceRef>`
- `reference_id` = `invoiceRef`

### 4.7 Contrat de `confirmPaypalPayment`

La capture est faite **par l'appelant**, pas par `confirmPaypalPayment` — les trois chemins
arrivent avec une capture déjà obtenue (ou déjà connue de PayPal) :

```ts
export async function confirmPaypalPayment(
    admin: SupabaseClient,
    input: {
        orderId: string;
        captureId: string | null;
        paidAmount: string | null;      // major units, tel que renvoyé par PayPal
        paidCurrency: string | null;
        payerEmail?: string | null;
    },
): Promise<{ outcome: 'CONFIRMED' | 'IDEMPOTENT_SKIP' | 'NOT_FOUND' | 'REJECTED_AMOUNT_MISMATCH' | 'ERROR' }>
```

Le client Supabase est fourni par l'appelant, selon son contexte :

- route de retour → `createTenantClient(ctx.jurisdictionId)` (on a le tenant via `requireOwner`)
- webhook et cron → `createPlatformClient()` (aucun contexte tenant, lookup par identifiant
  externe PayPal — même politique que le webhook Stripe)

## 5. Base de données

Deux migrations, et elles **doivent** être séparées : PostgreSQL interdit d'utiliser une valeur
d'enum dans la même transaction que le `ALTER TYPE … ADD VALUE` qui l'a créée. Un index partiel
`WHERE rail = 'PAYPAL'` dans la migration 113 échouerait.

### 113_payment_rail_paypal.sql

```sql
ALTER TYPE public.payment_rail ADD VALUE IF NOT EXISTS 'PAYPAL';
```

### 114_paypal_rail_support.sql

1. **Index UNIQUE partiel** (garde d'idempotence + lookup webhook rapide) :

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_paypal_order
    ON public.payments (external_reference)
    WHERE rail = 'PAYPAL' AND external_reference IS NOT NULL;
```

2. **`can_confirm_payment`** (mig 057) : `PAYPAL` rejoint `WALLET` et `STRIPE` dans la liste des
   rails confirmés par le système, **jamais par un humain** :

```sql
IF v_rail IN ('WALLET', 'STRIPE', 'PAYPAL') THEN RETURN FALSE; END IF;
```

3. **Feature flag** : `INSERT` dans `app_config` de `feature.online_payment_paypal_enabled` à
   `false` (bascule explicite au déploiement).

### Ce qui ne change pas

- **`payments_owner_insert` (mig 058) reste inchangée.** Sa clause impose
  `status = 'INITIATED'` et une liste de rails qui exclut déjà `STRIPE` ; les lignes PAYPAL
  naissent en `PROCESSING` via un client service-role (`createTenantClient`), hors RLS. Ajouter
  `PAYPAL` à cette policy serait du bruit trompeur.
- **`payment_config`** : aucune ligne PayPal (voir hors-périmètre).
- **`refunds.refund_rail`** partage l'enum `payment_rail` et accepte donc `PAYPAL`
  mécaniquement, sans automatisation associée.

## 6. Configuration

| Variable | Rôle |
|---|---|
| `PAYPAL_CLIENT_ID` | OAuth2 client credentials |
| `PAYPAL_CLIENT_SECRET` | idem |
| `PAYPAL_ENV` | `sandbox` \| `live` → `Environment.Sandbox` / `Environment.Production` |
| `PAYPAL_WEBHOOK_ID` | Requis par `/v1/notifications/verify-webhook-signature` |

Comme pour Stripe, la visibilité du rail exige **deux** conditions (fail-secure) :
credentials présentes **et** `feature.online_payment_paypal_enabled = true`.

`PortalFeatureFlags` gagne un 7ᵉ champ `onlinePaymentPaypalEnabled`.

Dans `payment-availability`, `PAYPAL` suit le traitement de `STRIPE` — pas de lecture de
`payment_config`, éligibilité dérivée de l'env + du flag, `providers: [{ provider: 'paypal', … }]`
quand c'est actif, `reason: 'no_active_provider'` sinon.

## 7. Interface

- `usePayDialogContext` : le type `Rail` gagne `'PAYPAL'`.
- `StepRailPicker` : entrée `RAIL_META.PAYPAL`. `lucide-react` n'a pas d'icône de marque — on
  ajoute un petit composant SVG inline `PaypalMark` (couleur `#0070BA`). La reconnaissance de la
  marque compte au moment de payer : un logo générique dégrade la confiance.
- `StepRailParams` : PayPal ne demande **aucun paramètre**, comme Stripe — seul le
  `paramsHint.paypal` s'affiche.
- `StepConfirm` : la condition de redirection passe de `ctx.rail === 'STRIPE'` à
  `(ctx.rail === 'STRIPE' || ctx.rail === 'PAYPAL')`.
- `/owner/invoices` : gère les query params `?paypal=success|cancel|failed|pending` avec le même
  traitement que `?stripe=`.

### i18n — 6 locales (`fr`, `en`, `pt`, `sw`, `ar`, `so`)

Sous `OwnerPortal.payDialog` :

- `rail.paypal.label` / `rail.paypal.hint`
- `paramsHint.paypal`

`fr` et `en` sont rédigées ; `pt`, `sw`, `ar`, `so` suivent la baseline de traduction
automatique du projet (à relire par un natif, comme le reste).

## 8. Gestion des erreurs

| Situation | Comportement |
|---|---|
| Credentials PayPal absentes | Rail invisible dans le picker. Si `initiatePayment` est appelé quand même → `throw`, aucune ligne `payments` créée. **Pas de fallback silencieux vers un autre rail** (contrairement au chemin legacy) — l'armateur choisit son rail. |
| `createOrder` échoue | `throw` avant tout INSERT ; le PayDialog affiche l'erreur. Aucune ligne orpheline. |
| `captureOrder` échoue au retour | La ligne reste `PROCESSING`, redirect `?paypal=pending`, log `error`. Les filets webhook/cron reprennent la main. |
| `token` absent ou inconnu au retour | Redirect `?paypal=failed`, log `warn`. Aucune écriture. |
| Ligne appartenant à un autre armateur | Redirect `?paypal=failed`, log `error` — jamais d'indication de l'existence de la ligne. |
| Signature webhook invalide | `400`, aucune écriture. |
| Écart de montant / devise | `REJECTED` + audit `PAYMENT_AMOUNT_MISMATCH` (`WARNING`). |
| Pas d'acteur système résolvable | Erreur loguée, aucune confirmation (la contrainte `payments_confirmed_audit` exige `confirmed_by NOT NULL`). |
| `recompute_transaction_status` échoue | Logué sans faire échouer — le trigger sur `payments` recalcule aussi. |

## 9. Tests

**Unitaires**

- `paypalService` : sélection d'environnement, `createOrder` (extraction du lien `approve`),
  `captureOrder`, `getOrder`, `verifyWebhookSignature` (succès / échec / `PAYPAL_WEBHOOK_ID`
  absent) — SDK et `fetch` mockés.
- `paypalConfirmation` : confirmation nominale, saut idempotent sur statut terminal, perte de
  course (0 ligne mise à jour → effets **non** exécutés), devise ≠ USD, écart de montant,
  acteur système absent.
- `paymentConfirmationEffects` : branche facture vs branche topup, chaque échec reste fail-soft.
- `initiatePayment` : branche PAYPAL (ligne `PROCESSING`, `external_reference` = orderId,
  `checkoutUrl` retourné), refus si credentials absentes.
- `feature-flags` : le 7ᵉ flag, défaut `false`.
- `payment-availability` : PAYPAL éligible seulement si env **et** flag.

**Routes**

- `payments/paypal/return` : non authentifié, ligne d'un autre armateur, `token` inconnu,
  capture OK, capture en échec.
- `webhooks/paypal` : signature absente/invalide → 400 ; les 5 familles d'événements ;
  ordre inconnu ; erreur interne → 200.
- `cron/paypal-reconcile-pending` : garde `CRON_SECRET`, les 4 issues de décision.
- `cron/payments-reconcile-all` : chaînage, isolation des échecs.

**Non-régression Stripe** — la suite existante du webhook Stripe doit passer **inchangée** après
l'extraction des effets. C'est le critère d'acceptation du refactor.

**Migrations** (`supabase/tests/migrations/`) : valeur d'enum présente, index UNIQUE existant et
effectivement bloquant sur doublon, `can_confirm_payment` renvoie `false` pour une ligne PAYPAL,
clé `app_config` semée.

Pas de test E2E Playwright : il faudrait un compte sandbox PayPal et une interaction hors
domaine. La validation de bout en bout se fait manuellement en sandbox.

## 10. Déploiement

1. Appliquer `113` puis `114` (dans cet ordre, transactions séparées).
2. Créer l'app PayPal (sandbox d'abord), renseigner `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
   `PAYPAL_ENV`, `PAYPAL_WEBHOOK_ID` dans le GitHub Environment concerné et sur Vercel.
3. Déclarer le webhook côté PayPal sur `https://<host>/api/webhooks/paypal` avec les 5
   événements listés en §4.2, puis reporter l'ID généré dans `PAYPAL_WEBHOOK_ID`.
4. Vérifier que `vercel.json` pointe bien `payments-reconcile-all`.
5. Bascule : passer `feature.online_payment_paypal_enabled` à `true`.
6. Recette sandbox : un paiement complet, un paiement abandonné (l'ordre doit finir `CANCELLED`),
   un onglet fermé après approbation (le webhook doit confirmer).
