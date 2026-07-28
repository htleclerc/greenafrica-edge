# Relevé de compte mensuel armateur (C) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un cron mensuel produit, par armateur à solde dû > 0, un relevé PDF informatif (pro-formas ouvertes + paiements du mois + total dû), stocké, notifié (PDF joint), et consultable dans le portail armateur.

**Architecture:** Un service pur `statementService` compose les données depuis `transactions`/`payments`. Un `generateStatementPdf` (dans `invoiceService.ts`, réutilise `fmtUsd`/en-tête, sans QR/HMAC) rend le PDF. Un cron TS `monthly-statements` itère les armateurs, stocke sous `statements/<owner>/<YYYY-MM>.pdf`, upsert une ligne `owner_statements`, et notifie via `notifyOwner(STATEMENT_READY, attachments.pdfBuffer)` (envoi inline, `emailed_at` stampé → pas de double). Le portail liste les `owner_statements` de l'armateur avec téléchargement par URL signée owner-scopée.

**Tech Stack:** Next.js 15 (route handlers, server components) / TypeScript strict / Supabase (PostgREST + Storage) / jsPDF / Resend / next-intl / Vitest.

**Spec:** [2026-07-29-releve-compte-mensuel-design.md](../specs/2026-07-29-releve-compte-mensuel-design.md)

## Global Constraints

- TypeScript strict, `any` interdit (sauf le client de service non typé déjà toléré ailleurs pour une table hors types générés, avec `// eslint-disable-next-line`).
- Commits atomiques humanisés, auteur `Loic Leclerc <leclerc@drwintech.com>` via `git commit --author=`. Jamais de `Co-Authored-By: Claude` ni « Generated with Claude Code ». Staging explicite (paths).
- Document **informatif** : pas de QR, pas de HMAC, pas de référence fiscale. Le souverain du PDF vient de `fetchJurisdictionName` (jamais codé « Somaliland » en dur).
- **Un relevé par ligne `shipowners`** (= par juridiction). Maritime + aviation (interroger `transactions` par `shipowner_id`, tous modes).
- Argent des paiements en **unités mineures** : `payments.amount_usd_minor / 100`. `status='CONFIRMED'`, borne `confirmed_at ∈ [periodStart, periodEnd)`.
- Solde ouvert d'une pro-forma = `tax_amount_usd - COALESCE(partial_paid_usd, 0)` ; ouvertes = `document_type='PROFORMA'`, `status ∈ {PENDING,OVERDUE}`.
- Idempotence du cron : `owner_statements` unique `(shipowner_id, period_month)` + `upsert` + `storage.upload(upsert:true)`.
- Notification : envoi **inline** via `notifyOwner` (le loop de secours ne peut pas joindre le PDF) ; `emailed_at` stampé par `notifyOwner` évite le double envoi.
- Tests depuis `frontend/` : préfixer chaque commande par `cd /c/Users/lecle/Workspace/africgreen/frontend &&` (le shell se réinitialise ; lancer depuis la racine casse les alias `@/` et tire la mauvaise version de vitest). Mode d'échec n°1.
- Ne pas dégrader le baseline lint (`157 problems / 62 errors` sur `develop`).

---

### Task 1 : Migration — table `owner_statements` + enum `STATEMENT_READY`

**Files:**
- Create: `supabase/migrations/112_owner_statements.sql`

**Interfaces:**
- Produces: table `public.owner_statements` (colonnes ci-dessous) ; valeur enum `owner_notification_kind` `STATEMENT_READY`.

- [ ] **Step 1 : Écrire la migration**

Créer `supabase/migrations/112_owner_statements.sql` :

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 112: relevé de compte mensuel (chantier C)
--
-- Métadonnées d'un relevé mensuel par armateur (une ligne par shipowner × mois),
-- porteuse de la RLS (armateur lit les siens, staff par juridiction) et de
-- l'idempotence du cron. Le PDF vit dans le bucket documents sous statements/.
-- Ajoute la valeur enum STATEMENT_READY pour la notification owner.
-- ─────────────────────────────────────────────────────────────────────────────

-- Valeur enum (usée par owner_notifications, PAS dans cette migration → pas de
-- conflit ADD VALUE / usage même transaction). En tête, isolée.
ALTER TYPE public.owner_notification_kind ADD VALUE IF NOT EXISTS 'STATEMENT_READY';

CREATE TABLE IF NOT EXISTS public.owner_statements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipowner_id             UUID NOT NULL REFERENCES public.shipowners(id) ON DELETE CASCADE,
  jurisdiction_id          UUID NOT NULL REFERENCES public.jurisdictions(id),
  period_month             DATE NOT NULL,
  pdf_path                 TEXT NOT NULL,
  total_outstanding_usd    NUMERIC(14,2) NOT NULL,
  payments_in_month_usd    NUMERIC(14,2) NOT NULL DEFAULT 0,
  open_count               INT NOT NULL DEFAULT 0,
  generated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shipowner_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_owner_statements_owner
  ON public.owner_statements(shipowner_id, period_month DESC);

ALTER TABLE public.owner_statements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner reads own statements" ON public.owner_statements;
CREATE POLICY "owner reads own statements" ON public.owner_statements FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.shipowners s
    WHERE s.id = owner_statements.shipowner_id AND s.profile_id = auth.uid()
  ));

