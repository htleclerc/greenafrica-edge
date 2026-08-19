# Moteur de relance + traçabilité (B1) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque relance de pro-forma impayée (courtoise J+3/J+7 et contentieuse J+15/J+30/J+45) écrit une entrée durable dans `collection_reminders`, via un moteur TypeScript qui remplace le pg_cron existant et réutilise l'infra d'envoi e-mail éprouvée.

**Architecture:** Un service pur `collectionReminderService` décide du palier dû (âge × déjà-envoyé × statut × réponse débiteur). Une route Vercel cron TS `/api/cron/collection-reminders` scanne les pro-formas PENDING/OVERDUE, résout les destinataires via `resolveInvoiceRecipients` (chantier A), insère la notif in-app (`notifyOwner` avec `skipEmail:true`) puis la ligne de registre. Le `notification-email-loop` existant envoie l'e-mail. Le pg_cron 065 est désactivé.

**Tech Stack:** Next.js 15 / TypeScript strict / Supabase (PostgREST) / pg_cron / Vitest.

**Spec:** [2026-07-28-moteur-relance-tracabilite-design.md](../specs/2026-07-28-moteur-relance-tracabilite-design.md)

## Global Constraints

- TypeScript strict, `any` interdit. Commits atomiques humanisés, auteur `Loic Leclerc <leclerc@drwintech.com>` via `git commit --author=`. Jamais de `Co-Authored-By: Claude` ni « Generated with Claude Code ». Staging explicite (paths).
- Paliers automatiques : `J3` (J+3), `J7` (J+7), `J15` (J+15), `J30` (J+30), `J45` (J+45). `BAILIFF`/`JUDICIAL` = manuels (chantier B2, hors périmètre).
- Un envoi n'écrit une ligne `collection_reminders` que si le palier n'y est pas déjà (unicité `(transaction_id, tier)`, mig 094).
- Règles d'arrêt/pause dans `dueTier` : escalade seulement si `status ∈ {PENDING, OVERDUE}` ; `DISPUTE` (ou statut `DISPUTED`) → pause ; `PAYMENT_PROMISE` → grâce 7 j ; `SILENT`/`ACKNOWLEDGE` → continue.
- Ordre d'écriture : **notif `owner_notifications` d'abord, registre `collection_reminders` ensuite** (une trace n'existe jamais sans notif ⇒ e-mail déclenché).
- Pas de double e-mail : le cron insère la notif via `notifyOwner(..., { skipEmail: true })` ; seul le `notification-email-loop` envoie.
- Tests depuis `frontend/` : `cd frontend && npx vitest run <chemin>`. Ne pas dégrader le baseline lint (157 problèmes / 62 erreurs sur `develop`).

---

### Task 1 : Migration — paliers J3/J7, CC huissier, désactivation pg_cron 065

**Files:**
- Create: `supabase/migrations/110_collection_reminder_tiers.sql`

**Interfaces:**
- Produces: valeurs enum `reminder_tier` `J3`/`J7` ; colonne `jurisdiction_billing_cc.bailiff_cc_emails TEXT[]` ; job pg_cron `proforma-reminders-daily` désactivé.

- [ ] **Step 1 : Écrire la migration**

Créer `supabase/migrations/110_collection_reminder_tiers.sql` :

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 110: paliers de relance précoces + CC huissier + bascule cron
--
-- B1 (moteur de relance). Étend reminder_tier (mig 094) avec les rappels
-- courtois J3/J7 pour que TOUTE relance figure dans le registre collection_reminders.
-- Ajoute le CC cabinet huissier par juridiction (table privée mig 109). Désactive
-- le pg_cron 065 : remplacé par la route TS /api/cron/collection-reminders, qui
-- réutilise la cascade destinataire TS (resolveInvoiceRecipients) au lieu de la
-- dupliquer en plpgsql.
-- ─────────────────────────────────────────────────────────────────────────────

-- ALTER TYPE ... ADD VALUE ne peut pas cohabiter avec un usage de la valeur dans
-- la même transaction ; ces ajouts sont donc en tête, isolés.
ALTER TYPE public.reminder_tier ADD VALUE IF NOT EXISTS 'J3' BEFORE 'J15';
ALTER TYPE public.reminder_tier ADD VALUE IF NOT EXISTS 'J7' BEFORE 'J15';

ALTER TABLE public.jurisdiction_billing_cc
  ADD COLUMN IF NOT EXISTS bailiff_cc_emails TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.jurisdiction_billing_cc.bailiff_cc_emails IS
  'Cabinet huissier en copie des relances à partir de J45. Voir collectionReminderService.';

-- Désactive l'ancien enqueueur pg_cron (Plan 7F mig 065). Idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'proforma-reminders-daily') THEN
    PERFORM cron.unschedule('proforma-reminders-daily');
  END IF;
END $$;

-- DOWN:
-- SELECT cron.schedule('proforma-reminders-daily','0 8 * * *',$c$ SELECT public.enqueue_proforma_reminders(); $c$);
-- ALTER TABLE public.jurisdiction_billing_cc DROP COLUMN IF EXISTS bailiff_cc_emails;
-- -- NB: on ne retire pas J3/J7 de l'enum (Postgres ne supporte pas DROP VALUE).
```

- [ ] **Step 2 : Vérifier la forme (dry syntax) et l'idempotence**

Run (si un Postgres local/staging est accessible) :
`node scripts/db-query.mjs "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='reminder_tier' ORDER BY e.enumsortorder"`
Expected AVANT migration : `J15, J30, J45, BAILIFF, JUDICIAL`. La migration s'applique via `node scripts/db-migrate.mjs` (à faire à la bascule, pas ici — env partagé).

Si pas de DB : relire la migration, confirmer que les deux `ADD VALUE` sont en tête, avant tout usage, et que le bloc `unschedule` est gardé par un `EXISTS`.

- [ ] **Step 3 : Commit**

```bash
git add supabase/migrations/110_collection_reminder_tiers.sql
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(collections): paliers de relance J3/J7, CC huissier, bascule du cron"
```

---

### Task 2 : Service pur `collectionReminderService`

**Files:**
- Create: `frontend/src/services/collectionReminderService.ts`
- Test: `frontend/src/services/collectionReminderService.test.ts`

**Interfaces:**
- Produces:
  - `type ReminderTier = 'J3' | 'J7' | 'J15' | 'J30' | 'J45'`
  - `type DebtorResponseType = 'SILENT' | 'ACKNOWLEDGE' | 'DISPUTE' | 'PAYMENT_PROMISE' | 'PARTIAL_PAYMENT' | 'PAID' | 'REFUSED'`
  - `tierForAge(ageDays: number): ReminderTier | null`
  - `dueTier(input: DueTierInput): ReminderTier | null` où `DueTierInput = { status: string; ageDays: number; sentTiers: ReminderTier[]; latestResponse: DebtorResponseType | null; latestResponseAt: Date | null; now: Date }`
  - `reminderTemplate(tier: ReminderTier): { templateId: string; tone: 'courtesy' | 'amicable' | 'formal' | 'pre-bailiff' }`
  - `PAYMENT_PROMISE_GRACE_DAYS = 7`
  - `AUTO_TIERS: ReminderTier[]` (ordre croissant)

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/services/collectionReminderService.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { tierForAge, dueTier, reminderTemplate, AUTO_TIERS } from './collectionReminderService';

describe('tierForAge', () => {
    it.each([
        [0, null], [2, null],
        [3, 'J3'], [6, 'J3'],
        [7, 'J7'], [14, 'J7'],
        [15, 'J15'], [29, 'J15'],
        [30, 'J30'], [44, 'J30'],
        [45, 'J45'], [90, 'J45'],
    ])('âge %i jours → palier %s', (age, expected) => {
        expect(tierForAge(age)).toBe(expected);
    });
});

describe('dueTier', () => {
    const base = {
        status: 'PENDING',
        ageDays: 15,
        sentTiers: [] as ReturnType<typeof AUTO_TIERS.slice>,
        latestResponse: null,
        latestResponseAt: null,
        now: new Date('2026-07-28T00:00:00Z'),
    };

    it('renvoie le palier attendu quand rien n\'a encore été envoyé', () => {
        expect(dueTier({ ...base, ageDays: 15 })).toBe('J15');
    });

    it('ne renvoie rien quand le palier de cet âge a déjà été envoyé', () => {
        expect(dueTier({ ...base, ageDays: 15, sentTiers: ['J3', 'J7', 'J15'] })).toBeNull();
    });

    it('renvoie le palier le plus récent atteint, pas un déjà envoyé', () => {
        // âge 30 → J30 attendu ; J3/J7/J15 déjà faits, J30 non.
        expect(dueTier({ ...base, ageDays: 30, sentTiers: ['J3', 'J7', 'J15'] })).toBe('J30');
    });

    it('arrête l\'escalade hors PENDING/OVERDUE', () => {
        for (const status of ['PAID', 'EXEMPT', 'VOID', 'WAIVED', 'CANCELLED']) {
            expect(dueTier({ ...base, status, ageDays: 45 })).toBeNull();
        }
    });

    it('escalade sur OVERDUE comme sur PENDING', () => {
        expect(dueTier({ ...base, status: 'OVERDUE', ageDays: 45 })).toBe('J45');
    });

    it('met en pause sur une contestation (réponse DISPUTE)', () => {
        expect(dueTier({ ...base, ageDays: 45, latestResponse: 'DISPUTE' })).toBeNull();
    });

    it('met en pause sur un statut DISPUTED', () => {
        expect(dueTier({ ...base, status: 'DISPUTED', ageDays: 45 })).toBeNull();
    });

    it('respecte la grâce de 7 jours après une promesse de paiement', () => {
        const promiseAt = new Date('2026-07-25T00:00:00Z'); // 3 j avant now
        expect(dueTier({ ...base, ageDays: 45, latestResponse: 'PAYMENT_PROMISE', latestResponseAt: promiseAt })).toBeNull();
    });

    it('reprend l\'escalade une fois la grâce de 7 jours expirée', () => {
        const promiseAt = new Date('2026-07-20T00:00:00Z'); // 8 j avant now
        expect(dueTier({ ...base, ageDays: 45, latestResponse: 'PAYMENT_PROMISE', latestResponseAt: promiseAt })).toBe('J45');
    });

    it('continue l\'escalade sur SILENT ou ACKNOWLEDGE', () => {
        expect(dueTier({ ...base, ageDays: 45, latestResponse: 'SILENT' })).toBe('J45');
        expect(dueTier({ ...base, ageDays: 45, latestResponse: 'ACKNOWLEDGE' })).toBe('J45');
    });

    it('ne renvoie rien sous J+3', () => {
        expect(dueTier({ ...base, ageDays: 1 })).toBeNull();
    });
});

describe('reminderTemplate', () => {
    it('associe chaque palier à un ton', () => {
        expect(reminderTemplate('J3').tone).toBe('courtesy');
        expect(reminderTemplate('J7').tone).toBe('courtesy');
        expect(reminderTemplate('J15').tone).toBe('amicable');
        expect(reminderTemplate('J30').tone).toBe('formal');
        expect(reminderTemplate('J45').tone).toBe('pre-bailiff');
    });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npx vitest run src/services/collectionReminderService.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

Créer `frontend/src/services/collectionReminderService.ts` :

```ts
// Logique pure du moteur de relance : quel palier est dû pour une pro-forma,
// selon son âge, ce qui a déjà été envoyé, son statut et la dernière réponse du
// débiteur. Aucun accès base/réseau — testable en isolation.

export type ReminderTier = 'J3' | 'J7' | 'J15' | 'J30' | 'J45';

export type DebtorResponseType =
    | 'SILENT' | 'ACKNOWLEDGE' | 'DISPUTE' | 'PAYMENT_PROMISE'
    | 'PARTIAL_PAYMENT' | 'PAID' | 'REFUSED';

/** Paliers automatiques, du plus précoce au plus tardif, avec leur seuil en jours. */
const TIER_THRESHOLDS: ReadonlyArray<{ tier: ReminderTier; minAge: number }> = [
    { tier: 'J3', minAge: 3 },
    { tier: 'J7', minAge: 7 },
    { tier: 'J15', minAge: 15 },
    { tier: 'J30', minAge: 30 },
    { tier: 'J45', minAge: 45 },
];

export const AUTO_TIERS: ReminderTier[] = TIER_THRESHOLDS.map((t) => t.tier);

/** Nombre de jours de grâce accordés après une promesse de paiement. */
export const PAYMENT_PROMISE_GRACE_DAYS = 7;

/** Statuts de transaction pour lesquels l'escalade continue. Tout autre = arrêt. */
const ESCALATABLE_STATUSES = new Set(['PENDING', 'OVERDUE']);

/** Palier attendu pour un âge donné : le plus tardif dont le seuil est atteint. */
export function tierForAge(ageDays: number): ReminderTier | null {
    let match: ReminderTier | null = null;
    for (const { tier, minAge } of TIER_THRESHOLDS) {
        if (ageDays >= minAge) match = tier;
    }
    return match;
}

export interface DueTierInput {
    status: string;
    ageDays: number;
    sentTiers: ReminderTier[];
    latestResponse: DebtorResponseType | null;
    latestResponseAt: Date | null;
    now: Date;
}

/**
 * Palier à envoyer cette passe, ou null s'il n'y a rien à faire.
 *
 * Ordre des gardes : arrêt (statut de clôture ou contesté) → pause (DISPUTE,
 * grâce PAYMENT_PROMISE) → palier attendu pour l'âge → idempotence (déjà envoyé).
 */
export function dueTier(input: DueTierInput): ReminderTier | null {
    // Arrêt : la créance n'est plus recouvrable automatiquement.
    if (!ESCALATABLE_STATUSES.has(input.status)) return null;

    // Pause : une créance contestée ne s'escalade pas tant qu'elle n'est pas tranchée.
    if (input.status === 'DISPUTED' || input.latestResponse === 'DISPUTE') return null;

    // Pause : grâce après une promesse de paiement.
    if (input.latestResponse === 'PAYMENT_PROMISE' && input.latestResponseAt) {
        const graceEnd = new Date(
            input.latestResponseAt.getTime() + PAYMENT_PROMISE_GRACE_DAYS * 86_400_000,
        );
        if (input.now < graceEnd) return null;
    }

    const expected = tierForAge(input.ageDays);
    if (!expected) return null;

    // Idempotence : ce palier a déjà été envoyé.
    if (input.sentTiers.includes(expected)) return null;

    return expected;
}

/** Ton du message par palier — pilote le sujet/corps de l'e-mail. */
export function reminderTemplate(
    tier: ReminderTier,
): { templateId: string; tone: 'courtesy' | 'amicable' | 'formal' | 'pre-bailiff' } {
    switch (tier) {
        case 'J3':
        case 'J7':
            return { templateId: `${tier}_courtesy_reminder`, tone: 'courtesy' };
        case 'J15':
            return { templateId: 'J15_amicale_reminder', tone: 'amicable' };
        case 'J30':
            return { templateId: 'J30_formelle_notice', tone: 'formal' };
        case 'J45':
            return { templateId: 'J45_pre_bailiff_notice', tone: 'pre-bailiff' };
    }
}
```

Note : le test `dueTier` avec `status: 'DISPUTED'` passe par le premier garde (`DISPUTED` n'est pas dans `ESCALATABLE_STATUSES`) — retour `null` correct. Le second garde couvre `latestResponse === 'DISPUTE'` sur une créance encore PENDING.

- [ ] **Step 4 : Lancer les tests**

Run: `cd frontend && npx vitest run src/services/collectionReminderService.test.ts`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/services/collectionReminderService.ts frontend/src/services/collectionReminderService.test.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(collections): logique pure du palier de relance dû (âge, statut, réponse débiteur)"
```

---

### Task 3 : E-mail de relance sensible au palier

**Files:**
- Modify: `frontend/src/services/emailService.ts:612-645`
- Modify: `frontend/src/services/notificationEmailDispatch.ts:73-80`
- Test: `frontend/src/services/emailService.reminder.test.ts`

**Interfaces:**
- Consumes: `ReminderTier` (Task 2).
- Produces: `ProformaReminderParams` gagne `tier?: ReminderTier`. `sendProformaReminderEmail` adapte objet + urgence au palier.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/services/emailService.reminder.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({ Resend: class { emails = { send: sendMock }; } }));

