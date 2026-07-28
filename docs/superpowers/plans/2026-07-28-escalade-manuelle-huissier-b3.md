# Escalade manuelle huissier/judiciaire + édition des CC (B3) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre au staff d'escalader manuellement une créance vers une notice huissier puis judiciaire (avec facture jointe, rampe imposée, trace au registre, CC huissier), et d'éditer les adresses en copie par juridiction.

**Architecture:** Une server action `escalateCollection` (modelée sur `escalateToOwner`) envoie une notice contentieuse dédiée et écrit une ligne `collection_reminders` tier BAILIFF/JUDICIAL ; des boutons dans le panneau détail B2 la déclenchent selon l'état de la rampe ; un éditeur sur `admin/jurisdictions` (action `updateJurisdictionCcEmails`) alimente `bailiff_cc_emails`/`billing_cc_emails`. **Aucune migration** — tables/colonnes/enums existent déjà (mig 094/109/110).

**Tech Stack:** Next.js 15 (server actions) / TypeScript strict / Supabase / Resend / next-intl / Vitest / `Os*` + Radix Dialog.

**Spec:** [2026-07-28-escalade-manuelle-huissier-design.md](../specs/2026-07-28-escalade-manuelle-huissier-design.md)

## Global Constraints

- TypeScript strict, `any` interdit. Commits atomiques humanisés, auteur `Loic Leclerc <leclerc@drwintech.com>` via `git commit --author=`. Jamais de `Co-Authored-By: Claude` ni « Generated with Claude Code ». Staging explicite (paths).
- Rôles staff : `PORT_OFFICER`, `FINANCE_ADMIN`, `SUPERADMIN` (les 3). Toute action de mutation vérifie le rôle **depuis `profiles`** (jamais le JWT) + `is_active`.
- `collection_reminders` et `jurisdiction_billing_cc` ne sont **pas** tenant-scopées : l'isolation juridiction des mutations est **explicite** (`jurisdiction_id === getServerJurisdictionId()` pour non-SUPERADMIN), jamais déléguée au client.
- **Rampe** : `BAILIFF` exige une relance `J45` existante ; `JUDICIAL` exige une `BAILIFF`. **Anti-doublon** : une seule ligne par `(transaction_id, tier)` (index unique mig 094) ; ré-escalade refusée avant l'insert, conflit 23505 géré si course.
- **PDF requis** : escalade refusée sans `invoice_pdf_url`.
- **Échec e-mail = abandon** (pas d'insert au registre) — une escalade contentieuse ne se trace pas si la notice n'est pas partie.
- Audit sans migration d'enum : `action:'TRANSACTION_UPDATED'` + `details_json.event` (`ESCALATED_BAILIFF`/`ESCALATED_JUDICIAL`, `severity:'WARNING'` ; `JURISDICTION_CC_UPDATED`, `severity:'INFO'`).
- Tests depuis `frontend/` : préfixer chaque commande par `cd /c/Users/lecle/Workspace/africgreen/frontend &&` (le shell se réinitialise ; lancer depuis la racine casse les alias `@/` et tire la mauvaise version de vitest). Mode d'échec n°1.
- Ne pas dégrader le baseline lint (`157 problems / 62 errors` sur `develop`).

---

### Task 1 : E-mail contentieux `sendCollectionEscalationEmail`

**Files:**
- Modify: `frontend/src/services/emailService.ts` (ajouter la fonction + son interface)
- Test: `frontend/src/services/emailService.escalation.test.ts`

**Interfaces:**
- Produces: `CollectionEscalationParams`, `sendCollectionEscalationEmail(p): Promise<EmailResult>`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/services/emailService.escalation.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({ Resend: class { emails = { send: sendMock }; } }));

const base = {
    to: 'billing@armateur.com',
    cc: ['huissier@eidle.so', 'finance@so.gov'],
    recipientName: 'Demo Armateur',
    invoiceRef: 'PRO-2026-30-81be71091a2b',
    amountUsd: 11492,
    jurisdictionName: 'Republic of Djibouti',
    vesselName: 'GG DEMO PIONEER',
    pdfBuffer: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
};

beforeEach(() => {
    vi.resetModules();
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: 'e1' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
});