DROP POLICY IF EXISTS "staff reads statements" ON public.owner_statements;
CREATE POLICY "staff reads statements" ON public.owner_statements FOR SELECT
  USING (public.is_admin_or_officer() AND jurisdiction_id = ANY(public.current_jurisdiction_ids()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_statements TO service_role;

-- DOWN:
-- DROP TABLE IF EXISTS public.owner_statements;
-- (l'enum ADD VALUE n'est pas réversible — Postgres ne supporte pas DROP VALUE)
```

- [ ] **Step 2 : Vérifier la forme**

Relire : `ADD VALUE IF NOT EXISTS` en tête ; PK + `UNIQUE (shipowner_id, period_month)` ; RLS activée + 2 policies SELECT (owner via `profile_id=auth.uid()`, staff via `is_admin_or_officer()` + `current_jurisdiction_ids()`) ; GRANT service_role. Ne PAS appliquer (env partagé — au déploiement).

- [ ] **Step 3 : Commit**

```bash
git add supabase/migrations/112_owner_statements.sql
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(statements): table owner_statements + notification STATEMENT_READY"
```

---

### Task 2 : `generateStatementPdf` + `StatementData`

**Files:**
- Modify: `frontend/src/services/invoiceService.ts` (ajouter le type + la fonction, exportés)
- Test: `frontend/src/services/statementPdf.test.ts`

**Interfaces:**
- Consumes: `fmtUsd` (module-privé, même fichier).
- Produces: `StatementLine`, `StatementPayment`, `StatementData`, `generateStatementPdf(data): Promise<Uint8Array>`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/services/statementPdf.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { generateStatementPdf, type StatementData } from './invoiceService';

const data: StatementData = {
    ownerName: 'Demo Armateur Ltd',
    jurisdiction: 'Republic of Djibouti',
    periodLabel: 'July 2026',
    openLines: [
        { invoiceRef: 'PRO-2026-30-aaaa', vesselName: 'GG DEMO STAR', issuedAt: '2026-06-10', ageDays: 20, outstandingUsd: 16500 },
        { invoiceRef: 'PRO-2026-30-bbbb', vesselName: 'GG DEMO PIONEER', issuedAt: '2026-06-14', ageDays: 16, outstandingUsd: 11492 },
    ],
    payments: [
        { confirmedAt: '2026-06-20', receiptRef: 'RCT-2026-0001', amountUsd: 5000 },
    ],
    totalOutstandingUsd: 27992,
    paymentsInMonthUsd: 5000,
};

describe('generateStatementPdf', () => {
    it('produit un PDF non vide', async () => {
        const buf = await generateStatementPdf(data);
        expect(buf).toBeInstanceOf(Uint8Array);
        expect(buf.byteLength).toBeGreaterThan(500);
        // en-tête PDF
        expect(String.fromCharCode(buf[0], buf[1], buf[2], buf[3])).toBe('%PDF');
    });

    it('ne plante pas sans paiements ni lignes ouvertes', async () => {
        const buf = await generateStatementPdf({ ...data, openLines: [], payments: [], totalOutstandingUsd: 0, paymentsInMonthUsd: 0 });
        expect(buf.byteLength).toBeGreaterThan(300);
    });
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `cd frontend && npx vitest run src/services/statementPdf.test.ts`
Expected: FAIL — `generateStatementPdf` / `StatementData` non exportés.

- [ ] **Step 3 : Implémenter**

Dans `frontend/src/services/invoiceService.ts`, après `generateInvoicePdf` (avant `generateAndStoreInvoice`), ajouter :

```ts
// ── Monthly account statement (chantier C) ─────────────────────────────────
// Informatif : pas de QR, pas de HMAC, pas de sceau fiscal. Réutilise fmtUsd et
// le squelette jsPDF de generateInvoicePdf, en version allégée.

export interface StatementLine {
    invoiceRef: string; vesselName: string; issuedAt: string; ageDays: number; outstandingUsd: number;
}
export interface StatementPayment {
    confirmedAt: string; receiptRef: string | null; amountUsd: number;
}
export interface StatementData {
    ownerName: string;
    jurisdiction: string;
    periodLabel: string;
    openLines: StatementLine[];
    payments: StatementPayment[];
    totalOutstandingUsd: number;
    paymentsInMonthUsd: number;
}

export async function generateStatementPdf(data: StatementData): Promise<Uint8Array> {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 18;

    // Accent bar
    doc.setFillColor(4, 120, 87); doc.rect(0, 0, pageWidth / 2, 4, 'F');
    doc.setFillColor(16, 185, 129); doc.rect(pageWidth / 2, 0, pageWidth / 4, 4, 'F');
    doc.setFillColor(234, 179, 8); doc.rect((pageWidth * 3) / 4, 0, pageWidth / 4, 4, 'F');

    // Title
    doc.setTextColor(13, 31, 24);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text('Account Statement', margin, 22);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`${data.jurisdiction} · Maritime Carbon Tax Authority`, margin, 29);

    // Owner + period
    doc.setTextColor(13, 31, 24); doc.setFontSize(11);
    doc.text(data.ownerName, margin, 40);
    doc.setTextColor(100, 116, 139); doc.setFontSize(10);
    doc.text(`Statement period: ${data.periodLabel}`, margin, 46);

    // Informational disclaimer
    doc.setTextColor(148, 163, 184); doc.setFontSize(8);
    doc.text('Informational account statement — not an invoice or a formal notice.', margin, 52);

    let y = 62;

    // Open pro-formas
    doc.setTextColor(13, 31, 24); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Outstanding pro-formas', margin, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
    doc.text('Reference', margin, y); doc.text('Vessel', margin + 55, y);
    doc.text('Age', margin + 110, y); doc.text('Due (USD)', pageWidth - margin, y, { align: 'right' }); y += 5;
    doc.setTextColor(13, 31, 24);
    if (data.openLines.length === 0) {
        doc.setTextColor(148, 163, 184); doc.text('None', margin, y); doc.setTextColor(13, 31, 24); y += 6;
    } else {
        for (const l of data.openLines) {
            if (y > 250) { doc.addPage(); y = 22; }
            doc.setFontSize(9);
            doc.text(l.invoiceRef, margin, y);
            doc.text(l.vesselName.slice(0, 26), margin + 55, y);
            doc.text(`${l.ageDays}d`, margin + 110, y);
            doc.text(fmtUsd(l.outstandingUsd), pageWidth - margin, y, { align: 'right' });
            y += 5;
        }
    }
    y += 4;

    // Payments in month
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(`Payments received in ${data.periodLabel}`, margin, y); y += 6;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(100, 116, 139);
    doc.text('Date', margin, y); doc.text('Receipt', margin + 55, y);
    doc.text('Amount (USD)', pageWidth - margin, y, { align: 'right' }); y += 5;
    doc.setTextColor(13, 31, 24);
    if (data.payments.length === 0) {
        doc.setTextColor(148, 163, 184); doc.text('None', margin, y); doc.setTextColor(13, 31, 24); y += 6;
    } else {
        for (const p of data.payments) {
            if (y > 250) { doc.addPage(); y = 22; }
            doc.setFontSize(9);
            doc.text(p.confirmedAt.slice(0, 10), margin, y);
            doc.text(p.receiptRef ?? '—', margin + 55, y);
            doc.text(fmtUsd(p.amountUsd), pageWidth - margin, y, { align: 'right' });
            y += 5;
        }
    }
    y += 8;

    // Totals
    doc.setDrawColor(203, 213, 225); doc.line(margin, y, pageWidth - margin, y); y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100, 116, 139);
    doc.text('Payments received this period', margin, y);
    doc.setTextColor(16, 185, 129);
    doc.text(`$${fmtUsd(data.paymentsInMonthUsd)}`, pageWidth - margin, y, { align: 'right' }); y += 7;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(13, 31, 24);
    doc.text('Total outstanding', margin, y);
    doc.text(`$${fmtUsd(data.totalOutstandingUsd)}`, pageWidth - margin, y, { align: 'right' });

    return new Uint8Array(doc.output('arraybuffer'));
}
```

- [ ] **Step 4 : Lancer les tests + compilation**

Run: `cd frontend && npx vitest run src/services/statementPdf.test.ts && npx tsc --noEmit`
Expected: PASS ; `tsc` silencieux.

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/services/invoiceService.ts frontend/src/services/statementPdf.test.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(statements): générateur PDF du relevé mensuel (informatif)"
```

