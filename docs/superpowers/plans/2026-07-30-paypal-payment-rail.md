# PayPal Payment Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un armateur de payer sa facture de taxe carbone par PayPal depuis le portail, avec confirmation automatique de la transaction.

**Architecture:** Nouveau rail `PAYPAL` dans l'enum `payment_rail`, calqué sur le rail `STRIPE`. `initiatePayment` crée un ordre PayPal (intent CAPTURE) et insère une ligne `payments` en `PROCESSING`. La capture est déclenchée au retour navigateur (`/api/payments/paypal/return`), avec le webhook PayPal en filet et un cron janitor quotidien en dernier recours. Les trois chemins convergent vers une unique fonction `confirmPaypalPayment` dont la transition est gardée par une condition de course, garantissant que les effets de bord (reçu PDF, e-mail, notification) s'exécutent exactement une fois.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Supabase (Postgres + RLS), `@paypal/paypal-server-sdk` 2.4.0, vitest, zod 4, next-intl.

## Global Constraints

- **Spec de référence :** `docs/superpowers/specs/2026-07-30-paypal-payment-provider-design.md`. En cas de doute, elle tranche.
- **TypeScript strict, `any` interdit.** Utiliser `unknown` + narrowing, ou un type dédié.
- **Auteur des commits :** `git commit --author="Loïc Leclerc <leclerc@drwintech.com>"`. Jamais de `Co-Authored-By: Claude`, jamais de mention « Generated with Claude Code ».
- **Staging explicite :** `git add <chemins>`, jamais `git add -A` ni `git add .`.
- **Tests :** `npm test` = `vitest run` (depuis `frontend/`). Les tests sous `src/app/api/**` tournent en environnement `node`, tous les autres en `jsdom` (voir `vitest.config.ts`).
- **Devise :** le rail est **USD-only**. Toute autre devise reçue de PayPal est un rejet, jamais une conversion.
- **Montant autoritatif :** le montant crédité est **toujours** `payments.amount_usd_minor`, jamais celui du payload PayPal. Tolérance de comparaison : `$0.01`.
- **Chemin legacy intouché :** ne rien ajouter dans `payment_config`, ni dans `paymentService.ts` en dehors du type `PaymentRail`, ni dans `/api/payments/create`.
- **Client Supabase :** service-role uniquement via `createTenantClient(jurisdictionId)` (contexte tenant connu) ou `createPlatformClient()` (webhook/cron). Ne jamais lire `process.env.SUPABASE_SERVICE_ROLE_KEY` directement — une règle ESLint l'interdit.
- **Migrations :** numéros `113` et `114`. La `113` ne contient **que** le `ALTER TYPE` (Postgres interdit d'utiliser une valeur d'enum dans la transaction qui la crée).
- **Variables d'environnement :** `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV` (`sandbox`|`live`), `PAYPAL_WEBHOOK_ID`.
- **URL de retour canonique :** `/dashboard/invoices` (le shell unifié). `/owner/invoices` n'existe plus qu'en redirect 301 — ne pas l'utiliser dans du code neuf.
- **i18n :** toute clé ajoutée doit l'être dans **les 6 locales** : `fr`, `en`, `pt`, `sw`, `ar`, `so`.

---

## Structure de fichiers

**Créés :**

| Fichier | Responsabilité |
|---|---|
| `frontend/src/services/paypalService.ts` | Wrapper SDK PayPal. **Aucun accès DB.** |
| `frontend/src/services/paypalService.test.ts` | — |
| `frontend/src/services/paymentConfirmationEffects.ts` | Effets post-confirmation partagés Stripe/PayPal (reçu, e-mail, notif). |
| `frontend/src/services/paymentConfirmationEffects.test.ts` | — |
| `frontend/src/services/paypalConfirmation.ts` | Unique écrivain des lignes `payments` du rail PAYPAL. |
| `frontend/src/services/paypalConfirmation.test.ts` | — |
| `frontend/src/app/api/payments/paypal/return/route.ts` | Retour navigateur → capture → confirmation → redirect. |
| `frontend/src/app/api/payments/paypal/return/route.test.ts` | — |
| `frontend/src/app/api/webhooks/paypal/route.ts` | Webhook PayPal (filets 1 et 2). |
| `frontend/src/app/api/webhooks/paypal/route.test.ts` | — |
| `frontend/src/app/api/cron/paypal-reconcile-pending/route.ts` | Janitor quotidien (filet 3). |
| `frontend/src/app/api/cron/paypal-reconcile-pending/route.test.ts` | — |
| `frontend/src/app/api/cron/payments-reconcile-all/route.ts` | Chaîne les 3 reconcilers dans un seul créneau cron. |
| `frontend/src/app/api/cron/payments-reconcile-all/route.test.ts` | — |
| `frontend/src/components/owner/PayDialog/PaypalMark.tsx` | Logo PayPal en SVG inline. |
| `supabase/migrations/113_payment_rail_paypal.sql` | `ALTER TYPE … ADD VALUE 'PAYPAL'` seul. |
| `supabase/migrations/114_paypal_rail_support.sql` | Index unique, `can_confirm_payment`, feature flag. |
| `supabase/tests/migrations/113_payment_rail_paypal.test.sql` | — |
| `supabase/tests/migrations/114_paypal_rail_support.test.sql` | — |

**Modifiés :**

| Fichier | Modification |
|---|---|
| `frontend/package.json` | + `@paypal/paypal-server-sdk` |
| `frontend/src/services/paymentService.ts` | type `PaymentRail` += `'PAYPAL'` |
| `frontend/src/app/api/webhooks/stripe/route.ts` | remplace le bloc effets inline par l'appel au module extrait |
| `frontend/src/lib/feature-flags.ts` | 7ᵉ flag `onlinePaypalEnabled` |
| `frontend/src/app/api/owner/payment-availability/route.ts` | branche `PAYPAL` |
| `frontend/src/actions/initiatePayment.ts` | branche `PAYPAL` |
| `frontend/src/components/owner/PayDialog/usePayDialogContext.tsx` | type `Rail` += `'PAYPAL'` |
| `frontend/src/components/owner/PayDialog/StepRailPicker.tsx` | `RAIL_META.PAYPAL` |
| `frontend/src/components/owner/PayDialog/StepConfirm.tsx` | redirection élargie aux deux rails à checkout |
| `frontend/src/app/(dashboard)/dashboard/invoices/page.tsx` | lecture de `?paypal=` |
| `frontend/src/components/owner/pages/OperatorInvoicesPage.tsx` | bannières `paypalReturn` |
| `frontend/messages/{fr,en,pt,sw,ar,so}.json` | clés PayPal |
| `frontend/vercel.json` | cron repointé sur `payments-reconcile-all` |

**Supprimé :** `frontend/src/app/api/cron/stripe-reconcile-all/route.ts` et son test (pur chaîneur remplacé par `payments-reconcile-all`).

---

## Ordre des tâches et dépendances

```
Task 1 (paypalService) ──┬─→ Task 5 (availability)
                         ├─→ Task 6 (initiatePayment) ─→ Task 10 (UI + i18n)
Task 2 (migrations) ─────┤
Task 3 (effets extraits) ┴─→ Task 4 (confirmPaypalPayment) ─┬─→ Task 7 (return)
                                                            ├─→ Task 8 (webhook)
                                                            └─→ Task 9 (crons)
```

---

## Task 1 : `paypalService` — wrapper SDK

**Files:**
- Modify: `frontend/package.json` (dépendance)
- Create: `frontend/src/services/paypalService.ts`
- Test: `frontend/src/services/paypalService.test.ts`

**Interfaces:**
- Consumes: rien (premier module).
- Produces:
  ```ts
  export interface PaypalOrder { orderId: string; approveUrl: string }
  export interface PaypalCapture {
      captureId: string | null;
      orderStatus: string;
      paidAmount: string | null;      // major units, string, ex. '1250.00'
      paidCurrency: string | null;    // ex. 'USD'
      payerEmail: string | null;
  }
  export function paypalConfigured(): boolean
  export function createOrder(input: {
      amountUsdMinor: number; transactionId: string | null;
      invoiceRef: string; returnUrl: string; cancelUrl: string;
  }): Promise<PaypalOrder>
  export function captureOrder(orderId: string): Promise<PaypalCapture>
  export function getOrder(orderId: string): Promise<PaypalCapture>
  export function verifyWebhookSignature(
      headers: Record<string, string | null>, rawBody: string,
  ): Promise<boolean>
  export function __resetPaypalClientForTests(): void
  ```

- [ ] **Step 1 : Installer le SDK**

```bash
cd frontend && npm install @paypal/paypal-server-sdk@^2.4.0
```

Vérifier que `package.json` liste bien `"@paypal/paypal-server-sdk": "^2.4.0"` dans `dependencies` (pas `devDependencies`).

- [ ] **Step 2 : Écrire le test qui échoue**

Créer `frontend/src/services/paypalService.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock du SDK PayPal ──────────────────────────────────────────────────────
const createOrderMock = vi.fn();
const captureOrderMock = vi.fn();
const getOrderMock = vi.fn();

vi.mock('@paypal/paypal-server-sdk', () => ({
    Client: class {
        constructor(public cfg: unknown) {}
    },
    Environment: { Sandbox: 'Sandbox', Production: 'Production' },
    CheckoutPaymentIntent: { Capture: 'CAPTURE' },
    OrdersController: class {
        createOrder = createOrderMock;
        captureOrder = captureOrderMock;
        getOrder = getOrderMock;
    },
}));

import {
    paypalConfigured, createOrder, captureOrder, getOrder,
    verifyWebhookSignature, __resetPaypalClientForTests,
} from './paypalService';

const ENV_KEYS = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_ENV', 'PAYPAL_WEBHOOK_ID'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    process.env.PAYPAL_CLIENT_ID = 'cid';
    process.env.PAYPAL_CLIENT_SECRET = 'csecret';
    process.env.PAYPAL_ENV = 'sandbox';
    process.env.PAYPAL_WEBHOOK_ID = 'wh-123';
    createOrderMock.mockReset();
    captureOrderMock.mockReset();
    getOrderMock.mockReset();
    __resetPaypalClientForTests();
    vi.unstubAllGlobals();
});

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

describe('paypalConfigured', () => {
    it('true quand client id et secret sont présents', () => {
        expect(paypalConfigured()).toBe(true);
    });

    it('false quand le secret manque', () => {
        delete process.env.PAYPAL_CLIENT_SECRET;
        expect(paypalConfigured()).toBe(false);
    });
});

describe('createOrder', () => {
    it('extrait orderId et le lien approve', async () => {
        createOrderMock.mockResolvedValue({
            result: {
                id: 'ORDER-1',
                status: 'CREATED',
                links: [
                    { href: 'https://api/orders/ORDER-1', rel: 'self', method: 'GET' },
                    { href: 'https://paypal.com/approve/ORDER-1', rel: 'approve', method: 'GET' },
                ],
            },
        });

        const out = await createOrder({
            amountUsdMinor: 125000,
            transactionId: 'tx-1',
            invoiceRef: 'INV-2026-abc',
            returnUrl: 'https://app/return',
            cancelUrl: 'https://app/cancel',
        });

        expect(out).toEqual({ orderId: 'ORDER-1', approveUrl: 'https://paypal.com/approve/ORDER-1' });
    });

    it('envoie le montant en unités majeures, USD, intent CAPTURE', async () => {
        createOrderMock.mockResolvedValue({
            result: { id: 'ORDER-2', links: [{ rel: 'approve', href: 'https://x' }] },
        });

        await createOrder({
            amountUsdMinor: 125000,
            transactionId: 'tx-1',
            invoiceRef: 'INV-2026-abc',
            returnUrl: 'https://app/return',
            cancelUrl: 'https://app/cancel',
        });

        const arg = createOrderMock.mock.calls[0][0];
        expect(arg.body.intent).toBe('CAPTURE');
        expect(arg.body.purchaseUnits[0].amount).toEqual({ currencyCode: 'USD', value: '1250.00' });
        expect(arg.body.purchaseUnits[0].customId).toBe('tx-1');
        expect(arg.body.purchaseUnits[0].referenceId).toBe('INV-2026-abc');
    });

    it("n'envoie JAMAIS invoiceId (unicité imposée par PayPal → DUPLICATE_INVOICE_ID au retry)", async () => {
        createOrderMock.mockResolvedValue({
            result: { id: 'ORDER-3', links: [{ rel: 'approve', href: 'https://x' }] },
        });

        await createOrder({
            amountUsdMinor: 100,
            transactionId: 'tx-1',
            invoiceRef: 'INV-2026-abc',
            returnUrl: 'https://app/return',
            cancelUrl: 'https://app/cancel',
        });

        const arg = createOrderMock.mock.calls[0][0];
        expect(arg.body.purchaseUnits[0].invoiceId).toBeUndefined();
    });

    it('throw si aucun lien approve', async () => {
        createOrderMock.mockResolvedValue({ result: { id: 'ORDER-4', links: [{ rel: 'self', href: 'x' }] } });
        await expect(createOrder({
            amountUsdMinor: 100, transactionId: null, invoiceRef: 'r',
            returnUrl: 'a', cancelUrl: 'b',
        })).rejects.toThrow(/approve/i);
    });

    it('throw si les credentials manquent', async () => {
        delete process.env.PAYPAL_CLIENT_ID;
        __resetPaypalClientForTests();
        await expect(createOrder({
            amountUsdMinor: 100, transactionId: null, invoiceRef: 'r',
            returnUrl: 'a', cancelUrl: 'b',
        })).rejects.toThrow(/PAYPAL_CLIENT_ID/);
    });
});

describe('captureOrder', () => {
    it('extrait capture id, montant, devise et e-mail payeur', async () => {
        captureOrderMock.mockResolvedValue({
            result: {
                id: 'ORDER-1',
                status: 'COMPLETED',
                payer: { emailAddress: 'payer@example.com' },
                purchaseUnits: [{
                    payments: {
                        captures: [{ id: 'CAP-9', amount: { value: '1250.00', currencyCode: 'USD' } }],
                    },
                }],
            },
        });

        expect(await captureOrder('ORDER-1')).toEqual({
            captureId: 'CAP-9',
            orderStatus: 'COMPLETED',
            paidAmount: '1250.00',
            paidCurrency: 'USD',
            payerEmail: 'payer@example.com',
        });
    });

    it('tolère une réponse sans capture (statut seul)', async () => {
        captureOrderMock.mockResolvedValue({ result: { id: 'ORDER-1', status: 'APPROVED' } });
        expect(await captureOrder('ORDER-1')).toEqual({
            captureId: null, orderStatus: 'APPROVED',
            paidAmount: null, paidCurrency: null, payerEmail: null,
        });
    });
});

describe('getOrder', () => {
    it('lit le statut et la capture existante', async () => {
        getOrderMock.mockResolvedValue({
            result: {
                id: 'ORDER-1',
                status: 'COMPLETED',
                purchaseUnits: [{
                    payments: { captures: [{ id: 'CAP-1', amount: { value: '10.00', currencyCode: 'USD' } }] },
                }],
            },
        });
        const out = await getOrder('ORDER-1');
        expect(out.orderStatus).toBe('COMPLETED');
        expect(out.captureId).toBe('CAP-1');
    });
});

describe('verifyWebhookSignature', () => {
    const HEADERS = {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api.paypal.com/cert.pem',
        'paypal-transmission-id': 'tid-1',
        'paypal-transmission-sig': 'sig-1',
        'paypal-transmission-time': '2026-07-30T10:00:00Z',
    };

    it('true quand PayPal répond SUCCESS', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ verification_status: 'SUCCESS' }) });
        vi.stubGlobal('fetch', fetchMock);

        expect(await verifyWebhookSignature(HEADERS, '{"id":"EV-1"}')).toBe(true);

        const verifyCall = fetchMock.mock.calls[1];
        expect(verifyCall[0]).toContain('/v1/notifications/verify-webhook-signature');
        const body = JSON.parse(verifyCall[1].body as string);
        expect(body.webhook_id).toBe('wh-123');
        expect(body.transmission_id).toBe('tid-1');
        expect(body.webhook_event).toEqual({ id: 'EV-1' });
    });

    it('false quand PayPal répond FAILURE', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ verification_status: 'FAILURE' }) }));
        expect(await verifyWebhookSignature(HEADERS, '{"id":"EV-1"}')).toBe(false);
    });

    it('false si PAYPAL_WEBHOOK_ID absent — jamais fail-open', async () => {
        delete process.env.PAYPAL_WEBHOOK_ID;
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        expect(await verifyWebhookSignature(HEADERS, '{}')).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('false si un header de signature manque', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const incomplete = { ...HEADERS, 'paypal-transmission-sig': null };
        expect(await verifyWebhookSignature(incomplete, '{}')).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('false si le corps n’est pas du JSON', async () => {
        vi.stubGlobal('fetch', vi.fn());
        expect(await verifyWebhookSignature(HEADERS, 'not-json')).toBe(false);
    });

    it('false si l’appel de vérification échoue', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) })
            .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) }));
        expect(await verifyWebhookSignature(HEADERS, '{}')).toBe(false);
    });
});
```

- [ ] **Step 3 : Lancer le test, vérifier qu'il échoue**

```bash
cd frontend && npx vitest run src/services/paypalService.test.ts
```

Attendu : ÉCHEC — `Failed to resolve import "./paypalService"`.

- [ ] **Step 4 : Écrire l'implémentation**

Créer `frontend/src/services/paypalService.ts` :