describe('sendCollectionEscalationEmail', () => {
    it('emploie un ton de renvoi huissier pour BAILIFF, avec PDF joint et cc', async () => {
        const { sendCollectionEscalationEmail } = await import('./emailService');
        await sendCollectionEscalationEmail({ ...base, tier: 'BAILIFF' });
        const call = sendMock.mock.calls[0][0];
        expect(String(call.subject)).toMatch(/bailiff|huissier/i);
        expect(String(call.html)).toMatch(/bailiff|huissier|legal recovery/i);
        expect(call.cc).toEqual(['huissier@eidle.so', 'finance@so.gov']);
        expect(call.attachments?.[0]?.filename).toMatch(/PRO-2026-30-81be71091a2b/);
        // souverain de la juridiction émettrice, pas le Somaliland par défaut
        expect(String(call.html)).toContain('Republic of Djibouti');
    });

    it('emploie un ton de procédure judiciaire pour JUDICIAL', async () => {
        const { sendCollectionEscalationEmail } = await import('./emailService');
        await sendCollectionEscalationEmail({ ...base, tier: 'JUDICIAL' });
        const call = sendMock.mock.calls[0][0];
        expect(String(call.subject)).toMatch(/judicial|judiciaire|proceedings/i);
        expect(String(call.html)).toMatch(/judicial|judiciaire|proceedings/i);
    });

    it('remonte l\'échec Resend', async () => {
        sendMock.mockResolvedValue({ data: null, error: { message: 'smtp down' } });
        const { sendCollectionEscalationEmail } = await import('./emailService');
        const r = await sendCollectionEscalationEmail({ ...base, tier: 'BAILIFF' });
        expect(r.success).toBe(false);
    });
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `cd frontend && npx vitest run src/services/emailService.escalation.test.ts`
Expected: FAIL — `sendCollectionEscalationEmail` n'existe pas.

- [ ] **Step 3 : Implémenter**

Dans `frontend/src/services/emailService.ts`, après `sendProformaReminderEmail` (vers la ligne 690), ajouter :

```ts
// ── Collection escalation notice (B3 — manual bailiff/judicial) ────────────
// Distinct from the automatic reminders: a legal-recovery NOTIFICATION (not a
// legal service of process) sent by staff, with the invoice PDF attached and
// the issuing jurisdiction's sovereign footer.

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

function escalationTone(tier: 'BAILIFF' | 'JUDICIAL', invoiceRef: string): {
    subject: string; heading: string; alertText: string;
} {
    if (tier === 'JUDICIAL') {
        return {
            subject: `Judicial recovery proceedings — ${invoiceRef}`,
            heading: 'Notice of Judicial Recovery Proceedings',
            alertText: 'Judicial recovery proceedings have been initiated for this outstanding debt. You are urged to settle immediately to avoid further legal costs.',
        };
    }
    return {
        subject: `Bailiff referral — ${invoiceRef}`,
        heading: 'Notice of Referral to Bailiff (Huissier)',
        alertText: 'This outstanding debt has been referred to a bailiff (huissier) for legal recovery, at your expense. Immediate settlement is required to halt enforcement.',
    };
}

export async function sendCollectionEscalationEmail(p: CollectionEscalationParams): Promise<EmailResult> {
    const t = escalationTone(p.tier, p.invoiceRef);
    const vesselRow = p.vesselName
        ? `<div class="meta-row"><span class="meta-label">Vessel</span><span class="meta-value">${escapeHtml(p.vesselName)}</span></div>`
        : '';
    const content = `
        <h1>${t.heading}</h1>
        <p>Dear ${escapeHtml(p.recipientName)},</p>
        <p>Regarding outstanding pro-forma invoice <strong style="font-family:monospace">${escapeHtml(p.invoiceRef)}</strong>:</p>

        <h2>Summary</h2>
        <div class="meta-row"><span class="meta-label">Invoice</span><span class="meta-value" style="font-family:monospace">${escapeHtml(p.invoiceRef)}</span></div>
        ${vesselRow}
        <div class="meta-row"><span class="meta-label">Amount Due</span><span class="meta-value" style="color:#EF4444;font-size:16px">$${p.amountUsd.toLocaleString()}</span></div>

        <div class="alert alert-danger">${t.alertText}</div>

        <p style="margin-top:24px;font-size:12px;color:#94A3B8">This is an automated notification. Reference: ${escapeHtml(p.invoiceRef)}</p>
    `;

    return sendEmail({
        to: p.to,
        cc: p.cc,
        subject: t.subject,
        html: emailLayout(content, {
            previewText: `${t.subject} — $${p.amountUsd.toLocaleString()}`,
            sovereignLine: `${p.jurisdictionName} · Maritime Carbon Tax Authority`,
        }),
        text: `${t.subject}\nInvoice: ${p.invoiceRef}\nAmount: $${p.amountUsd.toLocaleString()}\n\n${t.alertText}`,
        attachments: [
            { filename: `invoice-${p.invoiceRef}.pdf`, content: Buffer.from(p.pdfBuffer) },
        ],
    });
}
```

- [ ] **Step 4 : Lancer les tests + compilation**

Run: `cd frontend && npx vitest run src/services/emailService.escalation.test.ts && npx tsc --noEmit`
Expected: PASS ; `tsc` silencieux.

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/services/emailService.ts frontend/src/services/emailService.escalation.test.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(collections): e-mail de notice contentieuse huissier/judiciaire (PDF joint)"
```

---

### Task 2 : Action `escalateCollection`

**Files:**
- Create: `frontend/src/actions/escalateCollection.ts`
- Test: `frontend/src/actions/escalateCollection.test.ts`

**Interfaces:**
- Consumes: `createClient` (`@/lib/supabase/server`), `createPlatformClient` (`@/lib/supabase/tenant`), `getServerJurisdictionId` (`@/lib/auth/tenantContext`), `resolveInvoiceRecipients` (`@/services/invoiceIssuanceService`), `fetchJurisdictionBillingCc`/`fetchJurisdictionBailiffCc`/`fetchJurisdictionName` (`@/lib/jurisdictionName`), `sendCollectionEscalationEmail` (Task 1).
- Produces: `escalateCollection(raw): Promise<{ ok: true; tier: 'BAILIFF'|'JUDICIAL' } | { ok: false; reason: string }>`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/actions/escalateCollection.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUserMock = vi.fn();
const serverFromMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
    createClient: async () => ({ auth: { getUser: getUserMock }, from: serverFromMock }),
}));

const platformFromMock = vi.fn();
const storageDownloadMock = vi.fn();
vi.mock('@/lib/supabase/tenant', () => ({
    createPlatformClient: () => ({ from: platformFromMock, storage: { from: () => ({ download: storageDownloadMock }) } }),
}));

vi.mock('@/lib/auth/tenantContext', () => ({ getServerJurisdictionId: vi.fn(async () => 'jur-so') }));
vi.mock('@/lib/jurisdictionName', () => ({
    fetchJurisdictionBillingCc: vi.fn(async () => ['finance@so.gov']),
    fetchJurisdictionBailiffCc: vi.fn(async () => ['huissier@eidle.so']),
    fetchJurisdictionName: vi.fn(async () => 'Republic of Somaliland'),
}));
vi.mock('@/services/invoiceIssuanceService', () => ({
    resolveInvoiceRecipients: vi.fn(() => ({ to: 'billing@armateur.com', cc: ['huissier@eidle.so'] })),
}));
const sendEscalationMock = vi.fn(async () => ({ success: true, id: 'e1' }));
vi.mock('@/services/emailService', () => ({ sendCollectionEscalationEmail: sendEscalationMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { escalateCollection } from './escalateCollection';

const TXN = '11111111-1111-4111-8111-111111111111';

// Fabrique le client platform : transaction + relances existantes + inserts capturés.
function setup(opts: {
    role?: string; isActive?: boolean; txnJur?: string; pdf?: string | null;
    sentTiers?: string[]; insertErr?: { code?: string; message: string } | null;
}) {
    const captured = { reminderInsert: null as Record<string, unknown> | null, audit: null as Record<string, unknown> | null };
    serverFromMock.mockImplementation((t: string) => {
        if (t === 'profiles') return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: opts.role ?? 'FINANCE_ADMIN', is_active: opts.isActive ?? true } }) }) }) };
        throw new Error(`server table ${t}`);
    });
    storageDownloadMock.mockResolvedValue({ data: { arrayBuffer: async () => new Uint8Array([1]).buffer }, error: null });
    // Les relances existantes sont lues via `.select('tier').eq('transaction_id', …)` (await direct
    // du query builder) — on renvoie un thenable qui résout vers { data: [{tier}], error }.
    const remBuilder = { then: (res: (v: { data: { tier: string }[]; error: null }) => unknown) => res({ data: (opts.sentTiers ?? []).map((tier) => ({ tier })), error: null }) };
    platformFromMock.mockImplementation((t: string) => {
        if (t === 'transactions') return { select: () => ({ eq: () => ({ single: async () => ({
            data: {
                id: TXN, jurisdiction_id: opts.txnJur ?? 'jur-so', invoice_ref: 'PRO-1', tax_amount_usd: 500,
                shipowner_id: 'own-1', agent_profile_id: null, invoice_pdf_url: opts.pdf === undefined ? 'SO/proformas/2026/07/PRO-1.pdf' : opts.pdf,
                vessel: { name: 'MV X', imo_number: 'IMO1' }, shipowner: { name: 'Owner', official_email: 'billing@armateur.com' }, agent: null,
            }, error: null }) }) }) };
        if (t === 'collection_reminders') return {
            select: () => ({ eq: () => remBuilder }),
            insert: (payload: Record<string, unknown>) => { captured.reminderInsert = payload; return Promise.resolve({ error: opts.insertErr ?? null }); },
        };
        if (t === 'audit_logs') return { insert: async (p: Record<string, unknown>) => { captured.audit = p; return { error: null }; } };
        throw new Error(`platform table ${t}`);
    });
    return captured;
}

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1', email: 'staff@gg.africa' } } });
    sendEscalationMock.mockResolvedValue({ success: true, id: 'e1' });
});

describe('escalateCollection — rampe', () => {
    it('refuse BAILIFF sans J45', async () => {
        setup({ sentTiers: ['J3', 'J7', 'J15', 'J30'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/ramp|J45/i) });
    });

    it('accepte BAILIFF quand J45 existe', async () => {
        const cap = setup({ sentTiers: ['J45'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: true, tier: 'BAILIFF' });
        expect(cap.reminderInsert).toMatchObject({ tier: 'BAILIFF', escalated_bailiff: true });
        expect(cap.audit).toMatchObject({ severity: 'WARNING', details_json: expect.objectContaining({ event: 'ESCALATED_BAILIFF' }) });
    });

    it('refuse JUDICIAL sans BAILIFF', async () => {
        setup({ sentTiers: ['J45'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'JUDICIAL' });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/ramp|bailiff/i) });
    });

    it('accepte JUDICIAL quand BAILIFF existe', async () => {
        const cap = setup({ sentTiers: ['J45', 'BAILIFF'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'JUDICIAL' });
        expect(r).toMatchObject({ ok: true, tier: 'JUDICIAL' });
        expect(cap.reminderInsert).toMatchObject({ tier: 'JUDICIAL', escalated_bailiff: true });
    });
});

describe('escalateCollection — gardes', () => {
    it('refuse un doublon (tier déjà présent)', async () => {
        setup({ sentTiers: ['J45', 'BAILIFF'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/already escalated/i) });
    });

    it('refuse sans PDF stocké', async () => {
        setup({ sentTiers: ['J45'], pdf: null });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/no stored PDF/i) });
    });

    it('refuse un rôle non-staff', async () => {
        setup({ role: 'SHIPPING_AGENT', sentTiers: ['J45'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: false });
    });

    it('refuse un staff désactivé', async () => {
        setup({ isActive: false, sentTiers: ['J45'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/inactive/i) });
    });

    it('refuse un staff hors juridiction', async () => {
        setup({ txnJur: 'jur-dj', sentTiers: ['J45'] });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: false, reason: 'forbidden' });
    });

    it("n'insère rien si l'e-mail échoue", async () => {
        const cap = setup({ sentTiers: ['J45'] });
        sendEscalationMock.mockResolvedValue({ success: false, error: 'smtp' });
        const r = await escalateCollection({ transactionId: TXN, tier: 'BAILIFF' });
        expect(r).toMatchObject({ ok: false });
        expect(cap.reminderInsert).toBeNull();
    });
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `cd frontend && npx vitest run src/actions/escalateCollection.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

Créer `frontend/src/actions/escalateCollection.ts` :

```ts
'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';
import { resolveInvoiceRecipients } from '@/services/invoiceIssuanceService';
import {
    fetchJurisdictionBillingCc, fetchJurisdictionBailiffCc, fetchJurisdictionName,
} from '@/lib/jurisdictionName';
import { sendCollectionEscalationEmail } from '@/services/emailService';

const STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

const inputSchema = z.object({
    transactionId: z.string().uuid(),
    tier: z.enum(['BAILIFF', 'JUDICIAL']),
});

export async function escalateCollection(
    raw: unknown,
): Promise<{ ok: true; tier: 'BAILIFF' | 'JUDICIAL' } | { ok: false; reason: string }> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    const { transactionId, tier } = parsed.data;

    // 1. Auth + rôle staff + is_active.
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };
    const { data: profile } = await supabase.from('profiles').select('role, is_active').eq('id', auth.user.id).single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) return { ok: false, reason: 'insufficient role' };
    if (profile.is_active === false) return { ok: false, reason: 'account inactive' };

    const platform = createPlatformClient();

    // 2. Charge la transaction (regardless of tenant).
    const { data: txn, error: txnErr } = await platform
        .from('transactions')
        .select(`
            id, jurisdiction_id, invoice_ref, tax_amount_usd, shipowner_id, agent_profile_id, invoice_pdf_url,
            vessel:vessels (name, imo_number),
            shipowner:shipowners (name, official_email),
            agent:profiles!transactions_agent_profile_id_fkey (email)
        `)
        .eq('id', transactionId)
        .single();
    if (txnErr || !txn) return { ok: false, reason: `transaction not found: ${txnErr?.message ?? 'nil'}` };

    const t = txn as unknown as {
        jurisdiction_id: string | null; invoice_ref: string | null; tax_amount_usd: number;
        shipowner_id: string | null; invoice_pdf_url: string | null;
        vessel: { name: string } | { name: string }[] | null;
        shipowner: { name: string; official_email: string | null } | { name: string; official_email: string | null }[] | null;
        agent: { email: string | null } | { email: string | null }[] | null;
    };
    const jurisdictionId = t.jurisdiction_id;

    // 3. Isolation explicite.
    if (profile.role !== 'SUPERADMIN') {
        const staffJur = await getServerJurisdictionId();
        if (jurisdictionId !== staffJur) return { ok: false, reason: 'forbidden' };
    }

    // 4. Rampe + anti-doublon (relances existantes).
    const { data: remRows } = await platform
        .from('collection_reminders').select('tier').eq('transaction_id', transactionId);
    const sentTiers = ((remRows ?? []) as { tier: string }[]).map((r) => r.tier);
    if (sentTiers.includes(tier)) return { ok: false, reason: `already escalated to ${tier}` };
    if (tier === 'BAILIFF' && !sentTiers.includes('J45')) {
        return { ok: false, reason: 'ramp: a J45 (pre-bailiff) reminder must be sent first' };
    }
    if (tier === 'JUDICIAL' && !sentTiers.includes('BAILIFF')) {
        return { ok: false, reason: 'ramp: a bailiff notice must be issued first' };
    }

    // 5. PDF requis + téléchargement.
    if (!t.invoice_pdf_url) return { ok: false, reason: 'no stored PDF — regenerate first' };
    const { data: pdfBlob, error: dlErr } = await platform.storage.from('documents').download(t.invoice_pdf_url);
    if (dlErr || !pdfBlob) return { ok: false, reason: `PDF download: ${dlErr?.message ?? 'nil'}` };
    const pdfBuffer = new Uint8Array(await pdfBlob.arrayBuffer());

    // 6. Destinataires (cascade + CC facturation + CC huissier).
    const vessel = Array.isArray(t.vessel) ? t.vessel[0] : t.vessel;
    const owner = Array.isArray(t.shipowner) ? t.shipowner[0] : t.shipowner;
    const agent = Array.isArray(t.agent) ? t.agent[0] : t.agent;
    const [billingCc, bailiffCc] = await Promise.all([
        fetchJurisdictionBillingCc(platform, jurisdictionId),
        fetchJurisdictionBailiffCc(platform, jurisdictionId),
    ]);
    const recipients = resolveInvoiceRecipients({
        shipownerBillingEmail: owner?.official_email ?? null,
        agentEmail: agent?.email ?? null,
        vesselOwnerEmail: null,
        jurisdictionCcEmails: [...billingCc, ...bailiffCc],
        platformCcEmail: process.env.PLATFORM_BILLING_CC ?? null,
    });
    if (!recipients) return { ok: false, reason: 'no reachable recipient' };

    // 7. Envoi de la notice (échec = abandon, pas d'insert).
    const jurisdictionName = await fetchJurisdictionName(platform, jurisdictionId);
    const invoiceRef = t.invoice_ref ?? transactionId;
    const emailResult = await sendCollectionEscalationEmail({
        tier, to: recipients.to, cc: recipients.cc, recipientName: owner?.name ?? 'Registered Owner',
        invoiceRef, amountUsd: Number(t.tax_amount_usd), jurisdictionName, vesselName: vessel?.name, pdfBuffer,
    });
    if (!emailResult.success) return { ok: false, reason: `email failed: ${emailResult.error ?? 'unknown'}` };

    // 8. Registre.
    const { error: insErr } = await platform.from('collection_reminders').insert({
        transaction_id: transactionId, tier, sent_at: new Date().toISOString(),
        sent_email: recipients.to, cc_emails: recipients.cc,
        template_used: `${tier.toLowerCase()}_notice`, escalated_bailiff: true, debtor_response_type: 'SILENT',
    });
    if (insErr) {
        // 23505 = course avec un autre escalade même tier → déjà tracé.
        return { ok: false, reason: `already escalated to ${tier}` };
    }

    // 9. Audit.
    await platform.from('audit_logs').insert({
        user_id: auth.user.id, user_full_name: auth.user.email ?? 'Staff',
        action: 'TRANSACTION_UPDATED', severity: 'WARNING',
        entity_type: 'Transaction', entity_id: transactionId, jurisdiction_id: jurisdictionId,
        details_json: { event: `ESCALATED_${tier}`, tier, recipient: recipients.to, cc: recipients.cc },
    });

    revalidatePath('/admin/collections');
    return { ok: true, tier };
}
```

- [ ] **Step 4 : Lancer les tests + compilation**

Run: `cd frontend && npx vitest run src/actions/escalateCollection.test.ts && npx tsc --noEmit`
Expected: PASS ; `tsc` silencieux. Si un chaînage de faux client ne correspond pas à l'ordre réel des appels de l'action (`select().eq()` sur `collection_reminders` renvoie un thenable de tableau ; `insert()` renvoie `{error}`), aligner le mock sur l'action — ne pas affaiblir la logique de l'action.

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/actions/escalateCollection.ts frontend/src/actions/escalateCollection.test.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(collections): escalade manuelle huissier/judiciaire (rampe, PDF requis, audité)"
```

---

### Task 3 : Boutons d'escalade + timeline dans le panneau détail

**Files:**
- Modify: `frontend/src/app/(dashboard)/admin/collections/CollectionsAdminList.tsx`

**Interfaces:**
- Consumes: `escalateCollection` (Task 2).

- [ ] **Step 1 : Ajouter `escalated_bailiff` au chargement des relances**

Dans `CollectionsAdminList.tsx`, l'interface `ReminderRow` et le `.select(...)` du `DetailPanel` : ajouter `escalated_bailiff`.

```ts
interface ReminderRow {
    id: string; tier: string; sent_at: string; sent_email: string; cc_emails: string[] | null;
    template_used: string; debtor_response_type: string; debtor_response_at: string | null;
    escalated_bailiff: boolean;
}
```

et le select :

```ts
            .select('id, tier, sent_at, sent_email, cc_emails, template_used, debtor_response_type, debtor_response_at, escalated_bailiff')
```

- [ ] **Step 2 : Ajouter les boutons d'escalade + dialogues**

Dans `DetailPanel`, importer l'action et ajouter l'état de rampe dérivé des `reminders`, deux boutons dans l'en-tête, et un dialogue de confirmation générique. Ajouter en haut du fichier :

```tsx
import { escalateCollection } from '@/actions/escalateCollection';
```

Dans `DetailPanel`, après le calcul de `reminders`, dériver l'état (placer ces constantes après le `useState`/`useEffect` qui chargent `reminders`, en gardant `reminders ?? []`) :

```tsx
    const tiers = (reminders ?? []).map((r) => r.tier);
    const canBailiff = tiers.includes('J45') && !tiers.includes('BAILIFF');
    const canJudicial = tiers.includes('BAILIFF') && !tiers.includes('JUDICIAL');
    const [escalateTier, setEscalateTier] = React.useState<'BAILIFF' | 'JUDICIAL' | null>(null);
    const [escalateError, setEscalateError] = React.useState<string | null>(null);
    const [escalating, startEscalate] = React.useTransition();

    function confirmEscalate() {
        if (!escalateTier) return;
        setEscalateError(null);
        startEscalate(async () => {
            const res = await escalateCollection({ transactionId: row.transaction_id, tier: escalateTier });
            if (!res.ok) { setEscalateError(res.reason); return; }
            setEscalateTier(null);
            onSaved();
        });
    }
```

Dans l'en-tête du panneau (à côté du bouton `record_response`), ajouter :

```tsx
                    <OsButton size="sm" variant="danger" disabled={!canBailiff}
                        title={canBailiff ? undefined : t('escalate_ramp_bailiff')}
                        onClick={() => { setEscalateError(null); setEscalateTier('BAILIFF'); }}>
                        {t('escalate_bailiff')}
                    </OsButton>
                    <OsButton size="sm" variant="danger" disabled={!canJudicial}
                        title={canJudicial ? undefined : t('escalate_ramp_judicial')}
                        onClick={() => { setEscalateError(null); setEscalateTier('JUDICIAL'); }}>
                        {t('escalate_judicial')}
                    </OsButton>
```

Et, à la fin du panneau (à côté du dialogue de réponse existant), un dialogue de confirmation :

```tsx
            <Dialog.Root open={escalateTier !== null} onOpenChange={(o) => !o && setEscalateTier(null)}>
                <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0" style={{ background: 'rgba(0,0,0,0.6)' }} />
                    <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] max-w-[92vw] rounded-2xl p-5"
                        style={{ background: 'var(--os-surface-2)', border: '1px solid var(--os-border)' }}>
                        <Dialog.Title className="text-sm font-bold text-[var(--os-text-primary)]">{t('escalate_dialog_title')}</Dialog.Title>
                        <Dialog.Description className="text-xs text-[var(--os-text-muted)] mb-3">
                            {t('escalate_dialog_subtitle', { tier: escalateTier ?? '', ref: row.invoice_ref ?? row.transaction_id.slice(0, 8) })}
                        </Dialog.Description>
                        {escalateError && <p className="text-xs text-[#EF4444] mt-2">{escalateError}</p>}
                        <div className="flex justify-end gap-2 mt-4">
                            <OsButton size="sm" variant="ghost" onClick={() => setEscalateTier(null)}>{t('cancel')}</OsButton>
                            <OsButton size="sm" variant="danger" loading={escalating} onClick={confirmEscalate}>{t('escalate_confirm')}</OsButton>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
```

Dans la timeline (`<li>` de chaque relance), ajouter un marqueur quand `r.escalated_bailiff` ou tier contentieux :

```tsx
                            {(r.escalated_bailiff || r.tier === 'BAILIFF' || r.tier === 'JUDICIAL') && (
                                <OsBadge variant="critical" label={t('escalated_badge')} />
                            )}
```

- [ ] **Step 3 : Compilation + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint "src/app/(dashboard)/admin/collections/"`
Expected: `tsc` silencieux ; eslint 0 erreur. Vérifier que `OsButton` accepte `variant="danger"` et `title` (attributs natifs) — voir `OsButton.tsx` ; adapter si besoin sans inventer de prop. Les clés i18n référencées ici sont ajoutées en Task 6 — leur absence à ce stade est attendue.

- [ ] **Step 4 : Commit**

```bash
git add "frontend/src/app/(dashboard)/admin/collections/CollectionsAdminList.tsx"
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(collections): boutons d'escalade huissier/judiciaire + marqueur timeline"
```

---

### Task 4 : Action `updateJurisdictionCcEmails`

**Files:**
- Create: `frontend/src/actions/updateJurisdictionCcEmails.ts`
- Test: `frontend/src/actions/updateJurisdictionCcEmails.test.ts`

**Interfaces:**
- Produces: `updateJurisdictionCcEmails(raw): Promise<{ ok: true } | { ok: false; reason: string }>`.

- [ ] **Step 1 : Écrire le test qui échoue**

Créer `frontend/src/actions/updateJurisdictionCcEmails.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUserMock = vi.fn();
const serverFromMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: getUserMock }, from: serverFromMock }) }));
const platformFromMock = vi.fn();
vi.mock('@/lib/supabase/tenant', () => ({ createPlatformClient: () => ({ from: platformFromMock }) }));
vi.mock('@/lib/auth/tenantContext', () => ({ getServerJurisdictionId: vi.fn(async () => 'jur-so') }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { updateJurisdictionCcEmails } from './updateJurisdictionCcEmails';

const JID = '00000000-0000-4000-8000-00000000534f';

function setup(opts: { role?: string; isActive?: boolean } = {}) {
    const captured = { upsert: null as Record<string, unknown> | null, audit: null as Record<string, unknown> | null };
    serverFromMock.mockImplementation(() => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: opts.role ?? 'FINANCE_ADMIN', is_active: opts.isActive ?? true } }) }) }) }));
    platformFromMock.mockImplementation((t: string) => {
        if (t === 'jurisdiction_billing_cc') return { upsert: async (p: Record<string, unknown>) => { captured.upsert = p; return { error: null }; } };
        if (t === 'audit_logs') return { insert: async (p: Record<string, unknown>) => { captured.audit = p; return { error: null }; } };
        throw new Error(`platform table ${t}`);
    });
    return captured;
}

beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'staff-1', email: 'staff@gg.africa' } } });
});

describe('updateJurisdictionCcEmails', () => {
    it('upsert les deux listes + audit', async () => {
        const cap = setup();
        const r = await updateJurisdictionCcEmails({ jurisdictionId: JID, billingCcEmails: ['a@so.gov'], bailiffCcEmails: ['huissier@eidle.so'] });
        expect(r).toMatchObject({ ok: true });
        expect(cap.upsert).toMatchObject({ jurisdiction_id: JID, cc_emails: ['a@so.gov'], bailiff_cc_emails: ['huissier@eidle.so'] });
        expect(cap.audit).toMatchObject({ entity_type: 'Jurisdiction', details_json: expect.objectContaining({ event: 'JURISDICTION_CC_UPDATED' }) });
    });

    it('rejette un e-mail invalide', async () => {
        setup();
        const r = await updateJurisdictionCcEmails({ jurisdictionId: JID, billingCcEmails: ['not-an-email'], bailiffCcEmails: [] });
        expect(r).toMatchObject({ ok: false });
    });

    it('refuse un rôle non-staff', async () => {
        setup({ role: 'SHIPPING_AGENT' });
        const r = await updateJurisdictionCcEmails({ jurisdictionId: JID, billingCcEmails: [], bailiffCcEmails: [] });
        expect(r).toMatchObject({ ok: false });
    });

    it('refuse un staff désactivé', async () => {
        setup({ isActive: false });
        const r = await updateJurisdictionCcEmails({ jurisdictionId: JID, billingCcEmails: [], bailiffCcEmails: [] });
        expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/inactive/i) });
    });

    it('refuse un staff hors juridiction (non-SUPERADMIN)', async () => {
        setup({ role: 'FINANCE_ADMIN' });
        const r = await updateJurisdictionCcEmails({ jurisdictionId: '00000000-0000-4000-8000-00000000444a', billingCcEmails: [], bailiffCcEmails: [] });
        expect(r).toMatchObject({ ok: false, reason: 'forbidden' });
    });
});
```

- [ ] **Step 2 : Lancer pour vérifier l'échec**

Run: `cd frontend && npx vitest run src/actions/updateJurisdictionCcEmails.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3 : Implémenter**

Créer `frontend/src/actions/updateJurisdictionCcEmails.ts` :

```ts
'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { getServerJurisdictionId } from '@/lib/auth/tenantContext';

const STAFF_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'];

const emailList = z.array(z.string().trim().email()).max(20);
const inputSchema = z.object({
    jurisdictionId: z.string().uuid(),
    billingCcEmails: emailList,
    bailiffCcEmails: emailList,
});

export async function updateJurisdictionCcEmails(
    raw: unknown,
): Promise<{ ok: true } | { ok: false; reason: string }> {
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: parsed.error.issues[0]?.message ?? 'invalid input' };
    const { jurisdictionId, billingCcEmails, bailiffCcEmails } = parsed.data;

    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, reason: 'not authenticated' };
    const { data: profile } = await supabase.from('profiles').select('role, is_active').eq('id', auth.user.id).single();
    if (!profile || !STAFF_ROLES.includes(profile.role)) return { ok: false, reason: 'insufficient role' };
    if (profile.is_active === false) return { ok: false, reason: 'account inactive' };

    // Isolation explicite : jurisdiction_billing_cc a une RLS staff-only NON scopée
    // par juridiction (tout officer passe) — la confinement se fait ici.
    if (profile.role !== 'SUPERADMIN') {
        const staffJur = await getServerJurisdictionId();
        if (jurisdictionId !== staffJur) return { ok: false, reason: 'forbidden' };
    }

    const platform = createPlatformClient();
    const { error: upErr } = await platform.from('jurisdiction_billing_cc').upsert({
        jurisdiction_id: jurisdictionId,
        cc_emails: billingCcEmails,
        bailiff_cc_emails: bailiffCcEmails,
        updated_at: new Date().toISOString(),
    });
    if (upErr) return { ok: false, reason: `update failed: ${upErr.message}` };

    await platform.from('audit_logs').insert({
        user_id: auth.user.id, user_full_name: auth.user.email ?? 'Staff',
        action: 'TRANSACTION_UPDATED', severity: 'INFO',
        entity_type: 'Jurisdiction', entity_id: jurisdictionId, jurisdiction_id: jurisdictionId,
        details_json: { event: 'JURISDICTION_CC_UPDATED', billingCount: billingCcEmails.length, bailiffCount: bailiffCcEmails.length },
    });

    revalidatePath('/admin/jurisdictions');
    return { ok: true };
}
```

- [ ] **Step 4 : Lancer les tests + compilation**

Run: `cd frontend && npx vitest run src/actions/updateJurisdictionCcEmails.test.ts && npx tsc --noEmit`
Expected: PASS ; `tsc` silencieux.

- [ ] **Step 5 : Commit**

```bash
git add frontend/src/actions/updateJurisdictionCcEmails.ts frontend/src/actions/updateJurisdictionCcEmails.test.ts
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(jurisdictions): action d'édition des copies recouvrement (facturation + huissier)"
```

---

### Task 5 : Éditeur CC sur `admin/jurisdictions`

**Files:**
- Modify: `frontend/src/app/(dashboard)/admin/jurisdictions/page.tsx`
- Modify: `frontend/src/components/dashboard/admin/AdminJurisdictions.tsx`

**Interfaces:**
- Consumes: `updateJurisdictionCcEmails` (Task 4).

- [ ] **Step 1 : Charger les CC dans la page serveur**

Dans `page.tsx`, ajouter au `Promise.all` une requête `jurisdiction_billing_cc`, et passer la map au composant.

```ts
        platform
            .from('jurisdiction_billing_cc')
            .select('jurisdiction_id, cc_emails, bailiff_cc_emails'),