---

### Task 3 : Service `statementService`

**Files:**
- Create: `frontend/src/services/statementService.ts`
- Test: `frontend/src/services/statementService.test.ts`

**Interfaces:**
- Consumes: `StatementLine`, `StatementPayment` (Task 2).
- Produces: `OwnerStatementResult`, `composeOwnerStatement(admin, input)`, `statementStoragePath(shipownerId, periodStart)`, `periodBounds(now)`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/services/statementService.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { composeOwnerStatement, statementStoragePath, periodBounds } from './statementService';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('periodBounds', () => {
    it('renvoie [1er du mois précédent, 1er du mois courant)', () => {
        const { periodStart, periodEnd, label } = periodBounds(new Date('2026-07-03T06:00:00Z'));
        expect(periodStart.toISOString().slice(0, 10)).toBe('2026-06-01');
        expect(periodEnd.toISOString().slice(0, 10)).toBe('2026-07-01');
        expect(label).toBe('June 2026');
    });
    it('gère le passage d\'année (janvier → décembre précédent)', () => {
        const { periodStart, label } = periodBounds(new Date('2026-01-10T06:00:00Z'));
        expect(periodStart.toISOString().slice(0, 10)).toBe('2025-12-01');
        expect(label).toBe('December 2025');
    });
});

describe('statementStoragePath', () => {
    it('range sous statements/<owner>/<YYYY-MM>.pdf', () => {
        expect(statementStoragePath('own-1', new Date('2026-06-01T00:00:00Z')))
            .toBe('statements/own-1/2026-06.pdf');
    });
});