```ts
import {
    Client,
    Environment,
    CheckoutPaymentIntent,
    OrdersController,
} from '@paypal/paypal-server-sdk';

/**
 * paypalService — wrapper mince autour du SDK PayPal Server.
 *
 * Isole `@paypal/paypal-server-sdk` dans ce module : le reste du code importe
 * depuis '@/services/paypalService'. Même intention que stripeService.ts —
 * protéger les appelants du churn d'API et centraliser la configuration.
 *
 * Server-only : ne jamais importer depuis un composant client.
 *
 * NOTE — vérification de signature webhook : le SDK ne l'expose pas. Elle passe
 * par l'endpoint REST /v1/notifications/verify-webhook-signature, qui exige un
 * token OAuth2 ; d'où le petit cache de token en bas de fichier.
 */

const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';
const LIVE_BASE = 'https://api-m.paypal.com';

function isLive(): boolean {
    return (process.env.PAYPAL_ENV ?? 'sandbox').toLowerCase() === 'live';
}

function apiBase(): string {
    return isLive() ? LIVE_BASE : SANDBOX_BASE;
}

/** True si les credentials nécessaires à un appel sortant sont présentes. */
export function paypalConfigured(): boolean {
    return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

let cachedOrders: OrdersController | null = null;

/**
 * Test-only : vide les caches (client SDK + token OAuth) entre deux tests.
 * Le code de production ne doit jamais l'appeler.
 */
export function __resetPaypalClientForTests(): void {
    cachedOrders = null;
    cachedToken = null;
}

function ordersController(): OrdersController {
    if (cachedOrders) return cachedOrders;
    const id = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;
    if (!id) throw new Error('PAYPAL_CLIENT_ID is not configured');
    if (!secret) throw new Error('PAYPAL_CLIENT_SECRET is not configured');

    const client = new Client({
        clientCredentialsAuthCredentials: { oAuthClientId: id, oAuthClientSecret: secret },
        environment: isLive() ? Environment.Production : Environment.Sandbox,
    });
    cachedOrders = new OrdersController(client);
    return cachedOrders;
}

export interface PaypalOrder {
    /** Identifiant d'ordre PayPal — devient payments.external_reference. */
    orderId: string;
    /** URL d'approbation vers laquelle rediriger l'armateur. */
    approveUrl: string;
}

export interface PaypalCapture {
    /** Identifiant de capture, null si l'ordre n'est pas encore capturé. */
    captureId: string | null;
    /** Statut de l'ordre : CREATED | APPROVED | COMPLETED | VOIDED … */
    orderStatus: string;
    /** Montant capturé en unités majeures (string PayPal), null si absent. */
    paidAmount: string | null;
    paidCurrency: string | null;
    payerEmail: string | null;
}

/** Narrowing sans `any` sur les réponses du SDK. */
function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function extractCapture(raw: unknown): PaypalCapture {
    const result = asRecord(raw);
    const units = Array.isArray(result.purchaseUnits) ? result.purchaseUnits : [];
    const payments = asRecord(asRecord(units[0]).payments);
    const captures = Array.isArray(payments.captures) ? payments.captures : [];
    const capture = asRecord(captures[0]);
    const amount = asRecord(capture.amount);
    const payer = asRecord(result.payer);

    return {
        captureId: typeof capture.id === 'string' ? capture.id : null,
        orderStatus: typeof result.status === 'string' ? result.status : 'UNKNOWN',
        paidAmount: amount.value != null ? String(amount.value) : null,
        paidCurrency: typeof amount.currencyCode === 'string' ? amount.currencyCode : null,
        payerEmail: typeof payer.emailAddress === 'string' ? payer.emailAddress : null,
    };
}

/**
 * Crée un ordre PayPal en intent CAPTURE et renvoie le lien d'approbation.
 *
 * On n'envoie volontairement PAS `invoiceId` : PayPal en impose l'unicité par
 * compte marchand, donc un armateur qui abandonne puis réessaie recevrait un
 * DUPLICATE_INVOICE_ID. La référence de facture voyage dans `referenceId` +
 * `description`, et `customId` porte l'id de transaction.
 *
 * @throws si les credentials manquent, si PayPal refuse, ou si la réponse ne
 * contient pas de lien `approve`.
 */
export async function createOrder(input: {
    amountUsdMinor: number;
    transactionId: string | null;
    invoiceRef: string;
    returnUrl: string;
    cancelUrl: string;
}): Promise<PaypalOrder> {
    const controller = ordersController();
    const value = (input.amountUsdMinor / 100).toFixed(2);

    const response = await controller.createOrder({
        body: {
            intent: CheckoutPaymentIntent.Capture,
            purchaseUnits: [
                {
                    referenceId: input.invoiceRef,
                    customId: input.transactionId ?? undefined,
                    description: `Carbon Tax Invoice ${input.invoiceRef}`,
                    amount: { currencyCode: 'USD', value },
                },
            ],
            applicationContext: {
                returnUrl: input.returnUrl,
                cancelUrl: input.cancelUrl,
                brandName: 'Green Gate',
                userAction: 'PAY_NOW',
            },
        },
        prefer: 'return=representation',
    });

    const result = asRecord(response.result);
    const orderId = typeof result.id === 'string' ? result.id : null;
    if (!orderId) throw new Error('PayPal order created without an id');

    const links = Array.isArray(result.links) ? result.links : [];
    const approve = links
        .map(asRecord)
        .find((l) => l.rel === 'approve' && typeof l.href === 'string');
    if (!approve) throw new Error('PayPal order created without an approve link');

    return { orderId, approveUrl: String(approve.href) };
}

/**
 * Capture un ordre approuvé. Idempotent côté PayPal : capturer un ordre déjà
 * COMPLETED renvoie une erreur ORDER_ALREADY_CAPTURED — l'appelant la traite
 * comme « déjà capturé » et retombe sur getOrder().
 */
export async function captureOrder(orderId: string): Promise<PaypalCapture> {
    const response = await ordersController().captureOrder({
        id: orderId,
        prefer: 'return=representation',
    });
    return extractCapture(response.result);
}

/** Lit l'état autoritatif d'un ordre — utilisé par le webhook et le cron. */
export async function getOrder(orderId: string): Promise<PaypalCapture> {
    const response = await ordersController().getOrder({ id: orderId });
    return extractCapture(response.result);
}

// ── Token OAuth2 (uniquement pour la vérification de signature webhook) ─────

let cachedToken: { value: string; expiresAtMs: number } | null = null;

async function accessToken(): Promise<string | null> {
    const now = Date.now();
    if (cachedToken && cachedToken.expiresAtMs > now + 60_000) return cachedToken.value;

    const id = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;
    if (!id || !secret) return null;

    const basic = Buffer.from(`${id}:${secret}`).toString('base64');
    const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
    });
    if (!res.ok) return null;

    const body = asRecord(await res.json());
    const token = typeof body.access_token === 'string' ? body.access_token : null;
    if (!token) return null;

    const ttl = typeof body.expires_in === 'number' ? body.expires_in : 300;
    cachedToken = { value: token, expiresAtMs: now + ttl * 1000 };
    return token;
}

const SIG_HEADERS = [
    'paypal-auth-algo',
    'paypal-cert-url',
    'paypal-transmission-id',
    'paypal-transmission-sig',
    'paypal-transmission-time',
] as const;

/**
 * Vérifie la signature d'un webhook PayPal via
 * POST /v1/notifications/verify-webhook-signature.
 *
 * Fail-secure : tout élément manquant (webhook id, header, corps illisible) ou
 * toute erreur d'appel renvoie `false`. On ne laisse jamais passer un webhook
 * non vérifié.
 */
export async function verifyWebhookSignature(
    headers: Record<string, string | null>,
    rawBody: string,
): Promise<boolean> {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) return false;

    const values: Record<string, string> = {};
    for (const h of SIG_HEADERS) {
        const v = headers[h];
        if (!v) return false;
        values[h] = v;
    }

    let event: unknown;
    try {
        event = JSON.parse(rawBody);
    } catch {
        return false;
    }

    try {
        const token = await accessToken();
        if (!token) return false;

        const res = await fetch(`${apiBase()}/v1/notifications/verify-webhook-signature`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                auth_algo: values['paypal-auth-algo'],
                cert_url: values['paypal-cert-url'],
                transmission_id: values['paypal-transmission-id'],
                transmission_sig: values['paypal-transmission-sig'],
                transmission_time: values['paypal-transmission-time'],
                webhook_id: webhookId,
                webhook_event: event,
            }),
        });
        if (!res.ok) return false;

        const body = asRecord(await res.json());
        return body.verification_status === 'SUCCESS';
    } catch {
        return false;
    }
}
```

- [ ] **Step 5 : Lancer le test, vérifier qu'il passe**

```bash
cd frontend && npx vitest run src/services/paypalService.test.ts
```

Attendu : PASS, 16 tests.

- [ ] **Step 6 : Vérifier typecheck et lint**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

Attendu : aucune erreur. Si `tsc` se plaint des noms de propriété du SDK (`purchaseUnits`, `applicationContext`, `userAction`), lire les types réels dans `node_modules/@paypal/paypal-server-sdk/dist/types/` et corriger — **ne pas** contourner avec `any` ou `@ts-ignore`.

- [ ] **Step 7 : Commit**

```bash
cd /c/Users/lecle/Workspace/africgreen
git add frontend/package.json frontend/package-lock.json \
        frontend/src/services/paypalService.ts frontend/src/services/paypalService.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" \
  -m "feat(payments): wrapper PayPal (orders v2 + vérification webhook)"
```

---

## Task 2 : Migrations — rail PAYPAL

**Files:**
- Create: `supabase/migrations/113_payment_rail_paypal.sql`
- Create: `supabase/migrations/114_paypal_rail_support.sql`
- Test: `supabase/tests/migrations/113_payment_rail_paypal.test.sql`
- Test: `supabase/tests/migrations/114_paypal_rail_support.test.sql`
- Modify: `frontend/src/services/paymentService.ts:528-538` (type `PaymentRail`)

**Interfaces:**
- Consumes: rien.
- Produces: valeur d'enum `'PAYPAL'` sur `public.payment_rail` ; index `idx_payments_paypal_order` ; clé `app_config` `feature.online_payment_paypal_enabled` ; type TS `PaymentRail` incluant `'PAYPAL'`.

- [ ] **Step 1 : Écrire la migration 113 (enum seul)**

Créer `supabase/migrations/113_payment_rail_paypal.sql` :

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 113 : valeur d'enum PAYPAL sur payment_rail
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Cette migration ne contient QUE le ALTER TYPE, volontairement.
--
-- PostgreSQL interdit d'utiliser une valeur d'enum dans la même transaction que
-- le `ALTER TYPE … ADD VALUE` qui l'a créée. Or les migrations Supabase sont
-- appliquées dans une transaction. Un index partiel `WHERE rail = 'PAYPAL'` ou
-- un `INSERT … rail = 'PAYPAL'` placé ici échouerait avec
-- « unsafe use of new value "PAYPAL" of enum type payment_rail ».
--
-- Tout ce qui *utilise* la valeur vit donc dans la migration 114.
--
-- Le rail PAYPAL est un rail de checkout en ligne auto-confirmé, jumeau de
-- STRIPE : la ligne payments naît en PROCESSING, et seul le système la confirme
-- (voir 114 pour can_confirm_payment).

ALTER TYPE public.payment_rail ADD VALUE IF NOT EXISTS 'PAYPAL';

-- DOWN :
-- Postgres ne sait pas retirer une valeur d'enum. Un rollback exigerait de
-- recréer le type et de réécrire toutes les colonnes qui l'utilisent
-- (payments.rail, refunds.refund_rail). À ne faire qu'en connaissance de cause.
```

- [ ] **Step 2 : Écrire la migration 114**

Créer `supabase/migrations/114_paypal_rail_support.sql` :

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 114 : support du rail PAYPAL (index, autorisation, feature flag)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Dépend de la migration 113 (valeur d'enum 'PAYPAL'), appliquée dans une
-- transaction distincte — voir le commentaire de 113.

-- 1. Index UNIQUE partiel sur l'identifiant d'ordre PayPal.
--
-- Double rôle :
--   - lookup rapide depuis la route de retour, le webhook et le cron
--     (external_reference = paypal order id) ;
--   - garde d'idempotence en dernier ressort : deux lignes payments pour le
--     même ordre PayPal sont impossibles au niveau DB.
--
-- Plus strict que idx_payments_stripe_pi (mig 063), non-unique : côté Stripe
-- l'unicité n'avait pas été posée. Même politique que mig 087 pour les rails
-- MOBILE_MONEY / THIRD_PARTY.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_paypal_order
    ON public.payments (external_reference)
    WHERE rail = 'PAYPAL' AND external_reference IS NOT NULL;

COMMENT ON INDEX public.idx_payments_paypal_order IS
    'Rail PAYPAL : lookup par paypal order id + garde d''idempotence (une ligne par ordre).';

-- 2. can_confirm_payment (mig 057) : PAYPAL est confirmé par le système
--    (route de retour / webhook / cron), JAMAIS par un humain — comme WALLET et
--    STRIPE. Sans ça, un FINANCE_ADMIN pourrait confirmer à la main un paiement
--    PayPal jamais encaissé.
CREATE OR REPLACE FUNCTION public.can_confirm_payment(
  p_payment_id UUID,
  p_profile_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
  v_rail        public.payment_rail;
  v_status      public.payment_status_v7;
  v_declared_by UUID;
  v_role        public.user_role;
BEGIN
  SELECT rail, status, declared_by INTO v_rail, v_status, v_declared_by
    FROM public.payments WHERE id = p_payment_id;

  IF NOT FOUND OR v_status NOT IN ('INITIATED', 'PROCESSING') THEN
    RETURN FALSE;
  END IF;

  SELECT role INTO v_role FROM public.profiles
    WHERE id = p_profile_id AND is_active = true;

  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;

  -- WALLET, STRIPE et PAYPAL sont confirmés par le système, jamais par un humain
  IF v_rail IN ('WALLET', 'STRIPE', 'PAYPAL') THEN
    RETURN FALSE;
  END IF;

  -- NETTING et BANK_GUARANTEE exigent SUPERADMIN
  IF v_rail IN ('NETTING', 'BANK_GUARANTEE') THEN
    RETURN v_role = 'SUPERADMIN';
  END IF;

  -- CASH exige 4 yeux : FINANCE_ADMIN/SUPERADMIN ET ≠ déclarant
  IF v_rail = 'CASH' THEN
    RETURN v_role IN ('FINANCE_ADMIN', 'SUPERADMIN')
       AND v_declared_by IS DISTINCT FROM p_profile_id;
  END IF;

  -- Rails par défaut (WIRE_TRANSFER, MOBILE_MONEY, CHEQUE, LC, THIRD_PARTY) :
  -- FINANCE_ADMIN ou SUPERADMIN
  RETURN v_role IN ('FINANCE_ADMIN', 'SUPERADMIN');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.can_confirm_payment(UUID, UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_confirm_payment(UUID, UUID) IS
  'Plan 7C : matrice d''autorisation spec §7.2. Mig 114 ajoute PAYPAL aux rails système.';

-- 3. Feature flag, OFF par défaut : la bascule est un geste explicite au
--    déploiement, après vérification des credentials et du webhook.
INSERT INTO public.app_config (key, value)
VALUES ('feature.online_payment_paypal_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- DOWN :
-- DROP INDEX IF EXISTS public.idx_payments_paypal_order;
-- DELETE FROM public.app_config WHERE key = 'feature.online_payment_paypal_enabled';
-- (restaurer can_confirm_payment depuis la migration 057)
```

**Avant d'écrire ce fichier**, vérifier la forme réelle de `app_config` :

```bash
cd /c/Users/lecle/Workspace/africgreen && grep -rn "app_config" supabase/migrations/*.sql | grep -i "insert\|create table" | head
```

Si `value` n'est pas `jsonb`, ou si la table porte d'autres colonnes `NOT NULL` (ex. `description`, `updated_at`), adapter l'`INSERT` en conséquence — et refléter la forme réelle dans le test du Step 4.

- [ ] **Step 3 : Écrire le test de la migration 113**

Créer `supabase/tests/migrations/113_payment_rail_paypal.test.sql` :

```sql
BEGIN;

-- 1. La valeur d'enum PAYPAL existe
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'payment_rail' AND e.enumlabel = 'PAYPAL';
  ASSERT n = 1, format('expected enum label PAYPAL on payment_rail, found %s', n);
END $$;

-- 2. Les rails préexistants sont intacts (aucune valeur perdue)
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['STRIPE','WIRE_TRANSFER','CASH','CHEQUE','LETTER_OF_CREDIT',
                           'NETTING','THIRD_PARTY','MOBILE_MONEY','BANK_GUARANTEE','WALLET']
  LOOP
    ASSERT EXISTS (
      SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'payment_rail' AND e.enumlabel = r
    ), format('enum label %s missing from payment_rail', r);
  END LOOP;
END $$;

ROLLBACK;
```

- [ ] **Step 4 : Écrire le test de la migration 114**

Créer `supabase/tests/migrations/114_paypal_rail_support.test.sql` :

```sql
BEGIN;

-- 1. L'index unique partiel existe
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_payments_paypal_order';
  ASSERT n = 1, format('expected idx_payments_paypal_order, found %s', n);
END $$;

-- 2. Il est UNIQUE et restreint à rail='PAYPAL'
DO $$
DECLARE def TEXT;
BEGIN
  SELECT indexdef INTO def FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_payments_paypal_order';
  ASSERT def LIKE 'CREATE UNIQUE INDEX%', format('expected a UNIQUE index, got: %s', def);
  ASSERT def LIKE '%WHERE %rail%PAYPAL%', format('expected partial index on rail=PAYPAL, got: %s', def);
END $$;

-- 3. can_confirm_payment refuse la confirmation humaine d'un paiement PAYPAL.
--    On monte un jeu de données minimal : un profil FINANCE_ADMIN actif et une
--    ligne payments PAYPAL en PROCESSING sur un shipowner existant.
DO $$
DECLARE
  v_admin      UUID;
  v_shipowner  UUID;
  v_payment    UUID;
BEGIN
  SELECT id INTO v_admin FROM public.profiles
    WHERE is_active = true AND role IN ('FINANCE_ADMIN','SUPERADMIN') LIMIT 1;
  SELECT id INTO v_shipowner FROM public.shipowners LIMIT 1;

  IF v_admin IS NULL OR v_shipowner IS NULL THEN
    RAISE NOTICE 'skipping can_confirm_payment assertion: no seed profile/shipowner';
    RETURN;
  END IF;

  INSERT INTO public.payments
      (shipowner_id, amount_minor, currency, amount_usd_minor, rail, status, external_reference)
  VALUES
      (v_shipowner, 100000, 'USD', 100000, 'PAYPAL', 'PROCESSING', 'ORDER-TEST-114')
  RETURNING id INTO v_payment;

  ASSERT public.can_confirm_payment(v_payment, v_admin) = FALSE,
    'can_confirm_payment must return FALSE for a PAYPAL payment (system-confirmed rail)';
END $$;

-- 4. L'index interdit deux lignes pour le même ordre PayPal
DO $$
DECLARE
  v_shipowner UUID;
  v_dup       BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_shipowner FROM public.shipowners LIMIT 1;
  IF v_shipowner IS NULL THEN
    RAISE NOTICE 'skipping uniqueness assertion: no seed shipowner';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.payments
        (shipowner_id, amount_minor, currency, amount_usd_minor, rail, status, external_reference)
    VALUES
        (v_shipowner, 100000, 'USD', 100000, 'PAYPAL', 'PROCESSING', 'ORDER-TEST-114');
  EXCEPTION WHEN unique_violation THEN
    v_dup := TRUE;
  END;

  ASSERT v_dup, 'expected unique_violation on duplicate PAYPAL external_reference';
END $$;

-- 5. La clé de feature flag est semée, à false
DO $$
DECLARE v JSONB;
BEGIN
  SELECT value INTO v FROM public.app_config
    WHERE key = 'feature.online_payment_paypal_enabled';
  ASSERT v IS NOT NULL, 'feature.online_payment_paypal_enabled not seeded';
  ASSERT v = 'false'::jsonb, format('expected flag false at install, got %s', v);
END $$;

ROLLBACK;
```

- [ ] **Step 5 : Appliquer et exécuter les tests SQL**

Appliquer les deux migrations sur l'environnement de dev (dans l'ordre, **transactions séparées** — c'est tout l'objet du découpage), puis exécuter les deux fichiers de test.

```bash
cd /c/Users/lecle/Workspace/africgreen
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/113_payment_rail_paypal.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/114_paypal_rail_support.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/migrations/113_payment_rail_paypal.test.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/migrations/114_paypal_rail_support.test.sql
```

Attendu : `ROLLBACK` sans `ASSERT` en échec.

Si la stack Supabase locale n'est pas démarrable (gotcha connu : conflits de ports), le noter et poursuivre — les tests SQL sont alors à rejouer au moment de l'application sur l'environnement hébergé. **Ne pas** supprimer les tests, **ne pas** prétendre qu'ils sont passés.

- [ ] **Step 6 : Étendre le type TS `PaymentRail`**

Dans `frontend/src/services/paymentService.ts`, remplacer le bloc du type `PaymentRail` (autour de la ligne 528) :

```ts
export type PaymentRail =
  | 'STRIPE'
  | 'PAYPAL'
  | 'WIRE_TRANSFER'
  | 'CASH'
  | 'CHEQUE'
  | 'LETTER_OF_CREDIT'
  | 'NETTING'
  | 'THIRD_PARTY'
  | 'MOBILE_MONEY'
  | 'BANK_GUARANTEE'
  | 'WALLET';
```

Ne rien changer d'autre dans ce fichier : le type `PaymentProvider` (chemin legacy) ne gagne **pas** `'paypal'`.

- [ ] **Step 7 : Vérifier que la suite existante passe**

```bash
cd frontend && npx tsc --noEmit && npm test
```

Attendu : typecheck propre, suite verte. L'élargissement d'une union peut faire apparaître des `switch` non exhaustifs — les corriger dans le fichier concerné plutôt que d'affaiblir le type.

- [ ] **Step 8 : Commit**

```bash
cd /c/Users/lecle/Workspace/africgreen
git add supabase/migrations/113_payment_rail_paypal.sql \
        supabase/migrations/114_paypal_rail_support.sql \
        supabase/tests/migrations/113_payment_rail_paypal.test.sql \
        supabase/tests/migrations/114_paypal_rail_support.test.sql \
        frontend/src/services/paymentService.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" \
  -m "feat(payments): rail PAYPAL en base (enum, index unique, garde de confirmation)"
```

---

## Task 3 : Extraire les effets post-confirmation (partagés Stripe/PayPal)

**Files:**
- Create: `frontend/src/services/paymentConfirmationEffects.ts`
- Test: `frontend/src/services/paymentConfirmationEffects.test.ts`
- Modify: `frontend/src/app/api/webhooks/stripe/route.ts:210-303` (remplacer le bloc inline par un appel)

**Interfaces:**
- Consumes: rien (refactor pur).
- Produces:
  ```ts
  export interface ConfirmedPaymentContext {
      id: string;
      shipowner_id: string;
      transaction_id: string | null;
      amount_usd_minor: number;
  }
  export function applyPaymentConfirmationEffects(
      admin: SupabaseClient,
      payment: ConfirmedPaymentContext,
      confirmedAt: string,
  ): Promise<void>   // fail-soft, ne throw jamais
  ```

**Pourquoi cette tâche existe :** le webhook Stripe porte ~90 lignes de « reçu PDF + e-mail +
notification in-app » inlinées. PayPal a besoin des mêmes. Sans extraction, on duplique.
L'extraction doit être **à iso-comportement pour Stripe** : c'est le critère d'acceptation.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/services/paymentConfirmationEffects.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const generateReceiptMock = vi.fn();
const sendConfirmationMock = vi.fn();
const notifyOwnerMock = vi.fn();

vi.mock('@/services/receiptService', () => ({
    generatePaymentReceipt: (...a: unknown[]) => generateReceiptMock(...a),
}));
vi.mock('@/services/emailService', () => ({
    sendPaymentConfirmationEmail: (...a: unknown[]) => sendConfirmationMock(...a),
}));
vi.mock('@/services/notificationService', () => ({
    notifyOwner: (...a: unknown[]) => notifyOwnerMock(...a),
}));

import { applyPaymentConfirmationEffects } from './paymentConfirmationEffects';

// Faux client Supabase : renvoie shipowner / transaction / wallet scriptables.
let ownerRow: Record<string, unknown> | null;
let txRow: Record<string, unknown> | null;
let walletRow: Record<string, unknown> | null;

function fakeAdmin(): SupabaseClient {
    const single = (row: Record<string, unknown> | null) => ({
        data: row, error: row ? null : { message: 'not found' },
    });
    return {
        from: (table: string) => ({
            select: () => ({
                eq: () => ({
                    single: async () =>
                        single(table === 'shipowners' ? ownerRow : table === 'transactions' ? txRow : null),
                    maybeSingle: async () => single(table === 'wallets' ? walletRow : null),
                }),
            }),
        }),
    } as unknown as SupabaseClient;
}

const CONFIRMED_AT = '2026-07-30T10:00:00.000Z';

beforeEach(() => {
    generateReceiptMock.mockReset();
    sendConfirmationMock.mockReset();
    notifyOwnerMock.mockReset();
    generateReceiptMock.mockResolvedValue({
        receiptRef: 'RCPT-1', pdfBuffer: new Uint8Array([1, 2, 3]),
    });
    sendConfirmationMock.mockResolvedValue(undefined);
    notifyOwnerMock.mockResolvedValue(undefined);
    ownerRow = { name: 'Demo Shipping', official_email: 'owner@example.com' };
    txRow = { invoice_ref: 'INV-2026-abc', vessel_name: 'MV Test' };
    walletRow = { balance_usd_minor: 500000 };
});