const base = {
    to: 'billing@armateur.com',
    recipientName: 'Demo Armateur',
    invoiceRef: 'PRO-2026-30-81be71091a2b',
    amountUsd: 11492,
    ageDays: 45,
};

beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'e1' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
});

describe('sendProformaReminderEmail — ton par palier', () => {
    it('reste un rappel courtois pour J3/J7', async () => {
        const { sendProformaReminderEmail } = await import('./emailService');
        await sendProformaReminderEmail({ ...base, ageDays: 3, tier: 'J3' });
        const subject = sendMock.mock.calls[0][0].subject as string;
        expect(subject.toLowerCase()).toContain('reminder');
    });

    it('emploie un ton de mise en demeure formelle à J30', async () => {
        const { sendProformaReminderEmail } = await import('./emailService');
        await sendProformaReminderEmail({ ...base, ageDays: 30, tier: 'J30' });
        const html = sendMock.mock.calls[0][0].html as string;
        expect(html).toMatch(/formal notice|mise en demeure|formal demand/i);
    });

    it('signale l\'imminence d\'une procédure huissier à J45', async () => {
        const { sendProformaReminderEmail } = await import('./emailService');
        await sendProformaReminderEmail({ ...base, ageDays: 45, tier: 'J45' });
        const html = sendMock.mock.calls[0][0].html as string;
        expect(html).toMatch(/bailiff|huissier|legal recovery|enforcement/i);
    });

    it('reste rétro-compatible sans tier (ancien appelant)', async () => {
        const { sendProformaReminderEmail } = await import('./emailService');
        const res = await sendProformaReminderEmail(base);
        expect(res.success).toBe(true);
    });
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `cd frontend && npx vitest run src/services/emailService.reminder.test.ts`
Expected: FAIL — `tier` non pris en compte, textes formels/huissier absents.

- [ ] **Step 3 : Étendre `ProformaReminderParams` + le corps**

Dans `frontend/src/services/emailService.ts`, remplacer le bloc `ProformaReminderParams` + `sendProformaReminderEmail` (lignes ~612-645) par :

```ts
export interface ProformaReminderParams {
    to: string;
    cc?: string[];
    recipientName: string;
    invoiceRef: string;
    amountUsd: number;
    ageDays: number;
    /** Palier de relance — pilote le ton. Absent = rappel courtois générique. */
    tier?: 'J3' | 'J7' | 'J15' | 'J30' | 'J45';
}

/** Objet + bandeau d'alerte selon le palier. */
function reminderTone(tier: ProformaReminderParams['tier'], invoiceRef: string, ageDays: number): {
    subject: string;
    heading: string;
    alertClass: string;
    alertText: string;
} {
    switch (tier) {
        case 'J30':
            return {
                subject: `Formal notice — overdue invoice ${invoiceRef}`,
                heading: 'Formal Notice of Overdue Payment',
                alertClass: 'alert-danger',
                alertText: 'This is a formal demand for payment. Failure to settle this invoice may lead to enforcement proceedings and additional recovery costs.',
            };
        case 'J45':
            return {
                subject: `Final notice before bailiff referral — ${invoiceRef}`,
                heading: 'Final Notice — Bailiff Referral Imminent',
                alertClass: 'alert-danger',
                alertText: 'Unless this invoice is settled without further delay, the file will be referred to a bailiff (huissier) for legal recovery, at your expense.',
            };
        case 'J15':
            return {
                subject: `Reminder: invoice ${invoiceRef} still unpaid`,
                heading: 'Payment Reminder',
                alertClass: 'alert-warn',
                alertText: 'Please settle this invoice promptly to avoid escalation and late-payment interest.',
            };
        default: // J3, J7, ou absence de tier
            return {
                subject: `Reminder: invoice ${invoiceRef} pending (${ageDays} days)`,
                heading: 'Payment Reminder',
                alertClass: 'alert-warn',
                alertText: 'Please settle this invoice at your earliest convenience to avoid port-clearance delays and late-payment interest.',
            };
    }
}

export async function sendProformaReminderEmail(p: ProformaReminderParams): Promise<EmailResult> {
    const t = reminderTone(p.tier, p.invoiceRef, p.ageDays);
    const content = `
        <h1>${t.heading}</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>Pro-forma invoice <strong style="font-family:monospace">${escapeHtml(p.invoiceRef)}</strong> has been outstanding for <strong>${p.ageDays} days</strong>.</p>

        <h2>Summary</h2>
        <div class="meta-row"><span class="meta-label">Invoice</span><span class="meta-value" style="font-family:monospace">${escapeHtml(p.invoiceRef)}</span></div>
        <div class="meta-row"><span class="meta-label">Amount Due</span><span class="meta-value" style="color:#EAB308;font-size:16px">$${p.amountUsd.toLocaleString()}</span></div>
        <div class="meta-row"><span class="meta-label">Age</span><span class="meta-value">${p.ageDays} days</span></div>

        <div class="alert ${t.alertClass}">${t.alertText}</div>

        <a href="${appUrl()}/owner/invoices" class="btn">Pay Invoice →</a>

        <p style="margin-top:24px;font-size:12px;color:#94A3B8">Reference: ${escapeHtml(p.invoiceRef)}</p>
    `;

    return sendEmail({
        to: p.to,
        cc: p.cc,
        subject: t.subject,
        html: emailLayout(content, { previewText: `${p.invoiceRef} — $${p.amountUsd.toLocaleString()}` }),
        text: `${t.subject}\nAmount: $${p.amountUsd.toLocaleString()}\n\nPay at: ${appUrl()}/owner/invoices`,
    });
}
```

- [ ] **Step 4 : Passer le `tier` depuis le dispatcher**

Dans `frontend/src/services/notificationEmailDispatch.ts`, la branche `PROFORMA_REMINDER` (lignes ~73-80) :

```ts
        case 'PROFORMA_REMINDER':
            return sendProformaReminderEmail({
                to: ownerEmail,
                recipientName: ownerName,
                invoiceRef: String(bodyParams.invoice_ref ?? '—'),
                amountUsd: Number(bodyParams.amount_usd ?? 0),
                ageDays: Number(bodyParams.age_days ?? 3),
                tier: (bodyParams.tier as 'J3' | 'J7' | 'J15' | 'J30' | 'J45' | undefined) ?? undefined,
            });
```

- [ ] **Step 5 : Lancer les tests (nouveau + voisins e-mail)**

Run: `cd frontend && npx vitest run src/services/emailService.reminder.test.ts src/services/emailService.invoice.test.ts`
Expected: PASS.

- [ ] **Step 6 : Vérifier la compilation**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune sortie.

- [ ] **Step 7 : Commit**

```bash
git add frontend/src/services/emailService.ts frontend/src/services/notificationEmailDispatch.ts frontend/src/services/emailService.reminder.test.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(email): ton de relance progressif du rappel courtois à la notice pré-huissier"
```

---

### Task 4 : Route cron `/api/cron/collection-reminders`

**Files:**
- Create: `frontend/src/app/api/cron/collection-reminders/route.ts`
- Test: `frontend/src/app/api/cron/collection-reminders/route.test.ts`
- Modify: `frontend/vercel.json` (ajouter le cron)

**Interfaces:**
- Consumes: `dueTier`, `reminderTemplate`, `ReminderTier`, `AUTO_TIERS`, `DebtorResponseType` (Task 2) ; `resolveInvoiceRecipients` (chantier A, `@/services/invoiceIssuanceService`) ; `fetchJurisdictionBillingCc` (`@/lib/jurisdictionName`) ; `notifyOwner` (`@/services/notificationService`).
- Produces: `GET(req): Promise<NextResponse>` protégé par `CRON_SECRET` ; `export function selectDue(...)` (helper pur exporté pour test).

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/app/api/cron/collection-reminders/route.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// notifyOwner + resolveInvoiceRecipients + bailiff lookup sont mockés : ce test
// vérifie l'orchestration du cron (sélection, ordre notif→registre, idempotence,
// auth), pas leurs internes.
const notifyOwnerMock = vi.fn().mockResolvedValue({ id: 'notif-1' });
vi.mock('@/services/notificationService', () => ({
    notifyOwner: notifyOwnerMock,
    EMAIL_KINDS: new Set(['PROFORMA_REMINDER']),
}));
vi.mock('@/services/invoiceIssuanceService', () => ({
    resolveInvoiceRecipients: vi.fn(() => ({ to: 'billing@armateur.com', cc: ['finance@so.gov'] })),
}));
vi.mock('@/lib/jurisdictionName', () => ({
    fetchJurisdictionBillingCc: vi.fn().mockResolvedValue([]),
}));

import { GET } from './route';

const CRON_SECRET = 'test-cron-secret';

function req(auth: string | null): Request {
    const headers = new Headers();
    if (auth) headers.set('authorization', auth);
    return new Request('http://localhost/api/cron/collection-reminders', { headers });
}

// Faux client Supabase capturant les inserts collection_reminders.
function makeClient(opts: {
    proformas?: Record<string, unknown>[];
    remindersByTxn?: Record<string, { tier: string }[]>;
}) {
    const captured = { reminderInserts: [] as Record<string, unknown>[] };
    const proformas = opts.proformas ?? [];
    const remindersByTxn = opts.remindersByTxn ?? {};

    const from = (table: string) => {
        if (table === 'transactions') {
            // Chaîne alignée sur la route : .eq('document_type').in('status').not('shipowner_id').limit()
            return {
                select: () => ({
                    eq: () => ({
                        in: () => ({
                            not: () => ({ limit: async () => ({ data: proformas, error: null }) }),
                        }),
                    }),
                }),
            };
        }
        if (table === 'collection_reminders') {
            return {
                select: () => ({
                    eq: () => ({ order: () => ({ /* sentTiers + latest response */
                        limit: async () => ({ data: [], error: null }) }) }),
                }),
                insert: (payload: Record<string, unknown>) => {
                    captured.reminderInserts.push(payload);
                    return { error: null };
                },
            };
        }
        if (table === 'shipowners') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { official_email: 'billing@armateur.com' }, error: null }) }) }) };
        }
        if (table === 'profiles') {
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
        }
        throw new Error(`unexpected table ${table}`);
    };
    return { client: { from } as unknown as import('@supabase/supabase-js').SupabaseClient, captured };
}