describe('composeOwnerStatement', () => {
    // Faux client : transactions (ouvertes) + payments (mois).
    function makeDb(txns: Record<string, unknown>[], pays: Record<string, unknown>[]) {
        const from = (table: string) => {
            if (table === 'transactions') {
                return { select: () => ({ eq: () => ({ eq: () => ({ in: async () => ({ data: txns, error: null }) }) }) }) };
            }
            if (table === 'payments') {
                return { select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ lt: async () => ({ data: pays, error: null }) }) }) }) }) };
            }
            throw new Error(`unexpected ${table}`);
        };
        return { from } as unknown as SupabaseClient;
    }

    it('compose lignes ouvertes, paiements du mois, totaux', async () => {
        const db = makeDb(
            [
                { invoice_ref: 'PRO-1', vessel_name: 'MV A', created_at: '2026-06-10T00:00:00Z', tax_amount_usd: '16500', partial_paid_usd: '0' },
                { invoice_ref: 'PRO-2', vessel_name: 'MV B', created_at: '2026-06-14T00:00:00Z', tax_amount_usd: '12000', partial_paid_usd: '500' },
            ],
            [
                { confirmed_at: '2026-06-20T00:00:00Z', receipt_ref: 'RCT-1', amount_usd_minor: '500000' },
            ],
        );
        const res = await composeOwnerStatement(db, {
            shipownerId: 'own-1',
            periodStart: new Date('2026-06-01T00:00:00Z'),
            periodEnd: new Date('2026-07-01T00:00:00Z'),
            now: new Date('2026-07-01T00:00:00Z'),
        });
        expect(res.openCount).toBe(2);
        expect(res.openLines[0]).toMatchObject({ invoiceRef: 'PRO-1', outstandingUsd: 16500 });
        expect(res.openLines[1].outstandingUsd).toBe(11500); // 12000 - 500
        expect(res.totalOutstandingUsd).toBe(28000);
        expect(res.paymentsInMonthUsd).toBe(5000); // 500000 minor / 100
        expect(res.payments[0]).toMatchObject({ receiptRef: 'RCT-1', amountUsd: 5000 });
    });
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `cd frontend && npx vitest run src/services/statementService.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

Créer `frontend/src/services/statementService.ts` :

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StatementLine, StatementPayment } from './invoiceService';

export interface OwnerStatementResult {
    openLines: StatementLine[];
    payments: StatementPayment[];
    totalOutstandingUsd: number;
    paymentsInMonthUsd: number;
    openCount: number;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

/** Bornes du mois écoulé : [1er du mois précédent, 1er du mois courant) + libellé. */
export function periodBounds(now: Date): { periodStart: Date; periodEnd: Date; label: string } {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const periodEnd = new Date(Date.UTC(y, m, 1));
    const periodStart = new Date(Date.UTC(y, m - 1, 1));
    const label = `${MONTHS[periodStart.getUTCMonth()]} ${periodStart.getUTCFullYear()}`;
    return { periodStart, periodEnd, label };
}

/** statements/<shipownerId>/<YYYY-MM>.pdf */
export function statementStoragePath(shipownerId: string, periodStart: Date): string {
    const ym = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, '0')}`;
    return `statements/${shipownerId}/${ym}.pdf`;
}

function ageDays(createdAtIso: string, now: Date): number {
    return Math.max(0, Math.floor((now.getTime() - new Date(createdAtIso).getTime()) / 86_400_000));
}

export interface ComposeInput {
    shipownerId: string; periodStart: Date; periodEnd: Date; now: Date;
}

/** Compose les données du relevé : pro-formas ouvertes + paiements confirmés du mois. */
export async function composeOwnerStatement(
    admin: SupabaseClient,
    input: ComposeInput,
): Promise<OwnerStatementResult> {
    const { data: txRaw } = await admin
        .from('transactions')
        .select('invoice_ref, vessel_name, created_at, tax_amount_usd, partial_paid_usd')
        .eq('document_type', 'PROFORMA')
        .eq('shipowner_id', input.shipownerId)
        .in('status', ['PENDING', 'OVERDUE']);
    const openLines: StatementLine[] = ((txRaw ?? []) as Record<string, unknown>[]).map((r) => {
        const outstanding = Number(r.tax_amount_usd) - Number(r.partial_paid_usd ?? 0);
        return {
            invoiceRef: String(r.invoice_ref ?? '—'),
            vesselName: String(r.vessel_name ?? ''),
            issuedAt: String(r.created_at).slice(0, 10),
            ageDays: ageDays(String(r.created_at), input.now),
            outstandingUsd: outstanding,
        };
    });
    const totalOutstandingUsd = openLines.reduce((s, l) => s + l.outstandingUsd, 0);

    const { data: payRaw } = await admin
        .from('payments')
        .select('confirmed_at, receipt_ref, amount_usd_minor')
        .eq('shipowner_id', input.shipownerId)
        .eq('status', 'CONFIRMED')
        .gte('confirmed_at', input.periodStart.toISOString())
        .lt('confirmed_at', input.periodEnd.toISOString());
    const payments: StatementPayment[] = ((payRaw ?? []) as Record<string, unknown>[]).map((r) => ({
        confirmedAt: String(r.confirmed_at),
        receiptRef: (r.receipt_ref as string | null) ?? null,
        amountUsd: Number(r.amount_usd_minor) / 100,
    }));
    const paymentsInMonthUsd = payments.reduce((s, p) => s + p.amountUsd, 0);

    return { openLines, payments, totalOutstandingUsd, paymentsInMonthUsd, openCount: openLines.length };
}
```

- [ ] **Step 4 : Lancer les tests + compilation**

Run: `cd frontend && npx vitest run src/services/statementService.test.ts && npx tsc --noEmit`
Expected: PASS ; `tsc` silencieux.

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/services/statementService.ts frontend/src/services/statementService.test.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(statements): composition des données du relevé (pro-formas ouvertes + paiements du mois)"
```

---

### Task 4 : Notification `STATEMENT_READY`

**Files:**
- Modify: `frontend/src/services/emailService.ts` (ajouter `sendStatementReadyEmail`)
- Modify: `frontend/src/services/notificationService.ts` (`NotificationKind`, `EMAIL_KINDS`, case inline)
- Modify: `frontend/src/services/notificationEmailDispatch.ts` (case fallback)
- Test: `frontend/src/services/emailService.statement.test.ts`

**Interfaces:**
- Produces: `sendStatementReadyEmail({ to, recipientName, periodLabel, totalOutstandingUsd, pdfBuffer? }): Promise<EmailResult>`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/services/emailService.statement.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({ Resend: class { emails = { send: sendMock }; } }));