const INVOICE_PAYMENT = {
    id: 'pay-1', shipowner_id: 'so-1', transaction_id: 'tx-1', amount_usd_minor: 125000,
};
const TOPUP_PAYMENT = {
    id: 'pay-2', shipowner_id: 'so-1', transaction_id: null, amount_usd_minor: 50000,
};

describe('applyPaymentConfirmationEffects — paiement de facture', () => {
    it('genere le recu, envoie l e-mail de confirmation, notifie PAYMENT_RECEIVED', async () => {
        await applyPaymentConfirmationEffects(fakeAdmin(), INVOICE_PAYMENT, CONFIRMED_AT);

        expect(generateReceiptMock).toHaveBeenCalledOnce();
        expect(generateReceiptMock.mock.calls[0][1]).toBe('pay-1');

        expect(sendConfirmationMock).toHaveBeenCalledOnce();
        const email = sendConfirmationMock.mock.calls[0][0];
        expect(email.to).toBe('owner@example.com');
        expect(email.invoiceRef).toBe('INV-2026-abc');
        expect(email.vesselName).toBe('MV Test');
        expect(email.amountUsd).toBe(1250);
        expect(email.receiptRef).toBe('RCPT-1');

        expect(notifyOwnerMock).toHaveBeenCalledOnce();
        const notif = notifyOwnerMock.mock.calls[0][1];
        expect(notif.kind).toBe('PAYMENT_RECEIVED');
        expect(notif.skipEmail).toBe(true);          // l'e-mail est deja parti ci-dessus
        expect(notif.attachments.filename).toBe('RCPT-1.pdf');
        expect(notif.deepLink).toContain('INV-2026-abc');
    });

    it('n envoie pas d e-mail si l armateur n a pas d adresse officielle', async () => {
        ownerRow = { name: 'Demo Shipping', official_email: null };
        await applyPaymentConfirmationEffects(fakeAdmin(), INVOICE_PAYMENT, CONFIRMED_AT);
        expect(sendConfirmationMock).not.toHaveBeenCalled();
        expect(notifyOwnerMock).toHaveBeenCalledOnce();   // la notif in-app part quand meme
    });
});

describe('applyPaymentConfirmationEffects — top-up wallet', () => {
    it('notifie WALLET_TOPPED_UP avec le nouveau solde et ne force pas skipEmail', async () => {
        await applyPaymentConfirmationEffects(fakeAdmin(), TOPUP_PAYMENT, CONFIRMED_AT);

        const notif = notifyOwnerMock.mock.calls[0][1];
        expect(notif.kind).toBe('WALLET_TOPPED_UP');
        expect(notif.params.amount_usd).toBe(500);
        expect(notif.params.new_balance_usd).toBe(5000);
        expect(notif.deepLink).toBe('/owner/wallet');
        expect(notif.skipEmail).toBeUndefined();
    });
});

describe('applyPaymentConfirmationEffects — fail-soft', () => {
    it('ne throw pas si la generation du recu echoue, et notifie quand meme', async () => {
        generateReceiptMock.mockRejectedValue(new Error('pdf boom'));
        await expect(
            applyPaymentConfirmationEffects(fakeAdmin(), INVOICE_PAYMENT, CONFIRMED_AT),
        ).resolves.toBeUndefined();
        expect(notifyOwnerMock).toHaveBeenCalledOnce();
    });

    it('ne throw pas si la notification echoue', async () => {
        notifyOwnerMock.mockRejectedValue(new Error('notify boom'));
        await expect(
            applyPaymentConfirmationEffects(fakeAdmin(), INVOICE_PAYMENT, CONFIRMED_AT),
        ).resolves.toBeUndefined();
    });
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

```bash
cd frontend && npx vitest run src/services/paymentConfirmationEffects.test.ts
```

Attendu : ÉCHEC — module introuvable.

- [ ] **Step 3 : Écrire le module extrait**

Créer `frontend/src/services/paymentConfirmationEffects.ts`. Le corps est le déplacement
**littéral** des deux blocs `try` du webhook Stripe (`route.ts` L210-303), avec les imports
dynamiques conservés :

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { scopedLogger } from '@/lib/logger';

/**
 * Effets de bord déclenchés après qu'un paiement en ligne passe à CONFIRMED :
 * reçu PDF, e-mail de confirmation, notification in-app.
 *
 * Extrait du webhook Stripe (Plan 7C-4 / 7F) pour être partagé avec le rail
 * PAYPAL. Comportement identique — même ordre, mêmes imports dynamiques, même
 * politique fail-soft.
 *
 * FAIL-SOFT : cette fonction ne throw jamais. Un paiement CONFIRMED le reste
 * même si le reçu ou l'e-mail échoue ; l'échec est logué. Le paiement est la
 * vérité comptable, la notification n'est qu'un service rendu.
 *
 * APPEL UNIQUE : l'appelant doit l'invoquer seulement après avoir *gagné* la
 * transition vers CONFIRMED (UPDATE gardé par `.eq('status', …)` renvoyant une
 * ligne). Sinon on émettrait plusieurs reçus pour un même paiement.
 *
 * Les imports de receiptService / emailService / notificationService restent
 * dynamiques : ils tirent jspdf et le client Resend, inutiles sur les chemins
 * qui n'atteignent pas la confirmation.
 */

const log = scopedLogger('payment-confirmation-effects');

export interface ConfirmedPaymentContext {
    id: string;
    shipowner_id: string;
    /** null = top-up wallet (pas de facture rattachée). */
    transaction_id: string | null;
    amount_usd_minor: number;
}

export async function applyPaymentConfirmationEffects(
    admin: SupabaseClient,
    payment: ConfirmedPaymentContext,
    confirmedAt: string,
): Promise<void> {
    let receiptRefForNotif: string | undefined;
    let receiptBufferForNotif: Uint8Array | undefined;
    let txForNotif: { invoice_ref: string | null; vessel_name: string | null } | null = null;

    try {
        const { generatePaymentReceipt } = await import('@/services/receiptService');
        const receipt = await generatePaymentReceipt(admin, payment.id);
        receiptRefForNotif = receipt.receiptRef;
        receiptBufferForNotif = receipt.pdfBuffer;

        const { sendPaymentConfirmationEmail } = await import('@/services/emailService');

        const { data: owner } = await admin
            .from('shipowners')
            .select('name, official_email')
            .eq('id', payment.shipowner_id)
            .single();

        const { data: tx } = payment.transaction_id
            ? await admin
                .from('transactions')
                .select('invoice_ref, vessel_name')
                .eq('id', payment.transaction_id)
                .single()
            : { data: null as { invoice_ref: string | null; vessel_name: string | null } | null };
        txForNotif = tx
            ? {
                invoice_ref: tx.invoice_ref as string | null,
                vessel_name: tx.vessel_name as string | null,
            }
            : null;

        const ownerEmail = (owner as { official_email?: string } | null)?.official_email;
        if (ownerEmail) {
            await sendPaymentConfirmationEmail({
                to: ownerEmail,
                recipientName: ((owner as { name?: string } | null)?.name) ?? 'Shipowner',
                vesselName: (tx?.vessel_name as string | null) ?? '—',
                invoiceRef: (tx?.invoice_ref as string | null) ?? '—',
                amountUsd: (payment.amount_usd_minor ?? 0) / 100,
                paidAt: new Date(confirmedAt).toLocaleString('en-US', {
                    dateStyle: 'long',
                    timeStyle: 'short',
                }),
                receiptRef: receipt.receiptRef,
                receiptPdfBuffer: receipt.pdfBuffer,
            });
        }
    } catch (e) {
        log.warn('receipt_email_failed', {
            paymentId: payment.id,
            error: e instanceof Error ? e.message : String(e),
        });
    }

    // Notification in-app. Pour une facture, l'e-mail est déjà parti ci-dessus
    // (skipEmail). Pour un top-up, notifyOwner envoie son propre e-mail.
    try {
        const { notifyOwner } = await import('@/services/notificationService');
        const isTopup = payment.transaction_id === null;
        if (isTopup) {
            const { data: wallet } = await admin
                .from('wallets')
                .select('balance_usd_minor')
                .eq('shipowner_id', payment.shipowner_id)
                .maybeSingle();
            await notifyOwner(admin, {
                shipownerId: payment.shipowner_id,
                kind: 'WALLET_TOPPED_UP',
                params: {
                    amount_usd: (payment.amount_usd_minor ?? 0) / 100,
                    new_balance_usd: ((wallet?.balance_usd_minor as number | undefined) ?? 0) / 100,
                },
                deepLink: '/owner/wallet',
            });
        } else {
            await notifyOwner(admin, {
                shipownerId: payment.shipowner_id,
                kind: 'PAYMENT_RECEIVED',
                params: {
                    vessel_name: txForNotif?.vessel_name ?? '—',
                    invoice_ref: txForNotif?.invoice_ref ?? '—',
                    amount_usd: (payment.amount_usd_minor ?? 0) / 100,
                    paid_at: confirmedAt,
                    receipt_ref: receiptRefForNotif,
                },
                deepLink: `/owner/invoices?ref=${encodeURIComponent(txForNotif?.invoice_ref ?? '')}`,
                skipEmail: true,
                ...(receiptBufferForNotif
                    ? {
                        attachments: {
                            pdfBuffer: receiptBufferForNotif,
                            filename: `${receiptRefForNotif}.pdf`,
                        },
                    }
                    : {}),
            });
        }
    } catch (notifyErr) {
        log.warn('notification_dispatch_failed', {
            paymentId: payment.id,
            error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
        });
    }
}
```

**Une seule divergence assumée** vis-à-vis du code d'origine : `paidAt` est dérivé du paramètre
`confirmedAt` plutôt que de `new Date()`. Le webhook Stripe passait `new Date()` alors qu'il
avait déjà un `confirmedAt` — l'écart était de quelques millisecondes et la nouvelle forme est
testable. Le `deepLink` conserve `/owner/invoices` (redirigé en 301) pour rester identique aux
notifications déjà en base.

- [ ] **Step 4 : Lancer le test, vérifier qu'il passe**

```bash
cd frontend && npx vitest run src/services/paymentConfirmationEffects.test.ts
```

Attendu : PASS, 5 tests.

- [ ] **Step 5 : Brancher le webhook Stripe sur le module extrait**

Dans `frontend/src/app/api/webhooks/stripe/route.ts` :

1. Ajouter l'import en tête de fichier, après les imports existants :

```ts
import { applyPaymentConfirmationEffects } from '@/services/paymentConfirmationEffects';
```

2. Dans `handlePaymentSucceeded`, **supprimer** tout ce qui suit le
   `log.info('webhook_payment_succeeded', …)` — c'est-à-dire les deux blocs `try` (commentaires
   « Plan 7C-4 receipt + email hook » et « Plan 7F: in-app notification » inclus) ainsi que les
   déclarations `receiptRefForNotif`, `receiptBufferForNotif` et `txForNotif` — et le remplacer
   par :

```ts
    await applyPaymentConfirmationEffects(
        admin,
        {
            id: payment.id,
            shipowner_id: payment.shipowner_id,
            transaction_id: payment.transaction_id,
            amount_usd_minor: payment.amount_usd_minor,
        },
        confirmedAt,
    );
}
```

3. Retirer du commentaire d'en-tête du fichier la mention « trigger Plan 7C-4 receipt + email
   hook », devenue trompeuse, et la remplacer par « puis délègue les effets à
   `paymentConfirmationEffects` ».

- [ ] **Step 6 : Vérifier la non-régression Stripe**

```bash
cd frontend && npx vitest run src/app/api/webhooks/stripe && npx tsc --noEmit
```

Attendu : la suite Stripe existante passe **sans modification**. C'est le critère d'acceptation
du refactor. Si un test échoue, c'est que l'extraction n'est pas iso-comportement — corriger le
module, **pas** le test.

- [ ] **Step 7 : Lancer la suite complète**

```bash
cd frontend && npm test
```

Attendu : verte.

- [ ] **Step 8 : Commit**

```bash
cd /c/Users/lecle/Workspace/africgreen
git add frontend/src/services/paymentConfirmationEffects.ts \
        frontend/src/services/paymentConfirmationEffects.test.ts \
        frontend/src/app/api/webhooks/stripe/route.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" \
  -m "refactor(payments): extraire les effets post-confirmation du webhook Stripe"
```

---

## Task 4 : `confirmPaypalPayment` — unique écrivain du rail PAYPAL

**Files:**
- Create: `frontend/src/services/paypalConfirmation.ts`
- Test: `frontend/src/services/paypalConfirmation.test.ts`

**Interfaces:**
- Consumes: `applyPaymentConfirmationEffects` (Task 3) ; type `PaymentRail` (Task 2) ;
  `resolveSystemActor` de `@/lib/system-actor` ; `writeAuditLog` de `@/services/auditService`.
- Produces:
  ```ts
  export type PaypalConfirmOutcome =
      | 'CONFIRMED' | 'IDEMPOTENT_SKIP' | 'NOT_FOUND'
      | 'REJECTED_AMOUNT_MISMATCH' | 'ERROR';

  export interface PaypalConfirmInput {
      orderId: string;
      captureId: string | null;
      paidAmount: string | null;     // unités majeures, tel que renvoyé par PayPal
      paidCurrency: string | null;
      payerEmail?: string | null;
  }

  export function confirmPaypalPayment(
      admin: SupabaseClient, input: PaypalConfirmInput,
  ): Promise<{ outcome: PaypalConfirmOutcome; paymentId?: string }>

  export function rejectPaypalPayment(
      admin: SupabaseClient, orderId: string, reason: string,
  ): Promise<{ outcome: 'REJECTED' | 'IDEMPOTENT_SKIP' | 'NOT_FOUND' | 'ERROR' }>

  export function cancelPaypalPayment(
      admin: SupabaseClient, orderId: string, reason?: string,
  ): Promise<{ outcome: 'CANCELLED' | 'IDEMPOTENT_SKIP' | 'NOT_FOUND' | 'ERROR' }>
  ```

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/services/paypalConfirmation.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const effectsMock = vi.fn();
const auditMock = vi.fn();
const systemActorMock = vi.fn();

vi.mock('@/services/paymentConfirmationEffects', () => ({
    applyPaymentConfirmationEffects: (...a: unknown[]) => effectsMock(...a),
}));
vi.mock('@/services/auditService', () => ({
    writeAuditLog: (...a: unknown[]) => auditMock(...a),
}));
vi.mock('@/lib/system-actor', () => ({
    resolveSystemActor: (...a: unknown[]) => systemActorMock(...a),
}));

import {
    confirmPaypalPayment, rejectPaypalPayment, cancelPaypalPayment,
} from './paypalConfirmation';

// ── Faux client Supabase ────────────────────────────────────────────────────
// Scriptable : la ligne payments trouvée, le nombre de lignes que l'UPDATE
// gardé renvoie, et les erreurs éventuelles.
interface Harness {
    paymentRow: Record<string, unknown> | null;
    updateReturnsRows: boolean;      // false = course perdue
    updateError: { message: string } | null;
    rpcCalls: { fn: string; args: Record<string, unknown> }[];
    updatePayloads: Record<string, unknown>[];
    selectFilters: { col: string; val: unknown }[];
}

let h: Harness;

function fakeAdmin(): SupabaseClient {
    return {
        from: (table: string) => {
            if (table !== 'payments') throw new Error(`unexpected table ${table}`);
            return {
                select: () => {
                    const chain = {
                        eq: (col: string, val: unknown) => {
                            h.selectFilters.push({ col, val });
                            return chain;
                        },
                        maybeSingle: async () => ({ data: h.paymentRow, error: null }),
                    };
                    return chain;
                },
                update: (payload: Record<string, unknown>) => {
                    h.updatePayloads.push(payload);
                    const chain = {
                        eq: () => chain,
                        select: async () => ({
                            data: h.updateError ? null : (h.updateReturnsRows ? [{ id: 'pay-1' }] : []),
                            error: h.updateError,
                        }),
                    };
                    return chain;
                },
            };
        },
        rpc: async (fn: string, args: Record<string, unknown>) => {
            h.rpcCalls.push({ fn, args });
            return { data: null, error: null };
        },
    } as unknown as SupabaseClient;
}

const PROCESSING_ROW = {
    id: 'pay-1',
    status: 'PROCESSING',
    transaction_id: 'tx-1',
    shipowner_id: 'so-1',
    amount_usd_minor: 125000,       // $1250.00
    currency: 'USD',
    jurisdiction_id: 'jur-1',
    rail_details: { paypal_order_id: 'ORDER-1' },
};

const GOOD_INPUT = {
    orderId: 'ORDER-1',
    captureId: 'CAP-9',
    paidAmount: '1250.00',
    paidCurrency: 'USD',
    payerEmail: 'payer@example.com',
};

beforeEach(() => {
    effectsMock.mockReset().mockResolvedValue(undefined);
    auditMock.mockReset().mockResolvedValue(undefined);
    systemActorMock.mockReset().mockResolvedValue('sys-1');
    h = {
        paymentRow: { ...PROCESSING_ROW },
        updateReturnsRows: true,
        updateError: null,
        rpcCalls: [],
        updatePayloads: [],
        selectFilters: [],
    };
});

describe('confirmPaypalPayment — chemin nominal', () => {
    it('confirme, recalcule la transaction et déclenche les effets une fois', async () => {
        const out = await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);

        expect(out).toEqual({ outcome: 'CONFIRMED', paymentId: 'pay-1' });

        const upd = h.updatePayloads[0];
        expect(upd.status).toBe('CONFIRMED');
        expect(upd.confirmed_by).toBe('sys-1');
        expect(typeof upd.confirmed_at).toBe('string');
        const details = upd.rail_details as Record<string, unknown>;
        expect(details.paypal_order_id).toBe('ORDER-1');       // détails préexistants préservés
        expect(details.paypal_capture_id).toBe('CAP-9');
        expect(details.payer_email).toBe('payer@example.com');

        expect(h.rpcCalls).toEqual([
            { fn: 'recompute_transaction_status', args: { p_txn_id: 'tx-1' } },
        ]);
        expect(effectsMock).toHaveBeenCalledOnce();
    });

    it('cherche la ligne par external_reference ET rail=PAYPAL', async () => {
        await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
        expect(h.selectFilters).toEqual([
            { col: 'external_reference', val: 'ORDER-1' },
            { col: 'rail', val: 'PAYPAL' },
        ]);
    });

    it('ne recalcule pas la transaction pour un top-up (transaction_id null)', async () => {
        h.paymentRow = { ...PROCESSING_ROW, transaction_id: null };
        await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
        expect(h.rpcCalls).toEqual([]);
        expect(effectsMock).toHaveBeenCalledOnce();
    });
});

describe('confirmPaypalPayment — idempotence', () => {
    it('saute sans effet si la ligne est déjà CONFIRMED', async () => {
        h.paymentRow = { ...PROCESSING_ROW, status: 'CONFIRMED' };
        const out = await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
        expect(out.outcome).toBe('IDEMPOTENT_SKIP');
        expect(h.updatePayloads).toEqual([]);
        expect(effectsMock).not.toHaveBeenCalled();
    });

    it.each(['REJECTED', 'CANCELLED', 'REFUNDED'])(
        'saute sans effet si la ligne est %s',
        async (status) => {
            h.paymentRow = { ...PROCESSING_ROW, status };
            const out = await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
            expect(out.outcome).toBe('IDEMPOTENT_SKIP');
            expect(effectsMock).not.toHaveBeenCalled();
        },
    );

    it('course perdue (0 ligne mise à jour) → aucun effet, aucun reçu en double', async () => {
        h.updateReturnsRows = false;
        const out = await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
        expect(out.outcome).toBe('IDEMPOTENT_SKIP');
        expect(effectsMock).not.toHaveBeenCalled();
        expect(h.rpcCalls).toEqual([]);
    });

    it('ordre inconnu → NOT_FOUND, aucune écriture', async () => {
        h.paymentRow = null;
        const out = await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
        expect(out.outcome).toBe('NOT_FOUND');
        expect(h.updatePayloads).toEqual([]);
    });
});

describe('confirmPaypalPayment — contrôle du montant', () => {
    it('rejette une devise non USD', async () => {
        const out = await confirmPaypalPayment(fakeAdmin(), { ...GOOD_INPUT, paidCurrency: 'EUR' });
        expect(out.outcome).toBe('REJECTED_AMOUNT_MISMATCH');
        expect(h.updatePayloads[0].status).toBe('REJECTED');
        expect(effectsMock).not.toHaveBeenCalled();

        const audit = auditMock.mock.calls[0][1];
        expect(audit.severity).toBe('WARNING');
        expect(audit.details_json.event).toBe('PAYMENT_AMOUNT_MISMATCH');
        expect(audit.details_json.reason).toBe('non_usd_currency');
        expect(audit.jurisdiction_id).toBe('jur-1');
    });

    it('rejette un écart supérieur à un cent', async () => {
        const out = await confirmPaypalPayment(fakeAdmin(), { ...GOOD_INPUT, paidAmount: '1249.50' });
        expect(out.outcome).toBe('REJECTED_AMOUNT_MISMATCH');
        expect(auditMock.mock.calls[0][1].details_json.expected_usd).toBe(1250);
        expect(auditMock.mock.calls[0][1].details_json.received_usd).toBe(1249.5);
    });

    it('accepte un écart d’un cent exactement (tolérance)', async () => {
        const out = await confirmPaypalPayment(fakeAdmin(), { ...GOOD_INPUT, paidAmount: '1249.99' });
        expect(out.outcome).toBe('CONFIRMED');
    });

    it('rejette un montant illisible', async () => {
        const out = await confirmPaypalPayment(fakeAdmin(), { ...GOOD_INPUT, paidAmount: 'abc' });
        expect(out.outcome).toBe('REJECTED_AMOUNT_MISMATCH');
    });

    it('confirme quand PayPal ne renvoie pas de montant (capture connue par ailleurs)', async () => {
        const out = await confirmPaypalPayment(fakeAdmin(), {
            ...GOOD_INPUT, paidAmount: null, paidCurrency: null,
        });
        expect(out.outcome).toBe('CONFIRMED');
    });
});

describe('confirmPaypalPayment — erreurs', () => {
    it('ERROR si aucun acteur système n’est résolvable', async () => {
        systemActorMock.mockResolvedValue(null);
        const out = await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
        expect(out.outcome).toBe('ERROR');
        expect(h.updatePayloads).toEqual([]);
        expect(effectsMock).not.toHaveBeenCalled();
    });

    it('ERROR si l’UPDATE échoue', async () => {
        h.updateError = { message: 'db down' };
        const out = await confirmPaypalPayment(fakeAdmin(), GOOD_INPUT);
        expect(out.outcome).toBe('ERROR');
        expect(effectsMock).not.toHaveBeenCalled();
    });
});

describe('rejectPaypalPayment / cancelPaypalPayment', () => {
    it('rejette une ligne PROCESSING avec la raison préfixée PayPal', async () => {
        const out = await rejectPaypalPayment(fakeAdmin(), 'ORDER-1', 'INSTRUMENT_DECLINED');
        expect(out.outcome).toBe('REJECTED');
        expect(h.updatePayloads[0].status).toBe('REJECTED');
        expect(h.updatePayloads[0].rejected_reason).toBe('PayPal: INSTRUMENT_DECLINED');
    });

    it('annule une ligne PROCESSING', async () => {
        const out = await cancelPaypalPayment(fakeAdmin(), 'ORDER-1');
        expect(out.outcome).toBe('CANCELLED');
        expect(h.updatePayloads[0].status).toBe('CANCELLED');
    });

    it('ne touche pas une ligne déjà CONFIRMED', async () => {
        h.paymentRow = { ...PROCESSING_ROW, status: 'CONFIRMED' };
        expect((await cancelPaypalPayment(fakeAdmin(), 'ORDER-1')).outcome).toBe('IDEMPOTENT_SKIP');
        expect((await rejectPaypalPayment(fakeAdmin(), 'ORDER-1', 'x')).outcome).toBe('IDEMPOTENT_SKIP');
        expect(h.updatePayloads).toEqual([]);
    });
});
```

- [ ] **Step 2 : Lancer le test, vérifier qu'il échoue**

```bash
cd frontend && npx vitest run src/services/paypalConfirmation.test.ts
```

Attendu : ÉCHEC — module introuvable.

- [ ] **Step 3 : Écrire l'implémentation**

Créer `frontend/src/services/paypalConfirmation.ts` :

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveSystemActor } from '@/lib/system-actor';
import { writeAuditLog } from '@/services/auditService';
import { applyPaymentConfirmationEffects } from '@/services/paymentConfirmationEffects';
import { scopedLogger } from '@/lib/logger';