// Le test injecte le client via un hook module-level (voir implémentation :
// serviceClient() est remplaçable par __setClientForTest).
import { __setClientForTest } from './route';

beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    notifyOwnerMock.mockResolvedValue({ id: 'notif-1' });
});

describe('GET /api/cron/collection-reminders', () => {
    it('rejette une requête sans secret', async () => {
        __setClientForTest(makeClient({}).client);
        const res = await GET(req(null));
        expect(res.status).toBe(401);
    });

    it('écrit la notif PUIS le registre pour une pro-forma à J+15 sans relance', async () => {
        const created = new Date(Date.now() - 15 * 86_400_000).toISOString();
        const { client, captured } = makeClient({
            proformas: [{
                id: 'txn-1', invoice_ref: 'PRO-2026-30-aaaa', tax_amount_usd: 500,
                vessel_name: 'MV X', status: 'PENDING', created_at: created,
                shipowner_id: 'own-1', agent_profile_id: null, jurisdiction_id: 'jur-so',
            }],
        });
        __setClientForTest(client);

        const res = await GET(req(`Bearer ${CRON_SECRET}`));
        expect(res.status).toBe(200);

        // Notif insérée avec skipEmail (pas de double e-mail) + tier dans body.
        expect(notifyOwnerMock).toHaveBeenCalledTimes(1);
        const notifArg = notifyOwnerMock.mock.calls[0][1];
        expect(notifArg).toMatchObject({ kind: 'PROFORMA_REMINDER', skipEmail: true });
        expect(notifArg.params).toMatchObject({ tier: 'J15', invoice_ref: 'PRO-2026-30-aaaa' });

        // Registre écrit APRÈS la notif, tier J15.
        expect(captured.reminderInserts).toHaveLength(1);
        expect(captured.reminderInserts[0]).toMatchObject({
            transaction_id: 'txn-1', tier: 'J15', sent_email: 'billing@armateur.com',
        });
    });

    it('n\'écrit rien pour une pro-forma DISPUTED', async () => {
        const created = new Date(Date.now() - 45 * 86_400_000).toISOString();
        const { client, captured } = makeClient({
            proformas: [{
                id: 'txn-2', invoice_ref: 'PRO-2026-30-bbbb', tax_amount_usd: 500,
                vessel_name: 'MV Y', status: 'DISPUTED', created_at: created,
                shipowner_id: 'own-2', agent_profile_id: null, jurisdiction_id: 'jur-so',
            }],
        });
        __setClientForTest(client);

        const res = await GET(req(`Bearer ${CRON_SECRET}`));
        expect(res.status).toBe(200);
        expect(notifyOwnerMock).not.toHaveBeenCalled();
        expect(captured.reminderInserts).toHaveLength(0);
    });
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `cd frontend && npx vitest run src/app/api/cron/collection-reminders/route.test.ts`
Expected: FAIL — route inexistante.

- [ ] **Step 3 : Ajouter `fetchJurisdictionBailiffCc`**

Dans `frontend/src/lib/jurisdictionName.ts`, à côté de `fetchJurisdictionBillingCc`, ajouter :

```ts
/** Copies cabinet huissier (jurisdiction_billing_cc.bailiff_cc_emails), []-safe.
 *  À n'appeler qu'avec un client service-role — même RLS staff-only que le CC standard. */
export async function fetchJurisdictionBailiffCc(
    client: SupabaseClient,
    jurisdictionId: string | null | undefined,
): Promise<string[]> {
    if (!jurisdictionId) return [];
    const { data, error } = await client
        .from('jurisdiction_billing_cc')
        .select('bailiff_cc_emails')
        .eq('jurisdiction_id', jurisdictionId)
        .maybeSingle();
    if (error || !data) return [];
    return (data.bailiff_cc_emails as string[] | null) ?? [];
}
```

Ajouter son test à `frontend/src/lib/jurisdictionName.test.ts` :

```ts
import { fetchJurisdictionBailiffCc } from './jurisdictionName';

describe('fetchJurisdictionBailiffCc', () => {
    it('renvoie les copies huissier de la juridiction', async () => {
        const client = {
            from: () => ({ select: () => ({ eq: () => ({
                maybeSingle: async () => ({ data: { bailiff_cc_emails: ['huissier@eidle.so'] }, error: null }),
            }) }) }),
        } as unknown as SupabaseClient;
        await expect(fetchJurisdictionBailiffCc(client, 'jur-so')).resolves.toEqual(['huissier@eidle.so']);
    });

    it('renvoie une liste vide sans juridiction', async () => {
        const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) } as unknown as SupabaseClient;
        await expect(fetchJurisdictionBailiffCc(client, null)).resolves.toEqual([]);
    });
});
```

Run: `cd frontend && npx vitest run src/lib/jurisdictionName.test.ts`
Expected: PASS (existants + 2 nouveaux).

- [ ] **Step 4 : Implémenter la route**

Créer `frontend/src/app/api/cron/collection-reminders/route.ts` :

```ts
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { resolveInvoiceRecipients } from '@/services/invoiceIssuanceService';
import { fetchJurisdictionBillingCc, fetchJurisdictionBailiffCc } from '@/lib/jurisdictionName';
import { notifyOwner } from '@/services/notificationService';
import {
    dueTier, reminderTemplate, type ReminderTier, type DebtorResponseType,
} from '@/services/collectionReminderService';
import { scopedLogger } from '@/lib/logger';

/**
 * GET /api/cron/collection-reminders
 *
 * Vercel Cron quotidien (08:00 UTC) — moteur de relance B1. Remplace le pg_cron
 * proforma-reminders-daily (mig 065, désactivé par mig 110). Pour chaque
 * pro-forma PENDING/OVERDUE dont un palier (J3→J45) est dû, insère une notif
 * PROFORMA_REMINDER (skipEmail: true — le notification-email-loop de 09:00
 * enverra l'e-mail) PUIS une ligne collection_reminders (registre durable).
 *
 * Auth : Authorization: Bearer ${CRON_SECRET}. Sinon 401.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = scopedLogger('cron.collection-reminders');
const ROW_LIMIT = 200;

// Injection de client pour les tests — la prod utilise createPlatformClient().
let clientOverride: SupabaseClient | null = null;
export function __setClientForTest(c: SupabaseClient | null): void { clientOverride = c; }
function serviceClient(): SupabaseClient { return clientOverride ?? createPlatformClient(); }

interface ProformaRow {
    id: string;
    invoice_ref: string | null;
    tax_amount_usd: number;
    vessel_name: string;
    status: string;
    created_at: string;
    shipowner_id: string | null;
    agent_profile_id: string | null;
    jurisdiction_id: string | null;
}

function ageInDays(createdAtIso: string, now: Date): number {
    return Math.floor((now.getTime() - new Date(createdAtIso).getTime()) / 86_400_000);
}

export async function GET(req: NextRequest | Request): Promise<NextResponse> {
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization');
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const admin = serviceClient();
    const now = new Date();
    const counts = { scanned: 0, sent: 0, skipped: 0, failed: 0 };

    const { data: proformasRaw, error: selErr } = await admin
        .from('transactions')
        .select('id, invoice_ref, tax_amount_usd, vessel_name, status, created_at, shipowner_id, agent_profile_id, jurisdiction_id')
        .eq('document_type', 'PROFORMA')
        .in('status', ['PENDING', 'OVERDUE'])
        .not('shipowner_id', 'is', null)
        .limit(ROW_LIMIT);

    if (selErr) {
        log.error('select_failed', { error: selErr.message });
        return NextResponse.json({ error: 'select_failed' }, { status: 500 });
    }

    const proformas = (proformasRaw ?? []) as ProformaRow[];

    for (const p of proformas) {
        counts.scanned += 1;
        try {
            // sentTiers + dernière réponse débiteur (ordre desc pour la dernière).
            const { data: remRaw } = await admin
                .from('collection_reminders')
                .select('tier, debtor_response_type, debtor_response_at')
                .eq('transaction_id', p.id)
                .order('sent_at', { ascending: false })
                .limit(20);
            const reminders = (remRaw ?? []) as {
                tier: string; debtor_response_type: DebtorResponseType | null; debtor_response_at: string | null;
            }[];
            const sentTiers = reminders.map((r) => r.tier).filter((t): t is ReminderTier =>
                (['J3', 'J7', 'J15', 'J30', 'J45'] as string[]).includes(t)) as ReminderTier[];
            const latest = reminders.find((r) => r.debtor_response_type && r.debtor_response_type !== 'SILENT');

            const tier = dueTier({
                status: p.status,
                ageDays: ageInDays(p.created_at, now),
                sentTiers,
                latestResponse: latest?.debtor_response_type ?? null,
                latestResponseAt: latest?.debtor_response_at ? new Date(latest.debtor_response_at) : null,
                now,
            });
            if (!tier) { counts.skipped += 1; continue; }

            // Destinataires : cascade armateur + copies juridiction/plateforme + huissier dès J45.
            const { data: owner } = p.shipowner_id
                ? await admin.from('shipowners').select('official_email').eq('id', p.shipowner_id).maybeSingle()
                : { data: null };
            const { data: agent } = p.agent_profile_id
                ? await admin.from('profiles').select('email').eq('id', p.agent_profile_id).maybeSingle()
                : { data: null };
            const jurisdictionCc = await fetchJurisdictionBillingCc(admin, p.jurisdiction_id);
            // Cabinet huissier en copie seulement au palier pré-huissier J45.
            const bailiffCc = tier === 'J45'
                ? await fetchJurisdictionBailiffCc(admin, p.jurisdiction_id)
                : [];

            const recipients = resolveInvoiceRecipients({
                shipownerBillingEmail: (owner?.official_email as string | null) ?? null,
                agentEmail: (agent?.email as string | null) ?? null,
                vesselOwnerEmail: null,
                jurisdictionCcEmails: [...jurisdictionCc, ...bailiffCc],
                platformCcEmail: process.env.PLATFORM_BILLING_CC ?? null,
            });
            if (!recipients) {
                log.warn('reminder_skipped_no_recipient', { txnId: p.id, tier });
                counts.skipped += 1;
                continue;
            }

            const { templateId } = reminderTemplate(tier);
            const bodyParams = {
                transaction_id: p.id,
                invoice_ref: p.invoice_ref,
                amount_usd: p.tax_amount_usd,
                vessel_name: p.vessel_name,
                tier,
                age_days: ageInDays(p.created_at, now),
            };

            // 1) Notif d'abord : elle pilote l'envoi e-mail via le loop. skipEmail
            //    pour ne pas doubler (notifyOwner enverrait inline sinon).
            await notifyOwner(admin, {
                shipownerId: p.shipowner_id!,
                kind: 'PROFORMA_REMINDER',
                params: bodyParams,
                deepLink: `/owner/invoices?focus=${p.id}`,
                skipEmail: true,
            });

            // 2) Puis le registre durable. L'unicité (transaction_id, tier) est le
            //    garde-fou dur contre un doublon en cas de passes concurrentes.
            const { error: insErr } = await admin.from('collection_reminders').insert({
                transaction_id: p.id,
                tier,
                sent_at: now.toISOString(),
                sent_email: recipients.to,
                cc_emails: recipients.cc,
                template_used: templateId,
                debtor_response_type: 'SILENT',
            });
            if (insErr) {
                // Conflit (txn,tier) = déjà tracé, bénin. Autre = incident ops.
                log.warn('reminder_ledger_insert_failed', { txnId: p.id, tier, error: insErr.message });
            }
            counts.sent += 1;
        } catch (e) {
            counts.failed += 1;
            log.warn('reminder_failed', { txnId: p.id, error: e instanceof Error ? e.message : String(e) });
        }
    }

    log.info('cron_run_complete', { ...counts });
    return NextResponse.json(counts);
}
```

Puis remplacer le `bailiffCc` provisoire par la vraie lecture de `bailiff_cc_emails`. Comme `fetchJurisdictionBillingCc` ne lit que `cc_emails`, ajouter dans `frontend/src/lib/jurisdictionName.ts` une fonction sœur :

```ts
/** Copies cabinet huissier (jurisdiction_billing_cc.bailiff_cc_emails), []-safe. */
export async function fetchJurisdictionBailiffCc(
    client: SupabaseClient,
    jurisdictionId: string | null | undefined,
): Promise<string[]> {
    if (!jurisdictionId) return [];
    const { data, error } = await client
        .from('jurisdiction_billing_cc')
        .select('bailiff_cc_emails')
        .eq('jurisdiction_id', jurisdictionId)
        .maybeSingle();
    if (error || !data) return [];
    return (data.bailiff_cc_emails as string[] | null) ?? [];
}
```

et dans la route, remplacer la ligne `bailiffCc` par :

```ts
            const bailiffCc = tier === 'J45'
                ? await fetchJurisdictionBailiffCc(admin, p.jurisdiction_id)
                : [];
```

- [ ] **Step 5 : Enregistrer le cron dans `vercel.json`**

Dans `frontend/vercel.json`, ajouter à `crons` (avant `notification-email-loop` de 09:00) :

```json
{ "path": "/api/cron/collection-reminders", "schedule": "0 8 * * *" }
```

- [ ] **Step 6 : Lancer tous les tests concernés + compilation**

Run: `cd frontend && npx vitest run src/app/api/cron/collection-reminders/route.test.ts src/lib/jurisdictionName.test.ts && npx tsc --noEmit`
Expected: PASS ; `tsc` silencieux.

- [ ] **Step 7 : Commit**

```bash
git add frontend/src/app/api/cron/collection-reminders/ frontend/src/lib/jurisdictionName.ts frontend/src/lib/jurisdictionName.test.ts frontend/vercel.json
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(collections): cron de relance qui trace chaque palier dans collection_reminders"
```

---

### Task 5 : Vérification d'ensemble

- [ ] **Step 1 : Suite complète**

Run: `cd frontend && npx vitest run`
Expected: 0 échec ; total ≥ baseline + les nouveaux tests.

- [ ] **Step 2 : Typage + lint non dégradé**

Run: `cd frontend && npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: `tsc` silencieux ; lint `✖ 157 problems (62 errors, 95 warnings)` (baseline `develop`). Toute erreur nouvelle sur un fichier touché doit être corrigée.

- [ ] **Step 3 : Cohérence — pas de double chemin e-mail**

Vérifier par lecture que la route passe bien `skipEmail: true` à `notifyOwner`, et que `PROFORMA_REMINDER` reste dans `EMAIL_KINDS` (sinon le loop n'enverrait pas). Documenté, pas de commande.

---

## Bascule (décision PO, hors exécution automatique)

Ordre **strict** au déploiement — la coexistence des deux crons est dangereuse **dans les deux sens** (final review #4) : si le cron Vercel démarre avant que la mig 110 ne désactive le pg_cron 065, les deux enfilent un `PROFORMA_REMINDER` pour les pro-formas de 3/7 jours → **double e-mail** ; s'il démarre après, une journée sans relance. La mig et l'activation du cron doivent donc atterrir dans le **même** déploiement.

1. **Backfill du registre AVANT tout** (final review #3) : `npx tsx scripts/backfill-collection-reminders.ts --execute`. Pré-remplit `collection_reminders` avec les paliers déjà écoulés de chaque pro-forma PENDING/OVERDUE (marqués `(backfill)`, sans e-mail), pour que le moteur ne reparte qu'au **prochain** palier réel — sinon la 1ʳᵉ passe enverrait une notice J45 « huissier imminent » à froid sur tout le backlog agé ($2,75 M). Dry-run d'abord.
2. Appliquer la mig 110 (`node scripts/db-migrate.mjs`) — désactive le pg_cron 065, dans le déploiement qui active le cron Vercel.
3. Le cron Vercel `collection-reminders` s'active via `vercel.json` au déploiement (08:00 UTC, une heure avant `notification-email-loop`).
4. Renseigner `jurisdiction_billing_cc.bailiff_cc_emails` (Somaliland → cabinet Eidle Advocats) — sinon J+45 part sans copie huissier (acceptable en attendant B2). Les copies sont désormais **réellement livrées** : depuis le final review, le cron envoie l'e-mail **inline** avec `to`+`cc` et stampe `emailed_at` sur la notif pour que le loop ne double pas.

## Chantier suivant (B2)

Écran staff `admin/collections` : timeline `collection_reminders` par transaction/armateur, saisie éditable de `debtor_response_type`/`debtor_response_at`, boutons d'escalade manuelle `BAILIFF`/`JUDICIAL` (réutilisent `collectionReminderService` en mode manuel, bypass âge), édition de `bailiff_cc_emails`.