const base = {
    to: 'billing@armateur.com',
    recipientName: 'Demo Armateur',
    periodLabel: 'July 2026',
    totalOutstandingUsd: 27992,
};

beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'e1' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
});

describe('sendStatementReadyEmail', () => {
    it('nomme la période et le total, avec bouton portail', async () => {
        const { sendStatementReadyEmail } = await import('./emailService');
        await sendStatementReadyEmail(base);
        const call = sendMock.mock.calls[0][0];
        expect(String(call.subject)).toMatch(/statement|July 2026/i);
        expect(String(call.html)).toContain('July 2026');
        expect(String(call.html)).toContain('/owner/invoices');
    });

    it('joint le PDF quand fourni', async () => {
        const { sendStatementReadyEmail } = await import('./emailService');
        await sendStatementReadyEmail({ ...base, pdfBuffer: new Uint8Array([1, 2, 3]) });
        expect(sendMock.mock.calls[0][0].attachments?.[0]?.filename).toMatch(/statement/i);
    });

    it('omet la pièce jointe sans PDF', async () => {
        const { sendStatementReadyEmail } = await import('./emailService');
        await sendStatementReadyEmail(base);
        expect(sendMock.mock.calls[0][0].attachments).toBeUndefined();
    });
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `cd frontend && npx vitest run src/services/emailService.statement.test.ts`
Expected: FAIL — `sendStatementReadyEmail` n'existe pas.

- [ ] **Step 3 : Ajouter l'e-mail**

Dans `frontend/src/services/emailService.ts`, après `sendProformaIssuedEmail`, ajouter :

```ts
// ── Monthly statement email (chantier C) ───────────────────────────────────

export interface StatementReadyParams {
    to: string;
    recipientName: string;
    periodLabel: string;
    totalOutstandingUsd: number;
    pdfBuffer?: Uint8Array;
}

export async function sendStatementReadyEmail(p: StatementReadyParams): Promise<EmailResult> {
    const subject = `Account statement — ${p.periodLabel}`;
    const content = `
        <h1>Monthly Account Statement</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>Your account statement for <strong>${escapeHtml(p.periodLabel)}</strong> is available.</p>

        <h2>Summary</h2>
        <div class="meta-row"><span class="meta-label">Period</span><span class="meta-value">${escapeHtml(p.periodLabel)}</span></div>
        <div class="meta-row"><span class="meta-label">Total Outstanding</span><span class="meta-value" style="color:#EAB308;font-size:16px">$${p.totalOutstandingUsd.toLocaleString()}</span></div>

        <div class="alert alert-warn">This is an informational statement, not an invoice. Open pro-formas remain payable from your portal.</div>

        <a href="${appUrl()}/owner/invoices" class="btn">View Statements →</a>
    `;
    return sendEmail({
        to: p.to,
        subject,
        html: emailLayout(content, { previewText: `Statement ${p.periodLabel} — $${p.totalOutstandingUsd.toLocaleString()} due` }),
        text: `Account statement ${p.periodLabel}\nTotal outstanding: $${p.totalOutstandingUsd.toLocaleString()}\n\nView at: ${appUrl()}/owner/invoices`,
        attachments: p.pdfBuffer ? [{ filename: `statement-${p.periodLabel.replace(/\s/g, '-')}.pdf`, content: Buffer.from(p.pdfBuffer) }] : undefined,
    });
}
```

- [ ] **Step 4 : Câbler le type + EMAIL_KINDS + case inline (`notificationService.ts`)**

Ajouter `'STATEMENT_READY'` à l'union `NotificationKind` (bloc lignes ~14-20) et au set `EMAIL_KINDS`. Ajouter l'import `sendStatementReadyEmail` en tête (à côté des autres `send…Email`). Dans le `switch (input.kind)` inline de `notifyOwner`, ajouter avant `default:` :

```ts
                    case 'STATEMENT_READY':
                        result = await sendStatementReadyEmail({
                            to: ownerEmail,
                            recipientName: ownerName,
                            periodLabel: String(input.params.period ?? ''),
                            totalOutstandingUsd: Number(input.params.total_outstanding_usd ?? 0),
                            pdfBuffer: input.attachments?.pdfBuffer,
                        });
                        break;
```

- [ ] **Step 5 : Câbler le fallback loop (`notificationEmailDispatch.ts`)**

Dans le `switch` de `dispatchNotificationEmail`, ajouter (le loop de secours n'a pas le buffer → e-mail sans pièce jointe, lien portail seulement) :

```ts
        case 'STATEMENT_READY':
            return sendStatementReadyEmail({
                to: ownerEmail,
                recipientName: ownerName,
                periodLabel: String(bodyParams.period ?? ''),
                totalOutstandingUsd: Number(bodyParams.total_outstanding_usd ?? 0),
            });
```

et ajouter `sendStatementReadyEmail` à l'import depuis `@/services/emailService` en tête du fichier.

- [ ] **Step 6 : Lancer les tests + compilation**

Run: `cd frontend && npx vitest run src/services/emailService.statement.test.ts && npx tsc --noEmit`
Expected: PASS ; `tsc` silencieux. (Le type `NotificationKind` étant élargi, vérifier qu'aucun `switch` exhaustif ne casse — `tsc` le dira.)

- [ ] **Step 7 : Commit**

```bash
git add frontend/src/services/emailService.ts frontend/src/services/emailService.statement.test.ts frontend/src/services/notificationService.ts frontend/src/services/notificationEmailDispatch.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(statements): notification STATEMENT_READY (e-mail relevé + PDF joint inline)"
```

---

### Task 5 : Cron `monthly-statements`

**Files:**
- Create: `frontend/src/app/api/cron/monthly-statements/route.ts`
- Test: `frontend/src/app/api/cron/monthly-statements/route.test.ts`
- Modify: `frontend/vercel.json`

**Interfaces:**
- Consumes: `composeOwnerStatement`, `statementStoragePath`, `periodBounds` (Task 3) ; `generateStatementPdf` (Task 2) ; `fetchJurisdictionName` (`@/lib/jurisdictionName`) ; `notifyOwner` (`@/services/notificationService`) ; `createPlatformClient` (`@/lib/supabase/tenant`).
- Produces: `GET(req): Promise<NextResponse>` ; `__setClientForTest`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/app/api/cron/monthly-statements/route.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const notifyOwnerMock = vi.fn().mockResolvedValue({ id: 'n1' });
vi.mock('@/services/notificationService', () => ({ notifyOwner: notifyOwnerMock }));
vi.mock('@/services/statementService', () => ({
    periodBounds: () => ({ periodStart: new Date('2026-06-01T00:00:00Z'), periodEnd: new Date('2026-07-01T00:00:00Z'), label: 'June 2026' }),
    statementStoragePath: () => 'statements/own-1/2026-06.pdf',
    composeOwnerStatement: vi.fn().mockResolvedValue({ openLines: [], payments: [], totalOutstandingUsd: 500, paymentsInMonthUsd: 0, openCount: 1 }),
}));
vi.mock('@/services/invoiceService', () => ({ generateStatementPdf: vi.fn().mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46])) }));
vi.mock('@/lib/jurisdictionName', () => ({ fetchJurisdictionName: vi.fn().mockResolvedValue('Republic of Somaliland') }));

import { GET, __setClientForTest } from './route';

const CRON_SECRET = 'test-cron';

function req(auth: string | null, dryRun = false): Request {
    const h = new Headers(); if (auth) h.set('authorization', auth);
    return new Request(`http://localhost/api/cron/monthly-statements${dryRun ? '?dryRun=1' : ''}`, { headers: h });
}

// Faux client : liste des armateurs à solde > 0 + storage.upload + owner_statements.upsert.
function makeClient(owners: Record<string, unknown>[]) {
    const captured = { uploads: [] as string[], upserts: [] as Record<string, unknown>[] };
    const client = {
        from: (t: string) => {
            if (t === 'v_armateur_recouvrement' || t === 'v_compagnie_recouvrement') {
                return { select: () => ({ gt: async () => ({ data: t === 'v_armateur_recouvrement' ? owners : [], error: null }) }) };
            }
            if (t === 'owner_statements') {
                return { upsert: async (p: Record<string, unknown>) => { captured.upserts.push(p); return { error: null }; } };
            }
            throw new Error(`unexpected ${t}`);
        },
        storage: { from: () => ({ upload: async (path: string) => { captured.uploads.push(path); return { error: null }; } }) },
    };
    return { client: client as never, captured };
}

beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    notifyOwnerMock.mockResolvedValue({ id: 'n1' });
});