/**
 * paypalConfirmation — le SEUL module qui fait bouger une ligne `payments` du
 * rail PAYPAL.
 *
 * Trois chemins l'appellent : la route de retour navigateur, le webhook PayPal
 * et le cron de réconciliation. Concentrer l'écriture ici garantit une seule
 * définition de l'idempotence, du contrôle de montant et des effets de bord.
 *
 * IDEMPOTENCE — deux gardes superposées :
 *   1. les statuts terminaux sortent avant tout UPDATE ;
 *   2. l'UPDATE est conditionné par `.eq('status', 'PROCESSING')` et on lit le
 *      nombre de lignes renvoyées. Zéro ligne = un autre chemin a gagné la
 *      course → on sort sans effet de bord. C'est ce qui garantit qu'un reçu
 *      n'est jamais émis deux fois pour le même paiement.
 *
 * MONTANT — le montant crédité est toujours `payments.amount_usd_minor`, calculé
 * à l'initiation depuis la transaction. Le montant renvoyé par PayPal ne sert
 * qu'à contrôler : devise ≠ USD ou écart > 1 cent → REJECTED + audit WARNING.
 * On ne convertit jamais une devise sur un paiement fiscal.
 *
 * Le client Supabase est fourni par l'appelant : client tenant pour la route de
 * retour (juridiction connue via requireOwner), client plateforme pour le
 * webhook et le cron (aucun contexte tenant, lookup par identifiant PayPal).
 */

const log = scopedLogger('paypal-confirmation');

/** Tolérance de comparaison de montant, en USD. */
const AMOUNT_TOLERANCE_USD = 0.01;

const TERMINAL_STATUSES = new Set(['CONFIRMED', 'REJECTED', 'CANCELLED', 'REFUNDED']);

export type PaypalConfirmOutcome =
    | 'CONFIRMED'
    | 'IDEMPOTENT_SKIP'
    | 'NOT_FOUND'
    | 'REJECTED_AMOUNT_MISMATCH'
    | 'ERROR';

export interface PaypalConfirmInput {
    /** Identifiant d'ordre PayPal = payments.external_reference. */
    orderId: string;
    captureId: string | null;
    /** Montant capturé en unités majeures, tel que renvoyé par PayPal. */
    paidAmount: string | null;
    paidCurrency: string | null;
    payerEmail?: string | null;
}

interface PaypalPaymentRow {
    id: string;
    status: string;
    transaction_id: string | null;
    shipowner_id: string;
    amount_usd_minor: number;
    currency: string;
    jurisdiction_id: string | null;
    rail_details: Record<string, unknown> | null;
}

async function findPaypalPayment(
    admin: SupabaseClient,
    orderId: string,
): Promise<PaypalPaymentRow | null> {
    const { data } = await admin
        .from('payments')
        .select('id, status, transaction_id, shipowner_id, amount_usd_minor, currency, jurisdiction_id, rail_details')
        .eq('external_reference', orderId)
        .eq('rail', 'PAYPAL')
        .maybeSingle();
    return (data as PaypalPaymentRow | null) ?? null;
}

/**
 * Marque un paiement PayPal comme confirmé.
 *
 * @returns `CONFIRMED` si cet appel a effectivement opéré la transition (et donc
 * déclenché reçu + e-mail + notification), `IDEMPOTENT_SKIP` si un autre chemin
 * l'avait déjà fait, `NOT_FOUND` si l'ordre est inconnu,
 * `REJECTED_AMOUNT_MISMATCH` si le contrôle de montant a échoué (la ligne passe
 * alors en REJECTED), `ERROR` sinon. Ne throw pas.
 */
export async function confirmPaypalPayment(
    admin: SupabaseClient,
    input: PaypalConfirmInput,
): Promise<{ outcome: PaypalConfirmOutcome; paymentId?: string }> {
    try {
        const payment = await findPaypalPayment(admin, input.orderId);
        if (!payment) {
            log.warn('paypal_payment_not_found', { orderId: input.orderId });
            return { outcome: 'NOT_FOUND' };
        }
        if (TERMINAL_STATUSES.has(payment.status)) {
            log.info('paypal_idempotent_skip', {
                orderId: input.orderId,
                paymentId: payment.id,
                currentStatus: payment.status,
            });
            return { outcome: 'IDEMPOTENT_SKIP', paymentId: payment.id };
        }

        // ── Contrôle du montant ──────────────────────────────────────────────
        const expectedUsd = payment.amount_usd_minor / 100;
        const mismatch = amountMismatch(input, expectedUsd);
        if (mismatch) {
            await admin
                .from('payments')
                .update({
                    status: 'REJECTED',
                    rejected_reason: `PayPal: ${mismatch.reason}`,
                    rail_details: mergeRailDetails(payment, input),
                })
                .eq('id', payment.id)
                .eq('status', payment.status)
                .select('id');

            log.error('payment_amount_mismatch', {
                orderId: input.orderId,
                paymentId: payment.id,
                ...mismatch.logFields,
            });

            const systemActorId = await resolveSystemActor(admin);
            if (systemActorId) {
                await writeAuditLog(admin, {
                    user_id: systemActorId,
                    user_full_name: 'PayPal Webhook',
                    action: 'TRANSACTION_UPDATED',
                    severity: 'WARNING',
                    entity_type: 'Transaction',
                    entity_id: payment.transaction_id ?? payment.id,
                    jurisdiction_id: payment.jurisdiction_id,
                    details_json: {
                        event: 'PAYMENT_AMOUNT_MISMATCH',
                        provider: 'paypal',
                        provider_ref: input.captureId ?? input.orderId,
                        ...mismatch.auditFields,
                    },
                });
            }
            return { outcome: 'REJECTED_AMOUNT_MISMATCH', paymentId: payment.id };
        }

        // ── Acteur système (payments_confirmed_audit exige confirmed_by) ─────
        const systemActorId = await resolveSystemActor(admin);
        if (!systemActorId) {
            log.error('paypal_no_system_actor', {
                orderId: input.orderId,
                paymentId: payment.id,
            });
            return { outcome: 'ERROR', paymentId: payment.id };
        }

        // ── Transition gardée ────────────────────────────────────────────────
        const confirmedAt = new Date().toISOString();
        const { data: updated, error: updErr } = await admin
            .from('payments')
            .update({
                status: 'CONFIRMED',
                confirmed_at: confirmedAt,
                confirmed_by: systemActorId,
                rail_details: mergeRailDetails(payment, input),
            })
            .eq('id', payment.id)
            .eq('status', 'PROCESSING')
            .select('id');

        if (updErr) {
            log.error('paypal_confirm_update_failed', {
                orderId: input.orderId,
                paymentId: payment.id,
                error: updErr.message,
            });
            return { outcome: 'ERROR', paymentId: payment.id };
        }
        if (!updated || updated.length === 0) {
            // Course perdue entre la lecture et l'UPDATE. Aucun effet de bord :
            // le gagnant les a déjà déclenchés.
            log.info('paypal_confirm_race_idempotent', {
                orderId: input.orderId,
                paymentId: payment.id,
            });
            return { outcome: 'IDEMPOTENT_SKIP', paymentId: payment.id };
        }

        // ── Recalcul du statut de transaction ────────────────────────────────
        if (payment.transaction_id) {
            const { error: rpcErr } = await admin.rpc('recompute_transaction_status', {
                p_txn_id: payment.transaction_id,
            });
            if (rpcErr) {
                // Le trigger sur payments recalcule aussi — loguer sans échouer.
                log.error('recompute_transaction_status_failed', {
                    paymentId: payment.id,
                    transactionId: payment.transaction_id,
                    error: rpcErr.message,
                });
            }
        }

        log.info('paypal_payment_confirmed', {
            orderId: input.orderId,
            paymentId: payment.id,
            transactionId: payment.transaction_id,
            amountUsdMinor: payment.amount_usd_minor,
        });

        // Effets fail-soft — on a gagné la course, donc exactement une fois.
        await applyPaymentConfirmationEffects(
            admin,
            {
                id: payment.id,
                shipowner_id: payment.shipowner_id,
                transaction_id: payment.transaction_id,
                amount_usd_minor: payment.amount_usd_minor,
            },
            confirmedAt,
        );

        return { outcome: 'CONFIRMED', paymentId: payment.id };
    } catch (e) {
        log.error('paypal_confirm_unhandled_error', {
            orderId: input.orderId,
            error: e instanceof Error ? e.message : String(e),
        });
        return { outcome: 'ERROR' };
    }
}

function mergeRailDetails(
    payment: PaypalPaymentRow,
    input: PaypalConfirmInput,
): Record<string, unknown> {
    return {
        ...(payment.rail_details ?? {}),
        paypal_order_id: input.orderId,
        paypal_capture_id: input.captureId,
        payer_email: input.payerEmail ?? null,
    };
}

interface Mismatch {
    reason: string;
    logFields: Record<string, unknown>;
    auditFields: Record<string, unknown>;
}

/**
 * Contrôle devise + montant. `null` = pas d'écart (y compris quand PayPal ne
 * renvoie aucun montant : la capture est alors connue par un autre chemin et
 * `amount_usd_minor` reste la vérité).
 */
function amountMismatch(input: PaypalConfirmInput, expectedUsd: number): Mismatch | null {
    if (input.paidCurrency && input.paidCurrency !== 'USD') {
        return {
            reason: 'non_usd_currency',
            logFields: { reason: 'non_usd_currency', paidCurrency: input.paidCurrency },
            auditFields: {
                reason: 'non_usd_currency',
                paid_currency: input.paidCurrency,
                expected_currency: 'USD',
            },
        };
    }
    if (input.paidAmount == null) return null;

    const paid = parseFloat(input.paidAmount);
    if (Number.isNaN(paid)) {
        return {
            reason: 'unparseable_amount',
            logFields: { reason: 'unparseable_amount', paidAmount: input.paidAmount },
            auditFields: { reason: 'unparseable_amount', paid_amount: input.paidAmount },
        };
    }

    const diff = Math.abs(paid - expectedUsd);
    if (diff > AMOUNT_TOLERANCE_USD) {
        return {
            reason: `amount_mismatch expected=${expectedUsd} received=${paid}`,
            logFields: { expectedUsd, receivedUsd: paid, diffUsd: diff },
            auditFields: { expected_usd: expectedUsd, received_usd: paid, diff_usd: diff },
        };
    }
    return null;
}

/** Transition gardée partagée par reject / cancel. */
async function terminalTransition(
    admin: SupabaseClient,
    orderId: string,
    patch: Record<string, unknown>,
    logEvent: string,
): Promise<{ ok: boolean; skipped: boolean; notFound: boolean }> {
    const payment = await findPaypalPayment(admin, orderId);
    if (!payment) {
        log.warn('paypal_payment_not_found', { orderId });
        return { ok: false, skipped: false, notFound: true };
    }
    if (TERMINAL_STATUSES.has(payment.status)) {
        log.info('paypal_idempotent_skip', { orderId, paymentId: payment.id, currentStatus: payment.status });
        return { ok: false, skipped: true, notFound: false };
    }

    const { data: updated, error } = await admin
        .from('payments')
        .update(patch)
        .eq('id', payment.id)
        .eq('status', 'PROCESSING')
        .select('id');

    if (error) {
        log.error(`${logEvent}_failed`, { orderId, paymentId: payment.id, error: error.message });
        return { ok: false, skipped: false, notFound: false };
    }
    if (!updated || updated.length === 0) {
        return { ok: false, skipped: true, notFound: false };
    }
    log.info(logEvent, { orderId, paymentId: payment.id });
    return { ok: true, skipped: false, notFound: false };
}

/**
 * Passe un paiement PayPal en REJECTED (capture refusée par PayPal).
 * La raison est préfixée `PayPal:` — même convention que le webhook Stripe.
 * On logue la longueur de la raison, pas son texte (déjà persisté en base).
 */
export async function rejectPaypalPayment(
    admin: SupabaseClient,
    orderId: string,
    reason: string,
): Promise<{ outcome: 'REJECTED' | 'IDEMPOTENT_SKIP' | 'NOT_FOUND' | 'ERROR' }> {
    try {
        const r = await terminalTransition(
            admin,
            orderId,
            { status: 'REJECTED', rejected_reason: `PayPal: ${reason}` },
            'paypal_payment_rejected',
        );
        if (r.notFound) return { outcome: 'NOT_FOUND' };
        if (r.skipped) return { outcome: 'IDEMPOTENT_SKIP' };
        return { outcome: r.ok ? 'REJECTED' : 'ERROR' };
    } catch (e) {
        log.error('paypal_reject_unhandled_error', {
            orderId,
            error: e instanceof Error ? e.message : String(e),
        });
        return { outcome: 'ERROR' };
    }
}

/** Passe un paiement PayPal en CANCELLED (ordre annulé ou expiré). */
export async function cancelPaypalPayment(
    admin: SupabaseClient,
    orderId: string,
    reason?: string,
): Promise<{ outcome: 'CANCELLED' | 'IDEMPOTENT_SKIP' | 'NOT_FOUND' | 'ERROR' }> {
    try {
        const r = await terminalTransition(
            admin,
            orderId,
            {
                status: 'CANCELLED',
                ...(reason ? { rejected_reason: `PayPal: ${reason}` } : {}),
            },
            'paypal_payment_cancelled',
        );
        if (r.notFound) return { outcome: 'NOT_FOUND' };
        if (r.skipped) return { outcome: 'IDEMPOTENT_SKIP' };
        return { outcome: r.ok ? 'CANCELLED' : 'ERROR' };
    } catch (e) {
        log.error('paypal_cancel_unhandled_error', {
            orderId,
            error: e instanceof Error ? e.message : String(e),
        });
        return { outcome: 'ERROR' };
    }
}
```

- [ ] **Step 4 : Lancer le test, vérifier qu'il passe**

```bash
cd frontend && npx vitest run src/services/paypalConfirmation.test.ts
```

Attendu : PASS (19 tests avec les `it.each`).

Vérifier au passage la signature réelle de `writeAuditLog` :

```bash
cd frontend && grep -n "export async function writeAuditLog" -A 20 src/services/auditService.ts
```

Si le second paramètre n'accepte pas exactement les champs utilisés ici, aligner l'appel sur la
signature réelle (et le test avec). **Ne pas** inventer de champ d'audit.

- [ ] **Step 5 : Typecheck et lint**

```bash
cd frontend && npx tsc --noEmit && npm run lint
```

- [ ] **Step 6 : Commit**

```bash
cd /c/Users/lecle/Workspace/africgreen
git add frontend/src/services/paypalConfirmation.ts \
        frontend/src/services/paypalConfirmation.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" \
  -m "feat(payments): confirmation idempotente des paiements PayPal

Transition gardée par une condition de course : les effets (reçu, e-mail,
notification) ne partent qu'une fois, quel que soit le chemin qui gagne."
```

---

## Task 5 : Feature flag + éligibilité du rail

**Files:**
- Modify: `frontend/src/lib/feature-flags.ts`
- Modify: `frontend/src/app/api/owner/payment-availability/route.ts:6,46-61`
- Test: `frontend/src/lib/__tests__/feature-flags.test.ts` (ou le chemin existant — voir Step 1)
- Test: `frontend/src/app/api/owner/payment-availability/route.test.ts` (existant, à étendre)

**Interfaces:**
- Consumes: `paypalConfigured()` de Task 1.
- Produces: `PortalFeatureFlags.onlinePaypalEnabled: boolean` ; le rail `PAYPAL` dans la réponse
  de `GET /api/owner/payment-availability`.

- [ ] **Step 1 : Localiser les tests existants**

```bash
cd frontend && ls src/lib/__tests__/ | grep -i flag ; ls src/app/api/owner/payment-availability/
```

Étendre les fichiers existants plutôt que d'en créer de nouveaux. S'il n'y a pas de test de
feature-flags, le créer en `src/lib/__tests__/feature-flags.test.ts`.

- [ ] **Step 2 : Écrire les tests qui échouent**

Ajouter au test de feature-flags (en adaptant les mocks au style du fichier existant) :

```ts
it('expose onlinePaypalEnabled, à false quand la clé est absente', async () => {
    // app_config ne renvoie aucune ligne
    const flags = await _readPortalFeatureFlagsImpl();
    expect(flags.onlinePaypalEnabled).toBe(false);
});

it('lit feature.online_payment_paypal_enabled', async () => {
    // app_config renvoie [{ key: 'feature.online_payment_paypal_enabled', value: true }]
    const flags = await _readPortalFeatureFlagsImpl();
    expect(flags.onlinePaypalEnabled).toBe(true);
});
```

Ajouter à `src/app/api/owner/payment-availability/route.test.ts` :

```ts
it('PAYPAL éligible quand les credentials et le flag sont présents', async () => {
    process.env.PAYPAL_CLIENT_ID = 'cid';
    process.env.PAYPAL_CLIENT_SECRET = 'csecret';
    // flags mockés avec onlinePaypalEnabled: true
    const res = await GET(makeRequest());
    const body = await res.json();
    const paypal = body.rails.find((r: { rail: string }) => r.rail === 'PAYPAL');
    expect(paypal.eligible).toBe(true);
    expect(paypal.providers).toEqual([
        { provider: 'paypal', routes_rail: ['PAYPAL'], display_order: 0 },
    ]);
});

it('PAYPAL inéligible quand le flag est off, même avec les credentials', async () => {
    process.env.PAYPAL_CLIENT_ID = 'cid';
    process.env.PAYPAL_CLIENT_SECRET = 'csecret';
    // flags mockés avec onlinePaypalEnabled: false
    const res = await GET(makeRequest());
    const paypal = (await res.json()).rails.find((r: { rail: string }) => r.rail === 'PAYPAL');
    expect(paypal.eligible).toBe(false);
    expect(paypal.reason).toBe('no_active_provider');
});

it('PAYPAL inéligible quand les credentials manquent, même avec le flag on', async () => {
    delete process.env.PAYPAL_CLIENT_SECRET;
    // flags mockés avec onlinePaypalEnabled: true
    const res = await GET(makeRequest());
    const paypal = (await res.json()).rails.find((r: { rail: string }) => r.rail === 'PAYPAL');
    expect(paypal.eligible).toBe(false);
});