```

Récupérer le résultat (ajouter `billingCcRes` à la déstructuration du `Promise.all`), construire une map `Record<string, { cc_emails: string[]; bailiff_cc_emails: string[] }>` par `jurisdiction_id`, et la passer en prop `ccByJurisdiction` à `<AdminJurisdictions … />`.

- [ ] **Step 2 : Ajouter le type de prop + la section dans le composant**

Dans `AdminJurisdictions.tsx`, étendre l'interface `Props` avec :

```ts
    ccByJurisdiction?: Record<string, { cc_emails: string[]; bailiff_cc_emails: string[] }>;
```

Ajouter un sous-composant `RecoveryCcSection` (modelé sur les sous-sections par juridiction du fichier, ex. `SplitSection`), rendu pour chaque juridiction dans la boucle de rendu, à côté des sections existantes :

```tsx
function RecoveryCcSection({ jid, initial, canEdit }: {
    jid: string;
    initial: { cc_emails: string[]; bailiff_cc_emails: string[] };
    canEdit: boolean;
}) {
    const t = useTranslations('AdminJurisdictions');
    const [billing, setBilling] = React.useState(initial.cc_emails.join(', '));
    const [bailiff, setBailiff] = React.useState(initial.bailiff_cc_emails.join(', '));
    const [saving, startSave] = React.useTransition();
    const [msg, setMsg] = React.useState<string | null>(null);

    function parse(s: string): string[] {
        return s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    }
    function save() {
        setMsg(null);
        startSave(async () => {
            const res = await updateJurisdictionCcEmails({
                jurisdictionId: jid, billingCcEmails: parse(billing), bailiffCcEmails: parse(bailiff),
            });
            setMsg(res.ok ? t('cc_saved') : res.reason);
        });
    }

    return (
        <div className="mt-3 border-t border-[var(--os-border)] pt-3">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--os-text-muted)] mb-2">{t('recovery_cc_title')}</h4>
            <label className="block text-xs text-[var(--os-text-secondary)] mb-1">{t('billing_cc_label')}</label>
            <OsInput value={billing} disabled={!canEdit} onChange={(e) => setBilling(e.target.value)} placeholder="a@x.gov, b@x.gov" />
            <label className="block text-xs text-[var(--os-text-secondary)] mt-2 mb-1">{t('bailiff_cc_label')}</label>
            <OsInput value={bailiff} disabled={!canEdit} onChange={(e) => setBailiff(e.target.value)} placeholder="huissier@cabinet.so" />
            {canEdit && (
                <div className="flex items-center gap-2 mt-2">
                    <OsButton size="sm" variant="secondary" loading={saving} onClick={save}>{t('cc_save')}</OsButton>
                    {msg && <span className="text-xs text-[var(--os-text-muted)]">{msg}</span>}
                </div>
            )}
        </div>
    );
}
```

Ajouter les imports nécessaires en tête du fichier s'ils manquent : `useTranslations` (next-intl), `OsInput`, `OsButton`, et `import { updateJurisdictionCcEmails } from '@/actions/updateJurisdictionCcEmails';`. Rendre `<RecoveryCcSection jid={j.id} initial={ccByJurisdiction?.[j.id] ?? { cc_emails: [], bailiff_cc_emails: [] }} canEdit={canEdit} />` dans le bloc de rendu par juridiction (utiliser le même `canEdit` que les autres sections d'édition du composant).

- [ ] **Step 3 : Compilation + lint**

Run: `cd frontend && npx tsc --noEmit && npx eslint "src/app/(dashboard)/admin/jurisdictions/" src/components/dashboard/admin/AdminJurisdictions.tsx`
Expected: `tsc` silencieux ; eslint 0 erreur. Adapter les noms réels (`canEdit`, la variable de boucle de juridiction `j`, l'endroit du rendu par juridiction) à la structure réelle du fichier — inspecter avant d'insérer. Clés i18n ajoutées en Task 6.

- [ ] **Step 4 : Commit**

```bash
git add "frontend/src/app/(dashboard)/admin/jurisdictions/page.tsx" frontend/src/components/dashboard/admin/AdminJurisdictions.tsx
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(jurisdictions): éditeur des copies recouvrement (facturation + huissier) par État"
```

---

### Task 6 : i18n (6 locales)

**Files:**
- Modify: `frontend/messages/{en,fr,pt,so,sw,ar}.json`

- [ ] **Step 1 : Ajouter les clés dans les 6 fichiers**

Dans **chaque** fichier, ajouter au namespace `AdminCollections` :

```json
"escalate_bailiff": "Escalate to bailiff",
"escalate_judicial": "Escalate to judicial",
"escalate_dialog_title": "Confirm escalation",
"escalate_dialog_subtitle": "Issue a {tier} notice for {ref}? This sends a legal-recovery notification with the invoice attached and is recorded.",
"escalate_confirm": "Escalate",
"escalate_ramp_bailiff": "A J45 (pre-bailiff) reminder must be sent first.",
"escalate_ramp_judicial": "A bailiff notice must be issued first.",
"escalated_badge": "Escalated"
```

et un namespace/complément `AdminJurisdictions` (créer le namespace s'il n'existe pas ; sinon ajouter les clés) :

```json
"recovery_cc_title": "Recovery CC",
"billing_cc_label": "Billing CC (comma-separated)",
"bailiff_cc_label": "Bailiff CC (comma-separated)",
"cc_save": "Save CC",
"cc_saved": "Saved"
```

Valeurs `en` = référence ci-dessus. Traduire proprement en `fr` (français métier). Pour `pt/so/sw/ar`, traduire dans le style existant (baseline auto, dette connue). **Garder intacts** les paramètres ICU `{tier}`, `{ref}`.

⚠️ `AdminJurisdictions` peut déjà exister comme namespace i18n (le composant utilise `useTranslations('AdminJurisdictions')`). Vérifier d'abord dans `en.json` : si le namespace existe, **ajouter** les 5 clés dedans sans dupliquer le namespace ; s'il n'existe pas, le créer avec ces 5 clés.

- [ ] **Step 2 : Vérifier JSON + clés + build**

Run: `cd frontend && npx tsc --noEmit && node -e "['en','fr','pt','so','sw','ar'].forEach(l=>{const m=require('./messages/'+l+'.json'); const c=m.AdminCollections, j=m.AdminJurisdictions||{}; for(const k of ['escalate_bailiff','escalate_judicial','escalate_dialog_title','escalate_confirm','escalated_badge']) if(!c[k]) throw new Error('missing '+k+' in '+l); for(const k of ['recovery_cc_title','billing_cc_label','bailiff_cc_label','cc_save']) if(!j[k]) throw new Error('missing jur '+k+' in '+l);}); console.log('i18n keys OK')"`
Expected: `tsc` silencieux ; `i18n keys OK`.

- [ ] **Step 3 : Commit**

```bash
git add frontend/messages/en.json frontend/messages/fr.json frontend/messages/pt.json frontend/messages/so.json frontend/messages/sw.json frontend/messages/ar.json
git commit --author="Loic Leclerc <leclerc@drwintech.com>" -m "feat(collections): traductions escalade + éditeur CC (6 locales)"
```

---

### Task 7 : Vérification d'ensemble

- [ ] **Step 1 : Suite complète**

Run: `cd frontend && npx vitest run`
Expected: 0 échec ; total ≥ baseline + les nouveaux tests (email escalation, escalateCollection, updateJurisdictionCcEmails).

- [ ] **Step 2 : Typage**

Run: `cd frontend && npx tsc --noEmit`
Expected: aucune sortie.

- [ ] **Step 3 : Lint non dégradé**

Run: `cd frontend && npm run lint 2>&1 | tail -3`
Expected: `✖ 157 problems (62 errors, 95 warnings)` (baseline `develop`) — ou meilleur. Toute erreur nouvelle sur un fichier touché doit être corrigée.

---

## Bascule / déploiement

**Aucune migration.** B3 est du pur code applicatif — les paliers `BAILIFF`/`JUDICIAL` (enum, mig 094), `escalated_bailiff` (mig 094) et `bailiff_cc_emails` (mig 110) existent déjà. À la mise en prod, penser à **renseigner les `bailiff_cc_emails`** via le nouvel éditeur (Somaliland → cabinet Eidle Advocats), sinon les notices partent sans le cabinet en copie.

## Fin de la série B

B3 clôt le triptyque relance (B1 moteur → B2 consultation/réponse → B3 escalade). Reste le chantier **C** (relevé de compte mensuel), indépendant.