describe('GET /api/cron/monthly-statements', () => {
    it('rejette sans secret', async () => {
        __setClientForTest(makeClient([]).client);
        expect((await GET(req(null))).status).toBe(401);
    });

    it('génère un relevé par armateur à solde > 0 (upload + upsert + notify)', async () => {
        const { client, captured } = makeClient([
            { id: 'own-1', name: 'Owner One', official_email: 'o1@x.com', jurisdiction_id: 'jur-so', total_outstanding_usd: 500 },
        ]);
        __setClientForTest(client);
        const res = await GET(req(`Bearer ${CRON_SECRET}`));
        expect(res.status).toBe(200);
        expect(captured.uploads).toEqual(['statements/own-1/2026-06.pdf']);
        expect(captured.upserts[0]).toMatchObject({ shipowner_id: 'own-1', pdf_path: 'statements/own-1/2026-06.pdf' });
        expect(notifyOwnerMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            kind: 'STATEMENT_READY', attachments: expect.objectContaining({ pdfBuffer: expect.any(Uint8Array) }),
        }));
    });

    it('dry-run n\'écrit rien', async () => {
        const { client, captured } = makeClient([
            { id: 'own-1', name: 'Owner One', official_email: 'o1@x.com', jurisdiction_id: 'jur-so', total_outstanding_usd: 500 },
        ]);
        __setClientForTest(client);
        const res = await GET(req(`Bearer ${CRON_SECRET}`, true));
        expect(res.status).toBe(200);
        expect(captured.uploads).toHaveLength(0);
        expect(notifyOwnerMock).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `cd frontend && npx vitest run src/app/api/cron/monthly-statements/route.test.ts`
Expected: FAIL — route inexistante.

- [ ] **Step 3 : Implémenter la route**

Créer `frontend/src/app/api/cron/monthly-statements/route.ts` :

```ts
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { generateStatementPdf } from '@/services/invoiceService';
import { composeOwnerStatement, statementStoragePath, periodBounds } from '@/services/statementService';
import { fetchJurisdictionName } from '@/lib/jurisdictionName';
import { notifyOwner } from '@/services/notificationService';
import { scopedLogger } from '@/lib/logger';

/**
 * GET /api/cron/monthly-statements — chantier C.
 * Mensuel (0 6 1 * *). Pour chaque armateur à solde dû > 0, génère un relevé PDF
 * informatif du mois écoulé, le stocke, upsert owner_statements, et notifie
 * STATEMENT_READY (envoi inline avec PDF joint via notifyOwner).
 * Auth : Bearer CRON_SECRET. ?dryRun=1 pour ne rien écrire.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = scopedLogger('cron.monthly-statements');

let clientOverride: SupabaseClient | null = null;
export function __setClientForTest(c: SupabaseClient | null): void { clientOverride = c; }
function serviceClient(): SupabaseClient { return clientOverride ?? createPlatformClient(); }

interface OwnerRow {
    id: string; name: string | null; official_email: string | null;
    jurisdiction_id: string | null; total_outstanding_usd: number;
}

export async function GET(req: NextRequest | Request): Promise<NextResponse> {
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization');
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const dryRun = new URL(req.url).searchParams.get('dryRun') === '1';

    const admin = serviceClient();
    const now = new Date();
    const { periodStart, periodEnd, label } = periodBounds(now);
    const periodMonth = periodStart.toISOString().slice(0, 10);
    const counts = { generated: 0, skipped: 0, failed: 0 };

    // Armateurs (maritime + aviation) à solde dû > 0. Dédup par id.
    const [maritimeRes, aviationRes] = await Promise.all([
        admin.from('v_armateur_recouvrement').select('id, name, official_email, jurisdiction_id, total_outstanding_usd').gt('total_outstanding_usd', 0),
        admin.from('v_compagnie_recouvrement').select('id, name, official_email, jurisdiction_id, total_outstanding_usd').gt('total_outstanding_usd', 0),
    ]);
    const byId = new Map<string, OwnerRow>();
    for (const r of [...((maritimeRes.data ?? []) as OwnerRow[]), ...((aviationRes.data ?? []) as OwnerRow[])]) {
        byId.set(r.id, r);
    }

    for (const owner of byId.values()) {
        try {
            const data = await composeOwnerStatement(admin, { shipownerId: owner.id, periodStart, periodEnd, now });
            const jurisdictionName = await fetchJurisdictionName(admin, owner.jurisdiction_id);
            const pdf = await generateStatementPdf({
                ownerName: owner.name ?? 'Shipowner',
                jurisdiction: jurisdictionName,
                periodLabel: label,
                openLines: data.openLines,
                payments: data.payments,
                totalOutstandingUsd: data.totalOutstandingUsd,
                paymentsInMonthUsd: data.paymentsInMonthUsd,
            });
            const path = statementStoragePath(owner.id, periodStart);

            if (dryRun) { counts.generated += 1; continue; }

            const { error: upErr } = await admin.storage.from('documents')
                .upload(path, pdf, { contentType: 'application/pdf', upsert: true });
            if (upErr) { log.warn('upload_failed', { ownerId: owner.id, error: upErr.message }); counts.failed += 1; continue; }

            await admin.from('owner_statements').upsert({
                shipowner_id: owner.id, jurisdiction_id: owner.jurisdiction_id, period_month: periodMonth,
                pdf_path: path, total_outstanding_usd: data.totalOutstandingUsd,
                payments_in_month_usd: data.paymentsInMonthUsd, open_count: data.openCount,
                generated_at: now.toISOString(),
            }, { onConflict: 'shipowner_id,period_month' });

            await notifyOwner(admin, {
                shipownerId: owner.id, kind: 'STATEMENT_READY',
                params: { period: label, total_outstanding_usd: data.totalOutstandingUsd, period_month: periodMonth },
                deepLink: '/owner/invoices',
                attachments: { pdfBuffer: pdf, filename: `statement-${periodMonth}.pdf` },
            });
            counts.generated += 1;
        } catch (e) {
            counts.failed += 1;
            log.warn('statement_failed', { ownerId: owner.id, error: e instanceof Error ? e.message : String(e) });
        }
    }

    log.info('cron_run_complete', { ...counts, dryRun });
    return NextResponse.json({ ...counts, dryRun });
}
```

- [ ] **Step 4 : Enregistrer le cron dans `vercel.json`**

Ajouter à `crons` : `{ "path": "/api/cron/monthly-statements", "schedule": "0 6 1 * *" }`.

- [ ] **Step 5 : Lancer les tests + compilation**

Run: `cd frontend && npx vitest run src/app/api/cron/monthly-statements/route.test.ts && npx tsc --noEmit`
Expected: PASS ; `tsc` silencieux.

- [ ] **Step 6 : Commit**

```bash
git add frontend/src/app/api/cron/monthly-statements/ frontend/vercel.json
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(statements): cron mensuel de génération des relevés"
```

---

### Task 6 : Portail — section « Relevés » + route de téléchargement

**Files:**
- Create: `frontend/src/app/api/statements/[id]/download/route.ts`
- Modify: `frontend/src/components/owner/pages/OperatorInvoicesPage.tsx`
- Modify: `frontend/messages/{en,fr,pt,so,sw,ar}.json`

**Interfaces:**
- Consumes: `owner_statements` (Task 1).

- [ ] **Step 1 : Route de téléchargement owner-scopée**

Créer `frontend/src/app/api/statements/[id]/download/route.ts` :

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';

/**
 * GET /api/statements/:id/download
 * Owner-scoped (no HMAC — informational). (1) read owner_statements with the
 * owner's RLS client → ownership proof; (2) mint a signed URL with the service
 * client (private bucket) and 302-redirect.
 */
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
    const { id } = await params;
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return new NextResponse('Not found', { status: 404 });

    const { data: row } = await supabase
        .from('owner_statements').select('pdf_path').eq('id', id).maybeSingle();
    if (!row || !(row as { pdf_path: string }).pdf_path) {
        return new NextResponse('Not found', { status: 404 });
    }

    const admin = createPlatformClient();
    const { data: signed, error } = await admin.storage
        .from('documents').createSignedUrl((row as { pdf_path: string }).pdf_path, 300);
    if (error || !signed?.signedUrl) return new NextResponse('Unavailable', { status: 502 });
    return NextResponse.redirect(signed.signedUrl, { status: 302 });
}
```

- [ ] **Step 2 : Compilation de la route**

Run: `cd frontend && npx tsc --noEmit && npx eslint "src/app/api/statements/"`
Expected: `tsc` silencieux ; eslint 0 erreur.

- [ ] **Step 3 : Section « Relevés » sur le portail**

Dans `OperatorInvoicesPage.tsx`, ajouter (après le chargement des transactions) un chargement des relevés et une section. LIRE d'abord la structure réelle du composant serveur (comment il fait ses `principal.supabase.from(...)`, comment `getTranslations` est utilisé, comment `InvoicesTable` est rendu). Ajouter :

```tsx
    const { data: statementsRaw } = await principal.supabase
        .from('owner_statements')
        .select('id, period_month, total_outstanding_usd, generated_at')
        .order('period_month', { ascending: false })
        .limit(24);
    const statements = (statementsRaw ?? []) as {
        id: string; period_month: string; total_outstanding_usd: number; generated_at: string;
    }[];
```

et, sous la table des factures, une section (adapter au style/traductions réels du fichier — utiliser le namespace i18n existant du portail owner) :

```tsx
    {statements.length > 0 && (
        <section className="mt-8">
            <h2 className="text-lg font-semibold text-[var(--os-text-primary)] mb-3">{t('statements_title')}</h2>
            <div className="os-card divide-y divide-[var(--os-border)]">
                {statements.map((s) => (
                    <div key={s.id} className="flex items-center justify-between px-4 py-3">
                        <span className="text-sm text-[var(--os-text-primary)]">{s.period_month.slice(0, 7)}</span>
                        <span className="text-sm font-mono tabular-nums text-[var(--os-text-secondary)]">${Number(s.total_outstanding_usd).toLocaleString()}</span>
                        <a href={`/api/statements/${s.id}/download`} target="_blank" rel="noopener noreferrer"
                           className="text-xs text-emerald-400 hover:underline">{t('statements_download')}</a>
                    </div>
                ))}
            </div>
        </section>
    )}
```

Le fichier utilise déjà `const t = await getTranslations('OwnerPortal.invoices')` (ligne 30) — les clés `statements_title`/`statements_download` vont donc dans le namespace **`OwnerPortal.invoices`** (imbriqué : `OwnerPortal` → `invoices`).

- [ ] **Step 4 : i18n (6 locales)**

Dans chaque `frontend/messages/{en,fr,pt,so,sw,ar}.json`, ajouter dans l'objet `OwnerPortal.invoices` (repérer le bloc existant, ne pas créer de doublon `OwnerPortal` ni `invoices`) :

```json
"statements_title": "Statements",
"statements_download": "Download"
```

`en` référence ; `fr` proprement ; pt/sw/so/ar baseline. Vérifier au passage que `OwnerPortal.invoices` existe déjà dans chaque locale (le composant l'utilise) — y ajouter les 2 clés dedans.

- [ ] **Step 5 : Compilation + i18n check + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/components/owner/pages/OperatorInvoicesPage.tsx`
Expected: `tsc` silencieux ; eslint 0 erreur. Vérifier que les 6 fichiers JSON restent valides (`node -e "['en','fr','pt','so','sw','ar'].forEach(l=>require('./messages/'+l+'.json'));console.log('json ok')"`).

- [ ] **Step 6 : Commit**

```bash
git add frontend/src/app/api/statements/ frontend/src/components/owner/pages/OperatorInvoicesPage.tsx frontend/messages/en.json frontend/messages/fr.json frontend/messages/pt.json frontend/messages/so.json frontend/messages/sw.json frontend/messages/ar.json
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(statements): section relevés au portail armateur + téléchargement owner-scopé"
```

---

### Task 7 : Vérification d'ensemble

- [ ] **Step 1 : Suite complète**

Run: `cd frontend && npx vitest run`
Expected: 0 échec ; total ≥ baseline + les nouveaux tests.

- [ ] **Step 2 : Typage**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune sortie.

- [ ] **Step 3 : Lint non dégradé**

Run: `cd frontend && npm run lint 2>&1 | tail -3`
Expected: `✖ 157 problems (62 errors, 95 warnings)` (baseline `develop`) — ou meilleur. Corriger toute erreur nouvelle sur un fichier touché.

---

## Bascule / déploiement

- Appliquer la mig 112 (`node scripts/db-migrate.mjs`) au déploiement — additive.
- Le cron Vercel `monthly-statements` s'active via `vercel.json`. Premier tir le 1er du mois suivant ; on peut le déclencher manuellement (`?dryRun=1` d'abord) pour valider sans envoyer d'e-mails.
- Aucun secret nouveau requis (relevé non signé).

## Phase 2 (hors périmètre)

Pro-forma **consolidée payable** (référence fiscale + répartition d'un règlement groupé sur les transactions filles) — chantier distinct à spécifier.