it('ne consulte pas payment_config pour PAYPAL', async () => {
    // selectProvidersForRail mocké : asserter qu'il n'est jamais appelé avec 'PAYPAL'
    await GET(makeRequest());
    expect(selectProvidersForRailMock).not.toHaveBeenCalledWith(expect.anything(), 'PAYPAL');
});
```

Adapter `makeRequest()` et le mock des flags au style du fichier existant (le lire d'abord).
Restaurer les variables d'environnement en `afterEach`.

- [ ] **Step 3 : Lancer, vérifier l'échec**

```bash
cd frontend && npx vitest run src/lib/__tests__/feature-flags.test.ts src/app/api/owner/payment-availability
```

Attendu : ÉCHEC (`onlinePaypalEnabled` inexistant, rail PAYPAL absent de la réponse).

- [ ] **Step 4 : Ajouter le 7ᵉ flag**

Dans `frontend/src/lib/feature-flags.ts`, trois modifications strictement parallèles aux six
flags existants :

```ts
export interface PortalFeatureFlags {
    portalV1Enabled: boolean;
    selfServiceEnabled: boolean;
    onlinePaymentStripeEnabled: boolean;
    onlinePaypalEnabled: boolean;
    walletTopupEnabled: boolean;
    notificationSmsEnabled: boolean;
    airSelfServiceEnabled: boolean;
}
```

```ts
const FLAG_KEYS: Record<keyof PortalFeatureFlags, string> = {
    portalV1Enabled: 'feature.shipowner_portal_v1_enabled',
    selfServiceEnabled: 'feature.shipowner_self_service_enabled',
    onlinePaymentStripeEnabled: 'feature.online_payment_stripe_enabled',
    onlinePaypalEnabled: 'feature.online_payment_paypal_enabled',
    walletTopupEnabled: 'feature.wallet_topup_enabled',
    notificationSmsEnabled: 'feature.notification_sms_enabled',
    airSelfServiceEnabled: 'feature.air_self_service_enabled',
};
```

```ts
function defaultFlags(): PortalFeatureFlags {
    return {
        portalV1Enabled: false,
        selfServiceEnabled: false,
        onlinePaymentStripeEnabled: false,
        onlinePaypalEnabled: false,
        walletTopupEnabled: false,
        notificationSmsEnabled: false,
        airSelfServiceEnabled: false,
    };
}
```

Mettre à jour le commentaire d'en-tête : « les 6 flags » devient « les 7 flags ».

- [ ] **Step 5 : Ajouter la branche PAYPAL à l'éligibilité**

Dans `frontend/src/app/api/owner/payment-availability/route.ts` :

1. Import :

```ts
import { paypalConfigured } from '@/services/paypalService';
```

2. Étendre `OWNER_RAILS` — placer `PAYPAL` juste après `STRIPE` pour que les deux rails de
   checkout se suivent dans le picker :

```ts
const OWNER_RAILS = ['STRIPE', 'PAYPAL', 'WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY', 'WALLET'] as const;
```

3. Insérer la branche juste après le bloc `if (rail === 'STRIPE') { … continue; }` :

```ts
        if (rail === 'PAYPAL') {
            // PayPal est son propre provider — aucune ligne dans payment_config,
            // même politique que STRIPE. Fail-secure : il faut les credentials
            // ET le flag app_config. L'un des deux absent masque le rail.
            const enabled = paypalConfigured() && flags.onlinePaypalEnabled;
            rails.push({
                rail,
                eligible: enabled,
                providers: enabled
                    ? [{ provider: 'paypal', routes_rail: ['PAYPAL'], display_order: 0 }]
                    : [],
                reason: enabled ? undefined : 'no_active_provider',
            });
            continue;
        }
```

- [ ] **Step 6 : Lancer, vérifier que ça passe**

```bash
cd frontend && npx vitest run src/lib src/app/api/owner/payment-availability && npx tsc --noEmit
```

Attendu : PASS. Le typecheck peut révéler d'autres consommateurs de `PortalFeatureFlags` qui
construisent l'objet en entier (tests, mocks) — les compléter avec `onlinePaypalEnabled: false`.

- [ ] **Step 7 : Suite complète et commit**

```bash
cd frontend && npm test
cd /c/Users/lecle/Workspace/africgreen
git add frontend/src/lib/feature-flags.ts \
        frontend/src/app/api/owner/payment-availability/route.ts \
        frontend/src/app/api/owner/payment-availability/route.test.ts \
        frontend/src/lib/__tests__/feature-flags.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" \
  -m "feat(payments): exposer le rail PayPal au portail derrière un feature flag"
```

---

## Task 6 : Branche PAYPAL dans `initiatePayment`

**Files:**
- Modify: `frontend/src/actions/initiatePayment.ts`
- Test: `frontend/src/actions/initiatePayment.test.ts` (existant, à étendre)

**Interfaces:**
- Consumes: `createOrder`, `paypalConfigured` (Task 1) ; valeur d'enum `PAYPAL` (Task 2).
- Produces: `initiatePayment({ rail: 'PAYPAL', … })` renvoie
  `{ id, status: 'PROCESSING', transaction_id, amount_usd_minor, checkoutUrl }`.

- [ ] **Step 1 : Lire le test existant**

```bash
cd frontend && sed -n 1,80p src/actions/initiatePayment.test.ts
```

Réutiliser ses mocks (`requireOwner`, `createTenantClient`, `lockRate`) tels quels — ne pas
inventer un second harnais.

- [ ] **Step 2 : Écrire les tests qui échouent**

Ajouter à `frontend/src/actions/initiatePayment.test.ts` (en adaptant aux mocks du fichier) :

```ts
describe('rail PAYPAL', () => {
    it('crée un ordre PayPal et insère une ligne PROCESSING', async () => {
        createPaypalOrderMock.mockResolvedValue({
            orderId: 'ORDER-1',
            approveUrl: 'https://paypal.com/approve/ORDER-1',
        });

        const out = await initiatePayment({
            transactionId: '11111111-1111-1111-1111-111111111111',
            amount: '1250.00',
            currency: 'USD',
            rail: 'PAYPAL',
            railDetails: {},
        });

        const row = insertedRows[0];
        expect(row.rail).toBe('PAYPAL');
        expect(row.status).toBe('PROCESSING');
        expect(row.external_reference).toBe('ORDER-1');
        expect(row.amount_usd_minor).toBe(125000);
        expect(row.rail_details.paypal_order_id).toBe('ORDER-1');
        expect(out.checkoutUrl).toBe('https://paypal.com/approve/ORDER-1');
    });

    it('passe le montant, la référence de facture et les URLs de retour à PayPal', async () => {
        createPaypalOrderMock.mockResolvedValue({ orderId: 'ORDER-2', approveUrl: 'https://x' });
        transactionRow = { invoice_ref: 'INV-2026-abc' };

        await initiatePayment({
            transactionId: '11111111-1111-1111-1111-111111111111',
            amount: '1250.00', currency: 'USD', rail: 'PAYPAL', railDetails: {},
        });

        const arg = createPaypalOrderMock.mock.calls[0][0];
        expect(arg.amountUsdMinor).toBe(125000);
        expect(arg.invoiceRef).toBe('INV-2026-abc');
        expect(arg.returnUrl).toContain('/api/payments/paypal/return');
        expect(arg.cancelUrl).toContain('/dashboard/invoices?paypal=cancel');
    });

    it('refuse si les credentials PayPal manquent, sans créer de ligne', async () => {
        paypalConfiguredMock.mockReturnValue(false);
        await expect(initiatePayment({
            transactionId: '11111111-1111-1111-1111-111111111111',
            amount: '10.00', currency: 'USD', rail: 'PAYPAL', railDetails: {},
        })).rejects.toThrow(/paypal/i);
        expect(insertedRows).toEqual([]);
    });

    it('ne crée aucune ligne si createOrder échoue', async () => {
        createPaypalOrderMock.mockRejectedValue(new Error('PayPal 422'));
        await expect(initiatePayment({
            transactionId: '11111111-1111-1111-1111-111111111111',
            amount: '10.00', currency: 'USD', rail: 'PAYPAL', railDetails: {},
        })).rejects.toThrow('PayPal 422');
        expect(insertedRows).toEqual([]);
    });

    it('fonctionne en top-up (transactionId null)', async () => {
        createPaypalOrderMock.mockResolvedValue({ orderId: 'ORDER-3', approveUrl: 'https://x' });
        await initiatePayment({
            transactionId: null, amount: '500.00', currency: 'USD',
            rail: 'PAYPAL', railDetails: {},
        });
        expect(insertedRows[0].transaction_id).toBeNull();
        expect(createPaypalOrderMock.mock.calls[0][0].transactionId).toBeNull();
    });
});
```

Ajouter le mock du service en tête de fichier :

```ts
const createPaypalOrderMock = vi.fn();
const paypalConfiguredMock = vi.fn(() => true);
vi.mock('@/services/paypalService', () => ({
    createOrder: (...a: unknown[]) => createPaypalOrderMock(...a),
    paypalConfigured: () => paypalConfiguredMock(),
}));
```

- [ ] **Step 3 : Lancer, vérifier l'échec**

```bash
cd frontend && npx vitest run src/actions/initiatePayment.test.ts
```

Attendu : ÉCHEC — `owner cannot initiate rail=PAYPAL`.

- [ ] **Step 4 : Implémenter la branche**

Dans `frontend/src/actions/initiatePayment.ts` :

1. Imports :

```ts
import { createOrder as createPaypalOrder, paypalConfigured } from '@/services/paypalService';
```

2. Étendre les deux listes de rails :

```ts
const OWNER_RAILS = ['WIRE_TRANSFER', 'MOBILE_MONEY', 'THIRD_PARTY', 'WALLET', 'STRIPE', 'PAYPAL'] as const;
const ALL_RAILS = [
    'STRIPE', 'PAYPAL', 'WIRE_TRANSFER', 'CASH', 'CHEQUE', 'LETTER_OF_CREDIT',
    'NETTING', 'THIRD_PARTY', 'MOBILE_MONEY', 'BANK_GUARANTEE', 'WALLET',
] as const;
```

3. Insérer la branche PAYPAL **juste après** le bloc `if (parsed.rail === 'STRIPE') { … }` :

```ts
    if (parsed.rail === 'PAYPAL') {
        // Fail-fast avant tout INSERT : mieux vaut une erreur visible dans le
        // dialogue qu'une ligne payments orpheline sans ordre PayPal en face.
        if (!paypalConfigured()) {
            throw new Error('PayPal is not configured on this environment');
        }

        const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3300';

        // La référence de facture voyage jusqu'à PayPal (referenceId +
        // description) pour que l'armateur la retrouve sur son relevé PayPal.
        // Best-effort : un top-up n'a pas de facture.
        let invoiceRef = parsed.transactionId ?? 'TOPUP';
        if (parsed.transactionId) {
            const { data: tx } = await admin
                .from('transactions')
                .select('invoice_ref')
                .eq('id', parsed.transactionId)
                .maybeSingle();
            const ref = (tx as { invoice_ref?: string | null } | null)?.invoice_ref;
            if (ref) invoiceRef = ref;
        }

        const order = await createPaypalOrder({
            amountUsdMinor,
            transactionId: parsed.transactionId,
            invoiceRef,
            returnUrl: `${baseUrl}/api/payments/paypal/return`,
            cancelUrl: `${baseUrl}/dashboard/invoices?paypal=cancel`,
        });

        const paypalRow = {
            ...rowCommon,
            rail: 'PAYPAL' as const,
            // PROCESSING, comme STRIPE : l'ordre existe côté PayPal mais rien
            // n'est encaissé avant la capture.
            status: 'PROCESSING' as const,
            external_reference: order.orderId,
            rail_details: {
                ...parsed.railDetails,
                paypal_order_id: order.orderId,
            },
        };

        const { data, error } = await admin
            .from('payments')
            .insert(paypalRow)
            .select('id, status, transaction_id, amount_usd_minor')
            .single();
        if (error) throw error;
        return { ...data, checkoutUrl: order.approveUrl };
    }
```

**Ordre des opérations volontaire** : l'ordre PayPal est créé **avant** l'INSERT. Si PayPal
refuse, on throw sans avoir écrit — pas de ligne `PROCESSING` sans ordre en face. L'inverse
laisserait des lignes orphelines que le cron devrait annuler.

- [ ] **Step 5 : Lancer, vérifier que ça passe**

```bash
cd frontend && npx vitest run src/actions/initiatePayment.test.ts && npx tsc --noEmit
```

Attendu : PASS, y compris les tests STRIPE et WIRE_TRANSFER préexistants.

- [ ] **Step 6 : Suite complète et commit**

```bash
cd frontend && npm test
cd /c/Users/lecle/Workspace/africgreen
git add frontend/src/actions/initiatePayment.ts frontend/src/actions/initiatePayment.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" \
  -m "feat(payments): initier un paiement PayPal depuis le portail armateur"
```

---

## Task 7 : Route de retour navigateur

**Files:**
- Create: `frontend/src/app/api/payments/paypal/return/route.ts`
- Test: `frontend/src/app/api/payments/paypal/return/route.test.ts`

**Interfaces:**
- Consumes: `captureOrder`, `getOrder` (Task 1) ; `confirmPaypalPayment` (Task 4) ;
  `requireOwner` de `@/lib/auth/requireOwner` ; `createTenantClient` de `@/lib/supabase/tenant`.
- Produces: `GET /api/payments/paypal/return?token=<orderId>` → 307 vers
  `/dashboard/invoices?paypal=success|pending|failed`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/app/api/payments/paypal/return/route.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const requireOwnerMock = vi.fn();
const captureOrderMock = vi.fn();
const getOrderMock = vi.fn();
const confirmMock = vi.fn();
const tenantClientMock = vi.fn();

vi.mock('@/lib/auth/requireOwner', () => ({ requireOwner: () => requireOwnerMock() }));
vi.mock('@/services/paypalService', () => ({
    captureOrder: (...a: unknown[]) => captureOrderMock(...a),
    getOrder: (...a: unknown[]) => getOrderMock(...a),
}));
vi.mock('@/services/paypalConfirmation', () => ({
    confirmPaypalPayment: (...a: unknown[]) => confirmMock(...a),
}));
vi.mock('@/lib/supabase/tenant', () => ({
    createTenantClient: (...a: unknown[]) => tenantClientMock(...a),
}));

import { GET } from './route';

let ownedShipownerId: string;
let paymentRow: Record<string, unknown> | null;

function fakeAdmin() {
    return {
        from: () => ({
            select: () => {
                const chain = {
                    eq: () => chain,
                    maybeSingle: async () => ({ data: paymentRow, error: null }),
                };
                return chain;
            },
        }),
    };
}

function req(qs: string): NextRequest {
    return new Request(`https://app.test/api/payments/paypal/return${qs}`) as unknown as NextRequest;
}

/** Lit la destination d'une redirection Next (307 + header Location). */
function locationOf(res: Response): string {
    return res.headers.get('location') ?? '';
}

beforeEach(() => {
    requireOwnerMock.mockReset();
    captureOrderMock.mockReset();
    getOrderMock.mockReset();
    confirmMock.mockReset();
    tenantClientMock.mockReset();

    ownedShipownerId = 'so-1';
    paymentRow = { id: 'pay-1', shipowner_id: 'so-1', status: 'PROCESSING' };

    requireOwnerMock.mockResolvedValue({
        userId: 'u-1',
        jurisdictionId: 'jur-1',
        shipowner: { id: ownedShipownerId },
    });
    tenantClientMock.mockReturnValue(fakeAdmin());
    captureOrderMock.mockResolvedValue({
        captureId: 'CAP-9', orderStatus: 'COMPLETED',
        paidAmount: '1250.00', paidCurrency: 'USD', payerEmail: 'p@example.com',
    });
    confirmMock.mockResolvedValue({ outcome: 'CONFIRMED', paymentId: 'pay-1' });
});

describe('GET /api/payments/paypal/return', () => {
    it('capture puis confirme, et redirige vers success', async () => {
        const res = await GET(req('?token=ORDER-1&PayerID=PAYER-1'));

        expect(captureOrderMock).toHaveBeenCalledWith('ORDER-1');
        expect(confirmMock).toHaveBeenCalledOnce();
        expect(confirmMock.mock.calls[0][1]).toEqual({
            orderId: 'ORDER-1',
            captureId: 'CAP-9',
            paidAmount: '1250.00',
            paidCurrency: 'USD',
            payerEmail: 'p@example.com',
        });
        expect(locationOf(res)).toContain('/dashboard/invoices?paypal=success');
    });

    it('utilise un client scopé à la juridiction de l’armateur', async () => {
        await GET(req('?token=ORDER-1'));
        expect(tenantClientMock).toHaveBeenCalledWith('jur-1');
    });

    it('redirige vers failed si token absent, sans appeler PayPal', async () => {
        const res = await GET(req(''));
        expect(captureOrderMock).not.toHaveBeenCalled();
        expect(locationOf(res)).toContain('paypal=failed');
    });

    it('redirige vers failed si l’ordre est inconnu', async () => {
        paymentRow = null;
        const res = await GET(req('?token=ORDER-X'));
        expect(captureOrderMock).not.toHaveBeenCalled();
        expect(locationOf(res)).toContain('paypal=failed');
    });

    it('redirige vers failed si la ligne appartient à un autre armateur, sans capturer', async () => {
        paymentRow = { id: 'pay-2', shipowner_id: 'so-OTHER', status: 'PROCESSING' };
        const res = await GET(req('?token=ORDER-1'));
        expect(captureOrderMock).not.toHaveBeenCalled();
        expect(confirmMock).not.toHaveBeenCalled();
        expect(locationOf(res)).toContain('paypal=failed');
    });

    it('redirige vers success si la ligne est déjà CONFIRMED (webhook plus rapide)', async () => {
        paymentRow = { id: 'pay-1', shipowner_id: 'so-1', status: 'CONFIRMED' };
        const res = await GET(req('?token=ORDER-1'));
        expect(captureOrderMock).not.toHaveBeenCalled();
        expect(locationOf(res)).toContain('paypal=success');
    });

    it('redirige vers pending si la capture échoue — les filets reprennent la main', async () => {
        captureOrderMock.mockRejectedValue(new Error('PayPal 500'));
        const res = await GET(req('?token=ORDER-1'));
        expect(confirmMock).not.toHaveBeenCalled();
        expect(locationOf(res)).toContain('paypal=pending');
    });

    it('retombe sur getOrder si PayPal dit déjà capturé, puis confirme', async () => {
        captureOrderMock.mockRejectedValue(new Error('ORDER_ALREADY_CAPTURED'));
        getOrderMock.mockResolvedValue({
            captureId: 'CAP-9', orderStatus: 'COMPLETED',
            paidAmount: '1250.00', paidCurrency: 'USD', payerEmail: null,
        });
        const res = await GET(req('?token=ORDER-1'));
        expect(getOrderMock).toHaveBeenCalledWith('ORDER-1');
        expect(confirmMock).toHaveBeenCalledOnce();
        expect(locationOf(res)).toContain('paypal=success');
    });

    it('redirige vers failed si la confirmation rejette le montant', async () => {
        confirmMock.mockResolvedValue({ outcome: 'REJECTED_AMOUNT_MISMATCH', paymentId: 'pay-1' });
        const res = await GET(req('?token=ORDER-1'));
        expect(locationOf(res)).toContain('paypal=failed');
    });

    it('redirige vers success sur IDEMPOTENT_SKIP (un autre chemin a gagné)', async () => {
        confirmMock.mockResolvedValue({ outcome: 'IDEMPOTENT_SKIP', paymentId: 'pay-1' });
        const res = await GET(req('?token=ORDER-1'));
        expect(locationOf(res)).toContain('paypal=success');
    });

    it('redirige vers pending sur ERROR', async () => {
        confirmMock.mockResolvedValue({ outcome: 'ERROR' });
        const res = await GET(req('?token=ORDER-1'));
        expect(locationOf(res)).toContain('paypal=pending');
    });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

```bash
cd frontend && npx vitest run src/app/api/payments/paypal/return
```

Attendu : ÉCHEC — module introuvable.

- [ ] **Step 3 : Écrire la route**

Créer `frontend/src/app/api/payments/paypal/return/route.ts` :

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { requireOwner } from '@/lib/auth/requireOwner';
import { createTenantClient } from '@/lib/supabase/tenant';
import { captureOrder, getOrder } from '@/services/paypalService';
import { confirmPaypalPayment } from '@/services/paypalConfirmation';
import { scopedLogger } from '@/lib/logger';

/**
 * GET /api/payments/paypal/return
 *
 * URL de retour déclarée à PayPal dans `applicationContext.returnUrl`. PayPal y
 * renvoie l'armateur après approbation, avec `?token=<orderId>&PayerID=<payerId>`.
 *
 * C'est le chemin NOMINAL de capture : PayPal Orders v2 n'encaisse rien tant que
 * `captureOrder` n'a pas été appelé (fenêtre de 6 h). Capturer ici permet à
 * l'armateur de voir sa facture PAYÉE dès l'affichage de la page.
 *
 * Le webhook (/api/webhooks/paypal) et le cron de réconciliation couvrent les
 * cas où l'armateur ne revient jamais.
 *
 * Sécurité :
 *   - `requireOwner()` — session armateur authentifiée obligatoire.
 *   - la ligne `payments` doit appartenir au shipowner de la session. Un `token`
 *     appartenant à un autre armateur redirige vers `failed` sans jamais révéler
 *     que la ligne existe, et sans capturer.
 *
 * Toutes les issues sont des redirections vers /dashboard/invoices — la page que
 * l'armateur attend. Aucune réponse JSON : c'est une navigation, pas une API.
 *   ?paypal=success  paiement confirmé (par nous ou par un filet)
 *   ?paypal=pending  approuvé mais capture ou confirmation incomplète
 *   ?paypal=failed   token invalide, ligne étrangère, ou montant rejeté
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INVOICES_PATH = '/dashboard/invoices';

const log = scopedLogger('paypal-return');

function redirectTo(req: NextRequest, outcome: 'success' | 'pending' | 'cancel' | 'failed') {
    return NextResponse.redirect(new URL(`${INVOICES_PATH}?paypal=${outcome}`, req.url));
}

interface OwnedPaymentRow {
    id: string;
    shipowner_id: string;
    status: string;
}

export async function GET(req: NextRequest): Promise<Response> {
    // requireOwner redirige (throw NEXT_REDIRECT) si la session n'est pas une
    // session armateur active — c'est le comportement voulu ici aussi.
    const ctx = await requireOwner();

    const orderId = new URL(req.url).searchParams.get('token');
    if (!orderId) {
        log.warn('paypal_return_missing_token', { userId: ctx.userId });
        return redirectTo(req, 'failed');
    }

    const admin = createTenantClient(ctx.jurisdictionId);

    // Vérifier l'appartenance AVANT tout appel sortant : on ne capture jamais
    // pour le compte d'un autre armateur.
    const { data } = await admin
        .from('payments')
        .select('id, shipowner_id, status')
        .eq('external_reference', orderId)
        .eq('rail', 'PAYPAL')
        .maybeSingle();

    const payment = (data as OwnedPaymentRow | null) ?? null;
    if (!payment) {
        log.warn('paypal_return_unknown_order', { userId: ctx.userId, orderId });
        return redirectTo(req, 'failed');
    }
    if (payment.shipowner_id !== ctx.shipowner.id) {
        log.error('paypal_return_ownership_mismatch', {
            userId: ctx.userId,
            orderId,
            paymentId: payment.id,
        });
        return redirectTo(req, 'failed');
    }

    // Un filet a pu confirmer avant le retour (webhook très rapide). Rien à
    // faire : afficher le succès.
    if (payment.status === 'CONFIRMED') {
        return redirectTo(req, 'success');
    }
    if (payment.status === 'REJECTED' || payment.status === 'CANCELLED') {
        return redirectTo(req, 'failed');
    }

    // ── Capture ──────────────────────────────────────────────────────────────
    // PayPal refuse une double capture (ORDER_ALREADY_CAPTURED). Dans ce cas la
    // capture existe déjà : on relit l'ordre pour récupérer ses montants au lieu
    // de traiter l'erreur comme un échec.
    let capture;
    try {
        capture = await captureOrder(orderId);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes('ORDER_ALREADY_CAPTURED')) {
            try {
                capture = await getOrder(orderId);
            } catch (readErr) {
                log.error('paypal_return_reread_failed', {
                    orderId,
                    error: readErr instanceof Error ? readErr.message : String(readErr),
                });
                return redirectTo(req, 'pending');
            }
        } else {
            log.error('paypal_return_capture_failed', { orderId, error: message });
            return redirectTo(req, 'pending');
        }
    }

    const { outcome } = await confirmPaypalPayment(admin, {
        orderId,
        captureId: capture.captureId,
        paidAmount: capture.paidAmount,
        paidCurrency: capture.paidCurrency,
        payerEmail: capture.payerEmail,
    });

    switch (outcome) {
        case 'CONFIRMED':
        case 'IDEMPOTENT_SKIP':
            return redirectTo(req, 'success');
        case 'REJECTED_AMOUNT_MISMATCH':
        case 'NOT_FOUND':
            return redirectTo(req, 'failed');
        default:
            return redirectTo(req, 'pending');
    }
}
```

- [ ] **Step 4 : Lancer, vérifier que ça passe**

```bash
cd frontend && npx vitest run src/app/api/payments/paypal/return
```

Attendu : PASS, 11 tests.

Si `NextResponse.redirect` ne produit pas de header `location` exploitable dans l'environnement
de test, adapter le helper `locationOf` du test (lire `res.headers.get('Location')` ou
`res.url`) — **ne pas** remplacer la redirection par une réponse JSON, la navigation est le
comportement attendu.

- [ ] **Step 5 : Typecheck et commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint
cd /c/Users/lecle/Workspace/africgreen
git add frontend/src/app/api/payments/paypal/return/
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" \
  -m "feat(payments): capture PayPal au retour navigateur

Vérifie l'appartenance de la ligne avant tout appel sortant, retombe sur
getOrder si PayPal signale une capture déjà faite."
```

---

## Task 8 : Webhook PayPal

**Files:**
- Create: `frontend/src/app/api/webhooks/paypal/route.ts`
- Test: `frontend/src/app/api/webhooks/paypal/route.test.ts`

**Interfaces:**
- Consumes: `verifyWebhookSignature`, `captureOrder`, `getOrder` (Task 1) ;
  `confirmPaypalPayment`, `rejectPaypalPayment`, `cancelPaypalPayment` (Task 4) ;
  `createPlatformClient`.
- Produces: `POST /api/webhooks/paypal`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/app/api/webhooks/paypal/route.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const verifySigMock = vi.fn();
const captureOrderMock = vi.fn();
const getOrderMock = vi.fn();
const confirmMock = vi.fn();
const rejectMock = vi.fn();
const cancelMock = vi.fn();

vi.mock('@/services/paypalService', () => ({
    verifyWebhookSignature: (...a: unknown[]) => verifySigMock(...a),
    captureOrder: (...a: unknown[]) => captureOrderMock(...a),
    getOrder: (...a: unknown[]) => getOrderMock(...a),
}));
vi.mock('@/services/paypalConfirmation', () => ({
    confirmPaypalPayment: (...a: unknown[]) => confirmMock(...a),
    rejectPaypalPayment: (...a: unknown[]) => rejectMock(...a),
    cancelPaypalPayment: (...a: unknown[]) => cancelMock(...a),
}));
vi.mock('@/lib/supabase/tenant', () => ({ createPlatformClient: () => ({}) }));

import { POST } from './route';

const SIG_HEADERS = {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.paypal.com/cert.pem',
    'paypal-transmission-id': 'tid-1',
    'paypal-transmission-sig': 'sig-1',
    'paypal-transmission-time': '2026-07-30T10:00:00Z',
};

function req(body: unknown, headers: Record<string, string> = SIG_HEADERS): NextRequest {
    return new Request('https://app.test/api/webhooks/paypal', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
    }) as unknown as NextRequest;
}

const APPROVED_EVENT = {
    id: 'EV-1',
    event_type: 'CHECKOUT.ORDER.APPROVED',
    resource: { id: 'ORDER-1', status: 'APPROVED' },
};

const CAPTURE_COMPLETED_EVENT = {
    id: 'EV-2',
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    resource: {
        id: 'CAP-9',
        status: 'COMPLETED',
        amount: { value: '1250.00', currency_code: 'USD' },
        supplementary_data: { related_ids: { order_id: 'ORDER-1' } },
    },
};

beforeEach(() => {
    verifySigMock.mockReset().mockResolvedValue(true);
    captureOrderMock.mockReset().mockResolvedValue({
        captureId: 'CAP-9', orderStatus: 'COMPLETED',
        paidAmount: '1250.00', paidCurrency: 'USD', payerEmail: 'p@example.com',
    });
    getOrderMock.mockReset();
    confirmMock.mockReset().mockResolvedValue({ outcome: 'CONFIRMED', paymentId: 'pay-1' });
    rejectMock.mockReset().mockResolvedValue({ outcome: 'REJECTED' });
    cancelMock.mockReset().mockResolvedValue({ outcome: 'CANCELLED' });
});

describe('signature', () => {
    it('400 si un header de signature manque', async () => {
        const res = await POST(req(APPROVED_EVENT, {}));
        expect(res.status).toBe(400);
        expect(confirmMock).not.toHaveBeenCalled();
    });

    it('400 si la signature est invalide', async () => {
        verifySigMock.mockResolvedValue(false);
        const res = await POST(req(APPROVED_EVENT));
        expect(res.status).toBe(400);
        expect(confirmMock).not.toHaveBeenCalled();
    });

    it('400 si le corps n’est pas du JSON', async () => {
        const bad = new Request('https://app.test/api/webhooks/paypal', {
            method: 'POST', headers: SIG_HEADERS, body: 'not-json',
        }) as unknown as NextRequest;
        expect((await POST(bad)).status).toBe(400);
    });
});

describe('CHECKOUT.ORDER.APPROVED', () => {
    it('capture puis confirme', async () => {
        const res = await POST(req(APPROVED_EVENT));
        expect(res.status).toBe(200);
        expect(captureOrderMock).toHaveBeenCalledWith('ORDER-1');
        expect(confirmMock.mock.calls[0][1].orderId).toBe('ORDER-1');
        expect((await res.json()).action).toBe('confirmed');
    });

    it('retombe sur getOrder si la capture est déjà faite', async () => {
        captureOrderMock.mockRejectedValue(new Error('ORDER_ALREADY_CAPTURED'));
        getOrderMock.mockResolvedValue({
            captureId: 'CAP-9', orderStatus: 'COMPLETED',
            paidAmount: '1250.00', paidCurrency: 'USD', payerEmail: null,
        });
        const res = await POST(req(APPROVED_EVENT));
        expect(res.status).toBe(200);
        expect(confirmMock).toHaveBeenCalledOnce();
    });

    it('200 sans confirmation si la capture échoue vraiment', async () => {
        captureOrderMock.mockRejectedValue(new Error('PayPal 500'));
        const res = await POST(req(APPROVED_EVENT));
        expect(res.status).toBe(200);
        expect(confirmMock).not.toHaveBeenCalled();
        expect((await res.json()).action).toBe('capture_failed');
    });
});

describe('PAYMENT.CAPTURE.COMPLETED', () => {
    it('confirme sans recapturer', async () => {
        const res = await POST(req(CAPTURE_COMPLETED_EVENT));
        expect(res.status).toBe(200);
        expect(captureOrderMock).not.toHaveBeenCalled();
        expect(confirmMock.mock.calls[0][1]).toEqual({
            orderId: 'ORDER-1',
            captureId: 'CAP-9',
            paidAmount: '1250.00',
            paidCurrency: 'USD',
            payerEmail: null,
        });
    });

    it('200 unknown_reference si l’order_id est absent du payload', async () => {
        const noOrder = { ...CAPTURE_COMPLETED_EVENT, resource: { id: 'CAP-9', amount: {} } };
        const res = await POST(req(noOrder));
        expect(res.status).toBe(200);
        expect((await res.json()).action).toBe('unknown_reference');
        expect(confirmMock).not.toHaveBeenCalled();
    });
});

describe('échecs et annulations', () => {
    it.each(['PAYMENT.CAPTURE.DENIED', 'PAYMENT.CAPTURE.DECLINED'])(
        '%s → rejet',
        async (event_type) => {
            const res = await POST(req({
                id: 'EV-3', event_type,
                resource: {
                    id: 'CAP-9',
                    status_details: { reason: 'INSTRUMENT_DECLINED' },
                    supplementary_data: { related_ids: { order_id: 'ORDER-1' } },
                },
            }));
            expect(res.status).toBe(200);
            expect(rejectMock).toHaveBeenCalledWith(expect.anything(), 'ORDER-1', 'INSTRUMENT_DECLINED');
        },
    );

    it('CHECKOUT.ORDER.VOIDED → annulation', async () => {
        const res = await POST(req({
            id: 'EV-4', event_type: 'CHECKOUT.ORDER.VOIDED',
            resource: { id: 'ORDER-1' },
        }));
        expect(res.status).toBe(200);
        expect(cancelMock).toHaveBeenCalledWith(expect.anything(), 'ORDER-1', 'order voided');
    });
});

describe('robustesse', () => {
    it('200 sur événement non géré, sans écriture', async () => {
        const res = await POST(req({
            id: 'EV-5', event_type: 'BILLING.SUBSCRIPTION.CREATED', resource: {},
        }));
        expect(res.status).toBe(200);
        expect((await res.json()).action).toBe('unhandled_event');
        expect(confirmMock).not.toHaveBeenCalled();
    });

    it('200 même si un handler throw — jamais de tempête de retry', async () => {
        confirmMock.mockRejectedValue(new Error('boom'));
        const res = await POST(req(CAPTURE_COMPLETED_EVENT));
        expect(res.status).toBe(200);
        expect((await res.json()).error).toBe(true);
    });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

```bash
cd frontend && npx vitest run src/app/api/webhooks/paypal
```

Attendu : ÉCHEC — module introuvable.

- [ ] **Step 3 : Écrire le webhook**

Créer `frontend/src/app/api/webhooks/paypal/route.ts` :

```ts
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { verifyWebhookSignature, captureOrder, getOrder } from '@/services/paypalService';
import {
    confirmPaypalPayment,
    rejectPaypalPayment,
    cancelPaypalPayment,
} from '@/services/paypalConfirmation';
import { scopedLogger } from '@/lib/logger';

/**
 * POST /api/webhooks/paypal
 *
 * Filet du rail PAYPAL. Le chemin nominal est la route de retour navigateur
 * (/api/payments/paypal/return) ; ce webhook couvre l'armateur qui approuve puis
 * ferme son onglet, et la capture réussie dont l'UPDATE local a échoué.
 *
 * PayPal retente la livraison pendant environ 3 jours — largement dans la
 * fenêtre de capture de 6 h. C'est le vrai filet ; le cron n'est qu'un janitor.
 *
 * Événements traités :
 *   CHECKOUT.ORDER.APPROVED    → capture puis confirmation (onglet fermé)
 *   PAYMENT.CAPTURE.COMPLETED  → confirmation (capture déjà faite)
 *   PAYMENT.CAPTURE.DENIED     → rejet
 *   PAYMENT.CAPTURE.DECLINED   → rejet
 *   CHECKOUT.ORDER.VOIDED      → annulation
 *
 * L'identifiant d'ordre PayPal (= payments.external_reference) se lit :
 *   - directement dans `resource.id` pour les événements CHECKOUT.ORDER.*
 *   - dans `resource.supplementary_data.related_ids.order_id` pour les
 *     événements PAYMENT.CAPTURE.* (dont `resource.id` est l'id de capture)
 *
 * Codes de retour, alignés sur le webhook Stripe :
 *   400 signature absente / invalide, ou corps illisible
 *   200 succès, événement ignoré volontairement, ET erreur interne (loguée) —
 *       jamais de 500, qui déclencherait une tempête de retry sur un bug
 *       persistant.
 *
 * Client Supabase : plateforme (non scopé). Un webhook n'a aucun contexte
 * tenant ; le lookup se fait par identifiant PayPal, et jurisdiction_id est déjà
 * porté par la ligne payments créée à l'initiation. Même politique que le
 * webhook Stripe.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = scopedLogger('paypal-webhook');

const SIG_HEADERS = [
    'paypal-auth-algo',
    'paypal-cert-url',
    'paypal-transmission-id',
    'paypal-transmission-sig',
    'paypal-transmission-time',
] as const;

function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Résout l'identifiant d'ordre PayPal selon la famille d'événement. */
function extractOrderId(eventType: string, resource: Record<string, unknown>): string | null {
    if (eventType.startsWith('CHECKOUT.ORDER.')) {
        return typeof resource.id === 'string' ? resource.id : null;
    }
    const related = asRecord(asRecord(resource.supplementary_data).related_ids);
    return typeof related.order_id === 'string' ? related.order_id : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
    const headers: Record<string, string | null> = {};
    for (const h of SIG_HEADERS) headers[h] = req.headers.get(h);
    if (SIG_HEADERS.some((h) => !headers[h])) {
        log.warn('webhook_missing_signature_headers', {});
        return NextResponse.json({ error: 'missing signature headers' }, { status: 400 });
    }

    const rawBody = await req.text();

    let event: Record<string, unknown>;
    try {
        event = asRecord(JSON.parse(rawBody));
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!(await verifyWebhookSignature(headers, rawBody))) {
        log.warn('webhook_signature_invalid', { eventId: String(event.id ?? '(none)') });
        return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
    }

    const eventId = String(event.id ?? '(none)');
    const eventType = String(event.event_type ?? '');
    const resource = asRecord(event.resource);

    log.info('webhook_event_received', { eventId, eventType });

    const admin = createPlatformClient();

    try {
        switch (eventType) {
            case 'CHECKOUT.ORDER.APPROVED':
                return await handleApproved(admin, resource, eventId);
            case 'PAYMENT.CAPTURE.COMPLETED':
                return await handleCaptureCompleted(admin, resource, eventId);
            case 'PAYMENT.CAPTURE.DENIED':
            case 'PAYMENT.CAPTURE.DECLINED':
                return await handleCaptureFailed(admin, resource, eventId, eventType);
            case 'CHECKOUT.ORDER.VOIDED':
                return await handleVoided(admin, resource, eventId);
            default:
                log.warn('webhook_unhandled_event', { eventId, eventType });
                return NextResponse.json({ received: true, action: 'unhandled_event' });
        }
    } catch (e) {
        log.error('webhook_handler_error', {
            eventId,
            eventType,
            error: e instanceof Error ? e.message : String(e),
        });
        // 200 volontaire — l'erreur est loguée, on ne veut pas de retry en boucle.
        return NextResponse.json({ received: true, error: true });
    }
}

async function handleApproved(
    admin: SupabaseClient,
    resource: Record<string, unknown>,
    eventId: string,
): Promise<NextResponse> {
    const orderId = extractOrderId('CHECKOUT.ORDER.APPROVED', resource);
    if (!orderId) {
        log.warn('webhook_missing_order_id', { eventId, eventType: 'CHECKOUT.ORDER.APPROVED' });
        return NextResponse.json({ received: true, action: 'unknown_reference' });
    }

    // L'armateur a approuvé mais n'est peut-être jamais revenu : c'est à nous de
    // capturer. Si la route de retour a déjà capturé, PayPal renvoie
    // ORDER_ALREADY_CAPTURED — on relit alors l'ordre et on laisse
    // confirmPaypalPayment décider (il sortira en IDEMPOTENT_SKIP).
    let capture;
    try {
        capture = await captureOrder(orderId);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!message.includes('ORDER_ALREADY_CAPTURED')) {
            log.error('webhook_capture_failed', { eventId, orderId, error: message });
            return NextResponse.json({ received: true, action: 'capture_failed' });
        }
        capture = await getOrder(orderId);
    }

    const { outcome } = await confirmPaypalPayment(admin, {
        orderId,
        captureId: capture.captureId,
        paidAmount: capture.paidAmount,
        paidCurrency: capture.paidCurrency,
        payerEmail: capture.payerEmail,
    });
    return NextResponse.json({ received: true, action: actionFor(outcome) });
}

async function handleCaptureCompleted(
    admin: SupabaseClient,
    resource: Record<string, unknown>,
    eventId: string,
): Promise<NextResponse> {
    const orderId = extractOrderId('PAYMENT.CAPTURE.COMPLETED', resource);
    if (!orderId) {
        log.warn('webhook_missing_order_id', { eventId, eventType: 'PAYMENT.CAPTURE.COMPLETED' });
        return NextResponse.json({ received: true, action: 'unknown_reference' });
    }

    // La capture est déjà faite côté PayPal — ne jamais rappeler captureOrder.
    // Les montants du payload servent uniquement de contrôle ; la vérité reste
    // payments.amount_usd_minor.
    const amount = asRecord(resource.amount);
    const { outcome } = await confirmPaypalPayment(admin, {
        orderId,
        captureId: typeof resource.id === 'string' ? resource.id : null,
        paidAmount: amount.value != null ? String(amount.value) : null,
        paidCurrency: typeof amount.currency_code === 'string' ? amount.currency_code : null,
        payerEmail: null,
    });
    return NextResponse.json({ received: true, action: actionFor(outcome) });
}

async function handleCaptureFailed(
    admin: SupabaseClient,
    resource: Record<string, unknown>,
    eventId: string,
    eventType: string,
): Promise<NextResponse> {
    const orderId = extractOrderId(eventType, resource);
    if (!orderId) {
        log.warn('webhook_missing_order_id', { eventId, eventType });
        return NextResponse.json({ received: true, action: 'unknown_reference' });
    }
    const details = asRecord(resource.status_details);
    const reason = typeof details.reason === 'string' ? details.reason : eventType;
    const { outcome } = await rejectPaypalPayment(admin, orderId, reason);
    return NextResponse.json({ received: true, action: outcome.toLowerCase() });
}

async function handleVoided(
    admin: SupabaseClient,
    resource: Record<string, unknown>,
    eventId: string,
): Promise<NextResponse> {
    const orderId = extractOrderId('CHECKOUT.ORDER.VOIDED', resource);
    if (!orderId) {
        log.warn('webhook_missing_order_id', { eventId, eventType: 'CHECKOUT.ORDER.VOIDED' });
        return NextResponse.json({ received: true, action: 'unknown_reference' });
    }
    const { outcome } = await cancelPaypalPayment(admin, orderId, 'order voided');
    return NextResponse.json({ received: true, action: outcome.toLowerCase() });
}

function actionFor(outcome: string): string {
    switch (outcome) {
        case 'CONFIRMED':
            return 'confirmed';
        case 'IDEMPOTENT_SKIP':
            return 'already_paid';
        case 'NOT_FOUND':
            return 'unknown_reference';
        case 'REJECTED_AMOUNT_MISMATCH':
            return 'rejected_amount_mismatch';
        default:
            return 'error_logged';
    }
}
```

- [ ] **Step 4 : Lancer, vérifier que ça passe**

```bash
cd frontend && npx vitest run src/app/api/webhooks/paypal
```

Attendu : PASS (14 tests avec les `it.each`).

- [ ] **Step 5 : Typecheck, suite complète, commit**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm test
cd /c/Users/lecle/Workspace/africgreen
git add frontend/src/app/api/webhooks/paypal/
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" \
  -m "feat(payments): webhook PayPal en filet de la capture

Couvre l'onglet fermé après approbation et la capture dont l'écriture
locale a échoué. Signature vérifiée, 200 systématique hors signature."
```

---

## Task 9 : Cron janitor + chaînage des reconcilers

**Files:**
- Create: `frontend/src/app/api/cron/paypal-reconcile-pending/route.ts`
- Test: `frontend/src/app/api/cron/paypal-reconcile-pending/route.test.ts`
- Create: `frontend/src/app/api/cron/payments-reconcile-all/route.ts`
- Test: `frontend/src/app/api/cron/payments-reconcile-all/route.test.ts`
- Delete: `frontend/src/app/api/cron/stripe-reconcile-all/route.ts` + son test
- Modify: `frontend/vercel.json`

**Interfaces:**
- Consumes: `getOrder`, `captureOrder` (Task 1) ; `confirmPaypalPayment`, `cancelPaypalPayment`
  (Task 4).
- Produces: `GET /api/cron/paypal-reconcile-pending` et `GET /api/cron/payments-reconcile-all`,
  toutes deux gardées par `Authorization: Bearer ${CRON_SECRET}`.

**Contrainte de plateforme :** le plan Vercel refuse toute expression cron plus fréquente qu'une
fois par jour — c'est exactement pourquoi `stripe-reconcile-all` existe (lire son commentaire
d'en-tête). Pour ne consommer **aucun créneau supplémentaire**, on renomme ce chaîneur en
`payments-reconcile-all` et on y ajoute le reconciler PayPal.

- [ ] **Step 1 : Écrire le test du janitor**

Créer `frontend/src/app/api/cron/paypal-reconcile-pending/route.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const getOrderMock = vi.fn();
const captureOrderMock = vi.fn();
const confirmMock = vi.fn();
const cancelMock = vi.fn();

vi.mock('@/services/paypalService', () => ({
    getOrder: (...a: unknown[]) => getOrderMock(...a),
    captureOrder: (...a: unknown[]) => captureOrderMock(...a),
}));
vi.mock('@/services/paypalConfirmation', () => ({
    confirmPaypalPayment: (...a: unknown[]) => confirmMock(...a),
    cancelPaypalPayment: (...a: unknown[]) => cancelMock(...a),
}));

let pendingRows: Record<string, unknown>[] = [];
let selectError: { message: string } | null = null;
const filters: { op: string; col: string; val: unknown }[] = [];

vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({
        from: () => ({
            select: () => {
                const chain = {
                    eq: (col: string, val: unknown) => { filters.push({ op: 'eq', col, val }); return chain; },
                    lt: (col: string, val: unknown) => { filters.push({ op: 'lt', col, val }); return chain; },
                    limit: async () => ({ data: selectError ? null : pendingRows, error: selectError }),
                };
                return chain;
            },
        }),
    }),
}));

import { GET } from './route';

const HOUR = 60 * 60 * 1000;

function req(auth = 'Bearer secret-1'): NextRequest {
    return new Request('https://app.test/api/cron/paypal-reconcile-pending', {
        headers: auth ? { authorization: auth } : {},
    }) as unknown as NextRequest;
}

function row(overrides: Record<string, unknown> = {}) {
    return {
        id: 'pay-1',
        external_reference: 'ORDER-1',
        created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),  // 30 min
        transaction_id: 'tx-1',
        ...overrides,
    };
}

beforeEach(() => {
    process.env.CRON_SECRET = 'secret-1';
    getOrderMock.mockReset();
    captureOrderMock.mockReset();
    confirmMock.mockReset().mockResolvedValue({ outcome: 'CONFIRMED', paymentId: 'pay-1' });
    cancelMock.mockReset().mockResolvedValue({ outcome: 'CANCELLED' });
    filters.length = 0;
    selectError = null;
    pendingRows = [row()];
});

describe('garde CRON_SECRET', () => {
    it('401 sans header', async () => {
        expect((await GET(req(''))).status).toBe(401);
    });

    it('401 avec un mauvais secret', async () => {
        expect((await GET(req('Bearer nope'))).status).toBe(401);
    });

    it('401 si CRON_SECRET n’est pas configuré, même avec "Bearer undefined"', async () => {
        delete process.env.CRON_SECRET;
        expect((await GET(req('Bearer undefined'))).status).toBe(401);
    });
});

describe('sélection', () => {
    it('ne prend que les lignes PAYPAL en PROCESSING plus vieilles que le seuil', async () => {
        await GET(req());
        expect(filters).toEqual(expect.arrayContaining([
            { op: 'eq', col: 'rail', val: 'PAYPAL' },
            { op: 'eq', col: 'status', val: 'PROCESSING' },
            expect.objectContaining({ op: 'lt', col: 'created_at' }),
        ]));
    });

    it('500 si la sélection échoue', async () => {
        selectError = { message: 'db down' };
        expect((await GET(req())).status).toBe(500);
    });
});

describe('décisions', () => {
    it('ordre COMPLETED → confirmation', async () => {
        getOrderMock.mockResolvedValue({
            captureId: 'CAP-9', orderStatus: 'COMPLETED',
            paidAmount: '1250.00', paidCurrency: 'USD', payerEmail: null,
        });
        const body = await (await GET(req())).json();
        expect(confirmMock).toHaveBeenCalledOnce();
        expect(captureOrderMock).not.toHaveBeenCalled();
        expect(body.results[0].outcome).toBe('CONFIRMED');
    });

    it('ordre APPROVED → capture puis confirmation', async () => {
        getOrderMock.mockResolvedValue({
            captureId: null, orderStatus: 'APPROVED',
            paidAmount: null, paidCurrency: null, payerEmail: null,
        });
        captureOrderMock.mockResolvedValue({
            captureId: 'CAP-9', orderStatus: 'COMPLETED',
            paidAmount: '1250.00', paidCurrency: 'USD', payerEmail: null,
        });
        const body = await (await GET(req())).json();
        expect(captureOrderMock).toHaveBeenCalledWith('ORDER-1');
        expect(confirmMock).toHaveBeenCalledOnce();
        expect(body.results[0].outcome).toBe('CONFIRMED');
    });

    it('ordre VOIDED → annulation', async () => {
        getOrderMock.mockResolvedValue({
            captureId: null, orderStatus: 'VOIDED',
            paidAmount: null, paidCurrency: null, payerEmail: null,
        });
        const body = await (await GET(req())).json();
        expect(cancelMock).toHaveBeenCalledWith(expect.anything(), 'ORDER-1', 'order voided');
        expect(body.results[0].outcome).toBe('CANCELLED');
    });

    it('ordre CREATED de moins de 6 h → laissé en attente', async () => {
        getOrderMock.mockResolvedValue({
            captureId: null, orderStatus: 'CREATED',
            paidAmount: null, paidCurrency: null, payerEmail: null,
        });
        const body = await (await GET(req())).json();
        expect(cancelMock).not.toHaveBeenCalled();
        expect(confirmMock).not.toHaveBeenCalled();
        expect(body.results[0].outcome).toBe('STILL_PENDING');
    });

    it('ordre CREATED de plus de 6 h → annulation pour expiration', async () => {
        pendingRows = [row({ created_at: new Date(Date.now() - 7 * HOUR).toISOString() })];
        getOrderMock.mockResolvedValue({
            captureId: null, orderStatus: 'CREATED',
            paidAmount: null, paidCurrency: null, payerEmail: null,
        });
        const body = await (await GET(req())).json();
        expect(cancelMock).toHaveBeenCalledWith(expect.anything(), 'ORDER-1', 'order expired (6h)');
        expect(body.results[0].outcome).toBe('CANCELLED_EXPIRED');
    });

    it('ligne sans external_reference → sautée', async () => {
        pendingRows = [row({ external_reference: null })];
        const body = await (await GET(req())).json();
        expect(getOrderMock).not.toHaveBeenCalled();
        expect(body.results[0].outcome).toBe('SKIPPED_NO_ORDER');
    });

    it('une ligne en erreur n’empêche pas les suivantes', async () => {
        pendingRows = [row({ id: 'pay-1' }), row({ id: 'pay-2', external_reference: 'ORDER-2' })];
        getOrderMock
            .mockRejectedValueOnce(new Error('PayPal 500'))
            .mockResolvedValueOnce({
                captureId: 'CAP-2', orderStatus: 'COMPLETED',
                paidAmount: '1250.00', paidCurrency: 'USD', payerEmail: null,
            });
        const body = await (await GET(req())).json();
        expect(body.results[0].outcome).toBe('ERROR');
        expect(body.results[1].outcome).toBe('CONFIRMED');
        expect(body.reconciled).toBe(2);
    });
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

```bash
cd frontend && npx vitest run src/app/api/cron/paypal-reconcile-pending
```

- [ ] **Step 3 : Écrire le janitor**

Créer `frontend/src/app/api/cron/paypal-reconcile-pending/route.ts` :

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { getOrder, captureOrder } from '@/services/paypalService';
import { confirmPaypalPayment, cancelPaypalPayment } from '@/services/paypalConfirmation';
import { scopedLogger } from '@/lib/logger';

/**
 * GET /api/cron/paypal-reconcile-pending
 *
 * Janitor du rail PAYPAL : rattrape les lignes `payments` bloquées en
 * PROCESSING — webhook perdu ET armateur jamais revenu.
 *
 * CADENCE — c'est un janitor QUOTIDIEN, pas un filet temps réel. Le plan Vercel
 * refuse les crons sub-quotidiens (voir payments-reconcile-all). Ce n'est pas un
 * problème : la fenêtre de capture de 6 h est couverte par le webhook, que PayPal
 * retente pendant ~3 jours. Ce cron nettoie les traînards et ferme les ordres
 * expirés.
 *
 * Décisions par ligne (rail=PAYPAL, status=PROCESSING, âge > 10 min) :
 *   COMPLETED           → confirmation (la capture existe déjà chez PayPal)
 *   APPROVED            → capture puis confirmation
 *   VOIDED              → annulation
 *   autre, âge > 6 h    → annulation (l'ordre a expiré, PayPal ne l'honorera plus)
 *   autre, âge < 6 h    → laissé en attente
 *
 * Contrairement à stripe-reconcile-pending, la confirmation passe par
 * confirmPaypalPayment et déclenche donc reçu + e-mail + notification. C'est
 * volontaire : si le webhook a été perdu, personne d'autre ne les émettra, et la
 * garde de course interdit le doublon.
 *
 * Auth : `Authorization: Bearer ${CRON_SECRET}`. La garde vérifie aussi que le
 * secret est défini — sans ça, un env absent produirait la comparaison
 * « Bearer undefined », trivialement devinable.
 *
 * Limite de 100 lignes par exécution pour tenir dans le timeout de la fonction.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Âge minimum pour être éligible : laisse le chemin nominal finir. */
const RECONCILE_THRESHOLD_MS = 10 * 60 * 1000;
/** Un ordre PayPal non capturé expire au bout de 6 h. */
const ORDER_EXPIRY_MS = 6 * 60 * 60 * 1000;

const log = scopedLogger('paypal-reconcile');

interface PendingRow {
    id: string;
    external_reference: string | null;
    created_at: string;
    transaction_id: string | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization');
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const admin = createPlatformClient();
    const cutoff = new Date(Date.now() - RECONCILE_THRESHOLD_MS).toISOString();
    const expiryCutoffMs = Date.now() - ORDER_EXPIRY_MS;

    const { data: pending, error: selErr } = await admin
        .from('payments')
        .select('id, external_reference, created_at, transaction_id')
        .eq('rail', 'PAYPAL')
        .eq('status', 'PROCESSING')
        .lt('created_at', cutoff)
        .limit(100);

    if (selErr) {
        log.error('paypal_reconcile_select_failed', { error: selErr.message });
        return NextResponse.json({ error: 'select_failed' }, { status: 500 });
    }

    const rows = (pending ?? []) as PendingRow[];
    const results: { id: string; outcome: string }[] = [];

    for (const row of rows) {
        const orderId = row.external_reference;
        if (!orderId) {
            results.push({ id: row.id, outcome: 'SKIPPED_NO_ORDER' });
            continue;
        }

        try {
            const order = await getOrder(orderId);

            if (order.orderStatus === 'COMPLETED') {
                const { outcome } = await confirmPaypalPayment(admin, {
                    orderId,
                    captureId: order.captureId,
                    paidAmount: order.paidAmount,
                    paidCurrency: order.paidCurrency,
                    payerEmail: order.payerEmail,
                });
                results.push({ id: row.id, outcome });
                continue;
            }

            if (order.orderStatus === 'APPROVED') {
                // Approuvé mais jamais capturé : c'est précisément le trou que ce
                // cron existe pour boucher.
                const capture = await captureOrder(orderId);
                const { outcome } = await confirmPaypalPayment(admin, {
                    orderId,
                    captureId: capture.captureId,
                    paidAmount: capture.paidAmount,
                    paidCurrency: capture.paidCurrency,
                    payerEmail: capture.payerEmail,
                });
                results.push({ id: row.id, outcome });
                continue;
            }

            if (order.orderStatus === 'VOIDED') {
                await cancelPaypalPayment(admin, orderId, 'order voided');
                results.push({ id: row.id, outcome: 'CANCELLED' });
                continue;
            }

            if (new Date(row.created_at).getTime() < expiryCutoffMs) {
                await cancelPaypalPayment(admin, orderId, 'order expired (6h)');
                results.push({ id: row.id, outcome: 'CANCELLED_EXPIRED' });
                continue;
            }

            results.push({ id: row.id, outcome: 'STILL_PENDING' });
        } catch (e) {
            log.error('paypal_reconcile_row_failed', {
                paymentId: row.id,
                orderId,
                error: e instanceof Error ? e.message : String(e),
            });
            results.push({ id: row.id, outcome: 'ERROR' });
        }
    }

    log.info('paypal_reconcile_done', { reconciled: results.length });
    return NextResponse.json({ reconciled: results.length, results });
}
```

- [ ] **Step 4 : Lancer, vérifier que ça passe**

```bash
cd frontend && npx vitest run src/app/api/cron/paypal-reconcile-pending
```

Attendu : PASS, 13 tests.

- [ ] **Step 5 : Écrire le test du chaîneur**

Créer `frontend/src/app/api/cron/payments-reconcile-all/route.test.ts` en partant du test
existant du chaîneur Stripe, pour conserver ses assertions :

```bash
cd frontend && cat src/app/api/cron/stripe-reconcile-all/route.test.ts
```

Puis créer le nouveau test, en ajoutant le troisième sous-reconciler :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const paymentsMock = vi.fn();
const refundsMock = vi.fn();
const paypalMock = vi.fn();

vi.mock('../stripe-reconcile-pending/route', () => ({ GET: (...a: unknown[]) => paymentsMock(...a) }));
vi.mock('../stripe-refund-reconcile-pending/route', () => ({ GET: (...a: unknown[]) => refundsMock(...a) }));
vi.mock('../paypal-reconcile-pending/route', () => ({ GET: (...a: unknown[]) => paypalMock(...a) }));

import { GET } from './route';

function req(auth = 'Bearer secret-1'): NextRequest {
    return new Request('https://app.test/api/cron/payments-reconcile-all', {
        headers: auth ? { authorization: auth } : {},
    }) as unknown as NextRequest;
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
    process.env.CRON_SECRET = 'secret-1';
    paymentsMock.mockReset().mockResolvedValue(ok({ reconciled: 1 }));
    refundsMock.mockReset().mockResolvedValue(ok({ reconciled: 2 }));
    paypalMock.mockReset().mockResolvedValue(ok({ reconciled: 3 }));
});

describe('GET /api/cron/payments-reconcile-all', () => {
    it('401 sans secret valide', async () => {
        expect((await GET(req(''))).status).toBe(401);
    });

    it('401 si CRON_SECRET n’est pas configuré', async () => {
        delete process.env.CRON_SECRET;
        expect((await GET(req('Bearer undefined'))).status).toBe(401);
    });

    it('enchaîne les trois reconcilers et agrège leurs résultats', async () => {
        const body = await (await GET(req())).json();
        expect(paymentsMock).toHaveBeenCalledOnce();
        expect(refundsMock).toHaveBeenCalledOnce();
        expect(paypalMock).toHaveBeenCalledOnce();
        expect(body.payments.body).toEqual({ reconciled: 1 });
        expect(body.refunds.body).toEqual({ reconciled: 2 });
        expect(body.paypal.body).toEqual({ reconciled: 3 });
    });

    it('un reconciler qui throw n’empêche pas les autres', async () => {
        paymentsMock.mockRejectedValue(new Error('stripe boom'));
        const body = await (await GET(req())).json();
        expect(body.payments.error).toBe('stripe boom');
        expect(body.refunds.body).toEqual({ reconciled: 2 });
        expect(body.paypal.body).toEqual({ reconciled: 3 });
    });

    it('transmet la requête telle quelle (un seul header d’auth par exécution)', async () => {
        const r = req();
        await GET(r);
        expect(paymentsMock).toHaveBeenCalledWith(r);
        expect(paypalMock).toHaveBeenCalledWith(r);
    });
});
```

- [ ] **Step 6 : Écrire le chaîneur et retirer l'ancien**

Créer `frontend/src/app/api/cron/payments-reconcile-all/route.ts` :

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { GET as runPaymentReconcile } from '../stripe-reconcile-pending/route';
import { GET as runRefundReconcile } from '../stripe-refund-reconcile-pending/route';
import { GET as runPaypalReconcile } from '../paypal-reconcile-pending/route';

/**
 * GET /api/cron/payments-reconcile-all
 *
 * Créneau cron unique regroupant tous les reconcilers de paiement. Remplace
 * l'ancien `stripe-reconcile-all`, devenu inexact depuis l'ajout du rail PayPal.
 *
 * POURQUOI UN CHAÎNEUR — le plan Vercel refuse toute expression cron plus
 * fréquente qu'une fois par jour, et chaque entrée de `vercel.json` consomme un
 * créneau. Regrouper les trois reconcilers derrière un seul slot quotidien
 * (`0 9 * * *`) évite d'en ajouter à chaque nouveau rail.
 *
 * Compromis de cadence : un webhook manqué laisse un paiement PROCESSING ou un
 * remboursement APPROVED en attente jusqu'à ~24 h. Acceptable — les webhooks
 * sont fiables en régime normal et sont retentés par les providers ; ces
 * reconcilers sont une ceinture, pas la bretelle. Passer à Vercel Pro et
 * restaurer `*\/15 * * * *` ici si la réactivité devient contraignante.
 *
 * Chaque sous-handler garde sa propre garde CRON_SECRET, son export de route et
 * ses tests : ils restent appelables individuellement pour l'ops. Seule cette
 * route est planifiée.
 *
 * Auth : `Authorization: Bearer ${CRON_SECRET}`. Vercel envoie un seul header
 * d'auth par exécution — on transmet l'objet Request tel quel.
 *
 * Tolérance aux pannes : exécution séquentielle, chacun fail-soft. Si le
 * reconciler Stripe throw, les remboursements et PayPal tournent quand même ;
 * l'erreur apparaît comme une chaîne dans le sous-résultat.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization');
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const payments = await safeRun(() => runPaymentReconcile(req));
    const refunds = await safeRun(() => runRefundReconcile(req));
    const paypal = await safeRun(() => runPaypalReconcile(req));

    return NextResponse.json({ payments, refunds, paypal });
}

async function safeRun(
    fn: () => Promise<NextResponse>,
): Promise<{ status: number; body: unknown } | { error: string }> {
    try {
        const res = await fn();
        const body = await res.json().catch(() => null);
        return { status: res.status, body };
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}
```

Supprimer l'ancien chaîneur :

```bash
cd frontend && git rm src/app/api/cron/stripe-reconcile-all/route.ts \
                     src/app/api/cron/stripe-reconcile-all/route.test.ts
```

- [ ] **Step 7 : Repointer `vercel.json`**

Dans `frontend/vercel.json`, remplacer l'entrée :

```json
    {
      "path": "/api/cron/stripe-reconcile-all",
      "schedule": "0 9 * * *"
    },
```

par :

```json
    {
      "path": "/api/cron/payments-reconcile-all",
      "schedule": "0 9 * * *"
    },
```

Ne rien ajouter d'autre : le nombre total de crons reste inchangé.

- [ ] **Step 8 : Vérifier qu'aucune référence à l'ancienne route ne subsiste**

```bash
cd /c/Users/lecle/Workspace/africgreen && grep -rn "stripe-reconcile-all" --include=*.ts --include=*.json --include=*.md . | grep -v node_modules
```

Les seules occurrences acceptables sont dans des documents d'archive (`docs/superpowers/plans/`
antérieurs). Toute référence dans du code ou dans `vercel.json` doit être corrigée. Si un
runbook (`docs/runbooks/`) mentionne la route, le mettre à jour.

- [ ] **Step 9 : Lancer les tests des crons, la suite complète, puis commit**

```bash
cd frontend && npx vitest run src/app/api/cron && npx tsc --noEmit && npm run lint && npm test
cd /c/Users/lecle/Workspace/africgreen
git add frontend/src/app/api/cron/paypal-reconcile-pending/ \
        frontend/src/app/api/cron/payments-reconcile-all/ \
        frontend/vercel.json
git add -u frontend/src/app/api/cron/stripe-reconcile-all/
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" \
  -m "feat(payments): janitor de réconciliation PayPal

Regroupe les trois reconcilers sous payments-reconcile-all pour tenir dans
un créneau cron quotidien unique (limite du plan Vercel)."
```

---

## Task 10 : Interface PayDialog, bannières de retour et i18n

**Files:**
- Create: `frontend/src/components/owner/PayDialog/PaypalMark.tsx`
- Modify: `frontend/src/components/owner/PayDialog/usePayDialogContext.tsx:6`
- Modify: `frontend/src/components/owner/PayDialog/StepRailPicker.tsx:4,19-25`
- Modify: `frontend/src/components/owner/PayDialog/StepConfirm.tsx:49-55`
- Modify: `frontend/src/app/(dashboard)/dashboard/invoices/page.tsx`
- Modify: `frontend/src/components/owner/pages/OperatorInvoicesPage.tsx:26,29,118-127`
- Modify: `frontend/messages/{fr,en,pt,sw,ar,so}.json`
- Test: `frontend/src/components/owner/PayDialog/PayDialog.test.tsx` (existant, à étendre)

**Interfaces:**
- Consumes: le rail `PAYPAL` exposé par `/api/owner/payment-availability` (Task 5) et
  `initiatePayment` renvoyant `checkoutUrl` (Task 6).
- Produces: rien pour les autres tâches — c'est la couche terminale.

- [ ] **Step 1 : Écrire les tests qui échouent**

Lire d'abord le test existant pour réutiliser son harnais (mock de `fetch` sur
`payment-availability`, mock de `initiatePayment`, wrapper `NextIntlClientProvider`) :

```bash
cd frontend && sed -n 1,70p src/components/owner/PayDialog/PayDialog.test.tsx
```

Ajouter ensuite, en respectant ce harnais :

```ts
describe('rail PAYPAL', () => {
    it('affiche PayPal dans le picker quand le rail est éligible', async () => {
        availabilityResponse = {
            rails: [
                { rail: 'PAYPAL', eligible: true, providers: [{ provider: 'paypal', routes_rail: ['PAYPAL'], display_order: 0 }] },
            ],
        };
        renderPayDialog();
        expect(await screen.findByText('Payer avec PayPal')).toBeInTheDocument();
    });

    it('affiche PayPal désactivé avec le motif quand il est inéligible', async () => {
        availabilityResponse = {
            rails: [{ rail: 'PAYPAL', eligible: false, providers: [], reason: 'no_active_provider' }],
        };
        renderPayDialog();
        const button = (await screen.findByText('Payer avec PayPal')).closest('button');
        expect(button).toBeDisabled();
    });

    it('redirige vers l’URL de checkout PayPal à la confirmation', async () => {
        availabilityResponse = {
            rails: [
                { rail: 'PAYPAL', eligible: true, providers: [{ provider: 'paypal', routes_rail: ['PAYPAL'], display_order: 0 }] },
            ],
        };
        initiatePaymentMock.mockResolvedValue({
            id: 'pay-1', status: 'PROCESSING', transaction_id: 'tx-1',
            amount_usd_minor: 125000, checkoutUrl: 'https://paypal.com/approve/ORDER-1',
        });
        const assign = vi.fn();
        // Le composant fait `window.location.href = …` — capturer l'affectation.
        Object.defineProperty(window, 'location', {
            configurable: true,
            value: { get href() { return ''; }, set href(v: string) { assign(v); } },
        });

        renderPayDialog();
        await userEvent.click(await screen.findByText('Payer avec PayPal'));
        await userEvent.click(await screen.findByText('Suivant'));
        await userEvent.click(await screen.findByText('Confirmer'));

        await waitFor(() => {
            expect(assign).toHaveBeenCalledWith('https://paypal.com/approve/ORDER-1');
        });
    });

    it('ne demande aucun paramètre de rail pour PayPal', async () => {
        availabilityResponse = {
            rails: [
                { rail: 'PAYPAL', eligible: true, providers: [{ provider: 'paypal', routes_rail: ['PAYPAL'], display_order: 0 }] },
            ],
        };
        renderPayDialog();
        await userEvent.click(await screen.findByText('Payer avec PayPal'));
        // Aucun champ requis : le bouton Suivant mène directement à la confirmation.
        expect(screen.queryByLabelText(/référence bancaire/i)).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/téléphone/i)).not.toBeInTheDocument();
    });
});
```

Adapter les libellés de bouton (`Suivant`, `Confirmer`) à ceux réellement rendus par le harnais
du fichier — le lire avant d'écrire.

- [ ] **Step 2 : Lancer, vérifier l'échec**

```bash
cd frontend && npx vitest run src/components/owner/PayDialog
```

Attendu : ÉCHEC — le rail PAYPAL n'est pas dans `RAIL_META`, donc `meta` est `undefined` et le
rendu casse.

- [ ] **Step 3 : Créer le logo PayPal**

Créer `frontend/src/components/owner/PayDialog/PaypalMark.tsx` :

```tsx
/**
 * Marque PayPal simplifiée, en SVG inline.
 *
 * `lucide-react` ne fournit aucune icône de marque. Au moment de choisir un
 * moyen de paiement, la reconnaissance visuelle du prestataire compte : une
 * icône générique dégrade la confiance. Ce glyphe reprend la forme des deux « P »
 * imbriqués, sans prétendre reproduire le logo officiel — il vaut comme repère,
 * pas comme usage de marque.
 *
 * `currentColor` est utilisé pour que la couleur vienne du conteneur, comme les
 * icônes lucide voisines.
 */
export function PaypalMark({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {/* P arrière */}
            <path d="M5 21V5h5.5a4 4 0 0 1 0 8H7" />
            {/* P avant, décalé */}
            <path d="M11 21v-4h3.5a4 4 0 0 0 0-8H13" />
        </svg>
    );
}
```

- [ ] **Step 4 : Étendre le type `Rail`**

Dans `frontend/src/components/owner/PayDialog/usePayDialogContext.tsx`, ligne 6 :

```ts
export type Rail = 'STRIPE' | 'PAYPAL' | 'WIRE_TRANSFER' | 'MOBILE_MONEY' | 'THIRD_PARTY' | 'WALLET';
```

L'ordre de cette union doit rester cohérent avec `OWNER_RAILS` de
`api/owner/payment-availability/route.ts` (Task 5) — les deux listes décrivent le même ensemble.

- [ ] **Step 5 : Ajouter PayPal au picker**

Dans `frontend/src/components/owner/PayDialog/StepRailPicker.tsx` :

1. Import du logo, après les imports lucide :

```ts
import { PaypalMark } from './PaypalMark';
```

2. Étendre `RAIL_META` — `#0070BA` est le bleu PayPal :

```ts
const RAIL_META: Record<Rail, { icon: React.ComponentType<{ className?: string }>; color: string; key: string }> = {
    STRIPE:        { icon: CreditCard, color: '#635BFF', key: 'stripe' },
    PAYPAL:        { icon: PaypalMark, color: '#0070BA', key: 'paypal' },
    WIRE_TRANSFER: { icon: Banknote,   color: '#10B981', key: 'wire' },
    MOBILE_MONEY:  { icon: Smartphone, color: '#1DC9B7', key: 'momo' },
    THIRD_PARTY:   { icon: Briefcase,  color: '#FF4800', key: 'third' },
    WALLET:        { icon: Wallet,     color: '#8B5CF6', key: 'wallet' },
};
```

Rien d'autre à changer : l'ordre d'affichage vient de la réponse de l'API, et le `hint` est déjà
paramétré par `provider`.

- [ ] **Step 6 : Élargir la redirection dans `StepConfirm`**

Dans `frontend/src/components/owner/PayDialog/StepConfirm.tsx`, remplacer le bloc STRIPE
(lignes 49-55) par :

```ts
                // Rails à checkout externe (STRIPE, PAYPAL) : l'action renvoie
                // une checkoutUrl, on y envoie le navigateur.
                //
                // STRIPE : le webhook confirme le paiement.
                // PAYPAL : la route de retour /api/payments/paypal/return capture
                // et confirme, avec le webhook et le cron en filet.
                const isCheckoutRail = ctx.rail === 'STRIPE' || ctx.rail === 'PAYPAL';
                if (isCheckoutRail && 'checkoutUrl' in result && result.checkoutUrl) {
                    window.location.href = result.checkoutUrl as string;
                    return; // ne pas appeler onClose / router.refresh — la page va se décharger
                }
```

- [ ] **Step 7 : Lire `?paypal=` sur la page factures**

Dans `frontend/src/app/(dashboard)/dashboard/invoices/page.tsx`, remplacer le corps de
`InvoicesRoute` :

```tsx
export default async function InvoicesRoute({
    searchParams,
}: {
    searchParams: Promise<{ stripe?: string; paypal?: string }>;
}) {
    const principal = await requirePrincipal();
    if (principal.kind === 'operator') {
        const params = await searchParams;
        const stripeReturn =
            params.stripe === 'success'
                ? 'success'
                : params.stripe === 'cancel'
                  ? 'cancel'
                  : null;
        const paypalReturn =
            params.paypal === 'success' ||
            params.paypal === 'cancel' ||
            params.paypal === 'pending' ||
            params.paypal === 'failed'
                ? params.paypal
                : null;
        return (
            <OperatorInvoicesPage
                principal={principal}
                stripeReturn={stripeReturn}
                paypalReturn={paypalReturn}
            />
        );
    }
    return <InvoicesPage />;
}
```

- [ ] **Step 8 : Afficher les bannières PayPal**

Dans `frontend/src/components/owner/pages/OperatorInvoicesPage.tsx` :

1. Étendre `Props` :

```ts
export type PaypalReturn = 'success' | 'cancel' | 'pending' | 'failed';

interface Props {
    principal: Extract<Principal, { kind: 'operator' }>;
    stripeReturn?: 'success' | 'cancel' | null;
    paypalReturn?: PaypalReturn | null;
}
```

2. Étendre la signature :

```ts
export async function OperatorInvoicesPage({
    principal,
    stripeReturn = null,
    paypalReturn = null,
}: Props) {
```

3. Après les deux bannières `stripeReturn` existantes, ajouter :

```tsx
            {paypalReturn && (
                <div
                    className={`rounded-xl border p-3 mb-4 text-sm ${PAYPAL_BANNER_STYLE[paypalReturn]}`}
                >
                    {t(`paypalReturn.${paypalReturn}`)}
                </div>
            )}
```

4. Déclarer la table de styles au niveau module, à côté des autres constantes du fichier :

```ts
/**
 * Teintes des bannières de retour PayPal, alignées sur celles de Stripe :
 * vert = encaissé, ambre = en attente ou annulé, rouge = échec.
 */
const PAYPAL_BANNER_STYLE: Record<PaypalReturn, string> = {
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    cancel:  'border-amber-500/30 bg-amber-500/10 text-amber-200',
    pending: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    failed:  'border-red-500/30 bg-red-500/10 text-red-200',
};
```

5. Mettre à jour le commentaire d'en-tête du fichier : « et les bannières `?stripe=` » devient
   « et les bannières `?stripe=` / `?paypal=` ».

- [ ] **Step 9 : Ajouter les traductions dans les 6 locales**

Dans chaque `frontend/messages/<locale>.json`, ajouter sous `OwnerPortal.payDialog.rail` une
entrée `paypal`, sous `OwnerPortal.payDialog.paramsHint` une entrée `paypal`, et sous
`OwnerPortal.invoices` un objet `paypalReturn`.

`fr.json` :

```json
"paypal": { "label": "Payer avec PayPal", "hint": "Instantané — solde PayPal ou carte bancaire" }
```
```json
"paypal": "Vous serez redirigé vers PayPal pour valider le paiement."
```
```json
"paypalReturn": {
  "success": "Paiement PayPal confirmé. Votre facture est réglée.",
  "cancel": "Paiement PayPal annulé. Aucun montant n'a été prélevé.",
  "pending": "Paiement PayPal en cours de vérification. Votre facture sera mise à jour sous peu.",
  "failed": "Le paiement PayPal n'a pas pu être finalisé. Aucun montant n'a été prélevé — réessayez ou choisissez un autre moyen de paiement."
}
```

`en.json` :

```json
"paypal": { "label": "Pay with PayPal", "hint": "Instant — PayPal balance or card" }
```
```json
"paypal": "You will be redirected to PayPal to approve the payment."
```
```json
"paypalReturn": {
  "success": "PayPal payment confirmed. Your invoice is settled.",
  "cancel": "PayPal payment cancelled. Nothing was charged.",
  "pending": "PayPal payment is being verified. Your invoice will update shortly.",
  "failed": "The PayPal payment could not be completed. Nothing was charged — try again or choose another payment method."
}
```

`pt.json` :

```json
"paypal": { "label": "Pagar com PayPal", "hint": "Instantâneo — saldo PayPal ou cartão" }
```
```json
"paypal": "Será redirecionado para o PayPal para aprovar o pagamento."
```
```json
"paypalReturn": {
  "success": "Pagamento PayPal confirmado. A sua fatura está liquidada.",
  "cancel": "Pagamento PayPal cancelado. Nenhum valor foi cobrado.",
  "pending": "O pagamento PayPal está a ser verificado. A sua fatura será atualizada em breve.",
  "failed": "Não foi possível concluir o pagamento PayPal. Nenhum valor foi cobrado — tente novamente ou escolha outro método de pagamento."
}
```

`sw.json` :

```json
"paypal": { "label": "Lipa na PayPal", "hint": "Papo hapo — salio la PayPal au kadi" }
```
```json
"paypal": "Utaelekezwa kwa PayPal ili kuidhinisha malipo."
```
```json
"paypalReturn": {
  "success": "Malipo ya PayPal yamethibitishwa. Ankara yako imelipwa.",
  "cancel": "Malipo ya PayPal yamefutwa. Hakuna kiasi kilichotozwa.",
  "pending": "Malipo ya PayPal yanahakikiwa. Ankara yako itasasishwa hivi karibuni.",
  "failed": "Malipo ya PayPal hayakukamilika. Hakuna kiasi kilichotozwa — jaribu tena au chagua njia nyingine ya malipo."
}
```

`ar.json` :

```json
"paypal": { "label": "الدفع عبر PayPal", "hint": "فوري — رصيد PayPal أو بطاقة بنكية" }
```
```json
"paypal": "ستتم إعادة توجيهك إلى PayPal للموافقة على الدفع."
```
```json
"paypalReturn": {
  "success": "تم تأكيد الدفع عبر PayPal. تمت تسوية فاتورتك.",
  "cancel": "تم إلغاء الدفع عبر PayPal. لم يتم خصم أي مبلغ.",
  "pending": "جارٍ التحقق من الدفع عبر PayPal. سيتم تحديث فاتورتك قريبًا.",
  "failed": "لم يكتمل الدفع عبر PayPal. لم يتم خصم أي مبلغ — أعد المحاولة أو اختر طريقة دفع أخرى."
}
```

`so.json` :

```json
"paypal": { "label": "Ku bixi PayPal", "hint": "Isla markiiba — hadhaaga PayPal ama kaar bangi" }
```
```json
"paypal": "Waxaa laguu weecin doonaa PayPal si aad lacag-bixinta u ansixiso."
```
```json
"paypalReturn": {
  "success": "Lacag-bixinta PayPal waa la xaqiijiyay. Biilkaaga waa la bixiyay.",
  "cancel": "Lacag-bixinta PayPal waa la joojiyay. Lacag lama qaadin.",
  "pending": "Lacag-bixinta PayPal waa la hubinayaa. Biilkaaga wuu cusboonaan doonaa dhawaan.",
  "failed": "Lacag-bixinta PayPal lama dhammaystirin. Lacag lama qaadin — isku day mar kale ama dooro hab kale."
}
```

`pt`, `sw`, `ar` et `so` sont la baseline de traduction du projet, à relire par un locuteur
natif comme le reste des messages — le noter au récapitulatif, pas au-delà.

- [ ] **Step 10 : Vérifier la parité des clés entre locales**

```bash
cd frontend && node -e "
const fs=require('fs');
const locales=['fr','en','pt','sw','ar','so'];
const paths=[
  ['OwnerPortal','payDialog','rail','paypal','label'],
  ['OwnerPortal','payDialog','rail','paypal','hint'],
  ['OwnerPortal','payDialog','paramsHint','paypal'],
  ['OwnerPortal','invoices','paypalReturn','success'],
  ['OwnerPortal','invoices','paypalReturn','cancel'],
  ['OwnerPortal','invoices','paypalReturn','pending'],
  ['OwnerPortal','invoices','paypalReturn','failed'],
];
let bad=0;
for(const l of locales){
  const m=JSON.parse(fs.readFileSync('messages/'+l+'.json','utf8'));
  for(const p of paths){
    const v=p.reduce((o,k)=>o&&o[k],m);
    if(typeof v!=='string'||!v.trim()){ console.log('MANQUANT',l,p.join('.')); bad++; }
  }
}
console.log(bad===0?'OK — 7 cles x 6 locales':'ECHEC: '+bad+' cles manquantes');
process.exit(bad===0?0:1);
"
- [ ] **Step 11 : Lancer les tests UI**

```bash
cd frontend && npx vitest run src/components/owner && npx tsc --noEmit && npm run lint
```

Attendu : PASS. Le typecheck peut signaler d'autres `Record<Rail, …>` devenus non exhaustifs —
les compléter avec l'entrée `PAYPAL`.

- [ ] **Step 12 : Suite complète et commit**

```bash
cd frontend && npm test
cd /c/Users/lecle/Workspace/africgreen
git add frontend/src/components/owner/PayDialog/ \
        frontend/src/components/owner/pages/OperatorInvoicesPage.tsx \
        'frontend/src/app/(dashboard)/dashboard/invoices/page.tsx' \
        frontend/messages/fr.json frontend/messages/en.json frontend/messages/pt.json \
        frontend/messages/sw.json frontend/messages/ar.json frontend/messages/so.json
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" \
  -m "feat(payments): PayPal dans le dialogue de paiement armateur

Rail dans le picker, redirection vers le checkout, bannières de retour
et traductions dans les 6 locales."
```

---

## Vérification finale

À exécuter une fois les 10 tâches terminées, avant de rendre la main.

- [ ] **Suite complète et qualité**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm test
```

Les trois doivent être verts. Reporter les chiffres réels (tests passés / échoués), pas une
appréciation.

- [ ] **Build de production**

```bash
cd frontend && npm run build
```

Attendu : succès. Les trois nouvelles routes doivent apparaître dans la sortie
(`/api/payments/paypal/return`, `/api/webhooks/paypal`, `/api/cron/paypal-reconcile-pending`,
`/api/cron/payments-reconcile-all`), et `/api/cron/stripe-reconcile-all` doit avoir disparu.

- [ ] **Aucun secret committé**

```bash
cd /c/Users/lecle/Workspace/africgreen && git log --oneline main..HEAD && \
  git diff main..HEAD -- frontend/ supabase/ | grep -nE "PAYPAL_CLIENT_SECRET *=|access_token.*[A-Za-z0-9]{20}" || echo "OK — aucun secret en dur"
```

- [ ] **Récapitulatif au PO**

Rédiger un récapitulatif court couvrant :

1. Ce qui est livré, tâche par tâche.
2. **Ce qui n'est pas fait et pourquoi** : remboursements PayPal automatisés (hors périmètre,
   voir spec §2), chemin legacy `/dashboard` intouché, aucun test E2E Playwright.
3. **Ce qui reste à faire côté ops** (spec §10) : appliquer 113 puis 114, créer l'app PayPal
   sandbox, renseigner les 4 variables d'environnement, déclarer le webhook et reporter son ID,
   basculer `feature.online_payment_paypal_enabled`.
4. Les traductions `pt`/`sw`/`ar`/`so` à relire par un natif.
5. Si la stack Supabase locale n'a pas pu tourner : le dire, et lister les tests SQL non exécutés.

Ne pas pousser, ne pas ouvrir de PR : le PO valide après recette.

---

## Auto-revue du plan

**Couverture de la spec** — chaque section a sa tâche :

| Spec | Tâche |
|---|---|
| §2 décisions de cadrage | portées par les Global Constraints et les commentaires de code |
| §3 architecture (3 modules) | Tasks 1, 3, 4 |
| §3 routes | Tasks 7, 8, 9 |
| §4.1 flux nominal | Tasks 6, 7 |
| §4.2 filets + événements webhook | Tasks 8, 9 |
| §4.3 cadence cron / contrainte Vercel | Task 9 (Steps 6-8) |
| §4.4 idempotence | Task 4 (garde de course, tests dédiés) + Task 2 (index unique) |
| §4.5 sécurité du montant | Task 4 (`amountMismatch` + 5 tests) |
| §4.6 piège `invoice_id` | Task 1 (test explicite qu'il n'est jamais envoyé) |
| §4.7 contrat `confirmPaypalPayment` | Task 4 |
| §5 base de données | Task 2 |
| §6 configuration + 7ᵉ flag | Tasks 1, 5 |
| §7 interface + i18n | Task 10 |
| §8 gestion des erreurs | réparti : Task 6 (credentials, createOrder), Task 7 (token, appartenance, capture), Task 8 (signature), Task 4 (montant, acteur système, recompute) |
| §9 tests | chaque tâche porte les siens ; non-régression Stripe en Task 3 Step 6 |
| §10 déploiement | Vérification finale, point 3 |

**Cohérence des types** — vérifiée :

- `PaypalCapture` (Task 1) alimente `PaypalConfirmInput` (Task 4) : les champs `captureId`,
  `paidAmount`, `paidCurrency`, `payerEmail` portent les mêmes noms des deux côtés ; seul
  `orderStatus` n'est pas transmis (l'appelant l'utilise pour décider).
- `ConfirmedPaymentContext` (Task 3) est construit à l'identique par le webhook Stripe (Task 3
  Step 5) et par `confirmPaypalPayment` (Task 4).
- `Rail` (Task 10) et `OWNER_RAILS` (Task 5) et `OWNER_RAILS`/`ALL_RAILS` (Task 6) contiennent
  tous `PAYPAL`.
- `PaymentRail` (Task 2) est la seule union côté `paymentService.ts` ; `PaymentProvider` reste
  inchangé.
- `paypalConfigured()` est consommé par Task 5 et Task 6 sous le même nom.

**Périmètre** — un seul sous-système (le rail de paiement), 10 tâches, chacune avec un livrable
testable indépendamment. Pas de découpage supplémentaire nécessaire.
