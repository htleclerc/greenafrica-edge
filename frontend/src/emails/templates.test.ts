import { describe, it, expect } from 'vitest';
import { renderEmailTemplate } from './renderEmailTemplate';
import {
    TX_AGENT_INVITE_HTML,
    TX_MONTHLY_STATEMENT_HTML,
    TX_OVERDUE_REMINDER_HTML,
    TX_PAYMENT_CONFIRMATION_HTML,
    TX_PROFORMA_INVOICE_HTML,
    TX_VESSEL_ACCESS_CODE_HTML,
} from './templates';

/**
 * Jeux de valeurs complets, un par gabarit. Ils doivent rester alignes sur ce
 * que passent les expediteurs d'`emailService` : c'est ce couple-la qui casse
 * en silence si un marqueur est ajoute au gabarit sans etre renseigne.
 */
const CASES: Array<[string, string, Record<string, string | number>]> = [
    ['tx-proforma-invoice', TX_PROFORMA_INVOICE_HTML, {
        docName: 'Pro-forma Invoice', docNameLower: 'pro-forma invoice',
        invoiceRef: 'PRO-2026-81be7109', recipientName: 'GG Demo Shipping',
        vesselName: 'GG DEMO PIONEER', jurisdictionName: 'Republic of Somaliland',
        amount: '$11,492', dueDate: '26 May 2026', badge: 'TO PAY',
        verifyUrl: 'https://greengate.africa/verify/PRO-2026-81be7109?h=abc&s=def',
    }],
    ['tx-payment-confirmation', TX_PAYMENT_CONFIRMATION_HTML, {
        recipientName: 'GG Demo Shipping', vesselName: 'GG DEMO PIONEER',
        invoiceRef: 'PRO-2026-81be7109', receiptRef: 'RCT-2026-81BE7109',
        amount: '$11,492', paidAt: '22 August 2026',
        portalUrl: 'https://greengate.africa/dashboard/invoices',
        jurisdictionName: 'Republic of Somaliland',
    }],
    ['tx-overdue-reminder', TX_OVERDUE_REMINDER_HTML, {
        recipientName: 'GG Demo Shipping', vesselName: 'GG DEMO STAR',
        invoiceRef: 'PRO-2026-65e28ceb', amount: '$16,500', daysOverdue: 45,
        payUrl: 'https://greengate.africa/dashboard/invoices',
        jurisdictionName: 'Republic of Djibouti',
    }],
    ['tx-agent-invite', TX_AGENT_INVITE_HTML, {
        recipientName: 'Hassan Mahdi', inviterName: 'Operations, GreenGate',
        email: 'agent@example.test', orgName: 'Berbera Shipping Ltd',
        ttlHours: 6, inviteUrl: 'https://greengate.africa/auth/sl?t=xyz',
    }],
    ['tx-vessel-access-code', TX_VESSEL_ACCESS_CODE_HTML, {
        recipientName: 'Shipowner', code: '482913',
    }],
    ['tx-monthly-statement', TX_MONTHLY_STATEMENT_HTML, {
        recipientName: 'GG Demo Shipping', periodLabel: 'July 2026',
        invoiceCount: 4, amount: '$27,992',
        portalUrl: 'https://greengate.africa/dashboard/invoices',
        jurisdictionName: 'Republic of Somaliland',
    }],
];

describe('templates transactionnels', () => {
    it.each(CASES)('%s ne laisse aucun marqueur non substitue', (_name, template, vars) => {
        const html = renderEmailTemplate(template, vars);
        expect(html).not.toMatch(/\{\{/);
    });

    it.each(CASES)('%s reste un document 600 px en tables', (_name, template, vars) => {
        // Outlook desktop ne rend ni flexbox ni feuille de style externe : la
        // largeur fixe et les tables sont la substance du gabarit, pas du style.
        const html = renderEmailTemplate(template, vars);
        expect(html).toContain('width:600px;max-width:600px');
        expect(html).toContain('role="presentation"');
        expect(html).not.toContain('display:flex');
        expect(html).not.toContain('<link rel="stylesheet"');
    });

    it.each(CASES)('%s sert le logo depuis notre projet Supabase', (_name, template, vars) => {
        // Le livrable pointait vers un projet tiers ; le regression guard tient
        // la dependance du cote de ce qu'on controle.
        const html = renderEmailTemplate(template, vars);
        expect(html).toContain('https://dyjolepwxxsedwngkfox.supabase.co/storage/v1/object/public/assets/africgreen-icon-128.png');
        expect(html).not.toContain('tvvvsysyiugrkrottczt');
    });

    it('porte les valeurs metier de la facture', () => {
        const html = renderEmailTemplate(TX_PROFORMA_INVOICE_HTML, CASES[0][2]);
        expect(html).toContain('PRO-2026-81be7109');
        expect(html).toContain('GG DEMO PIONEER');
        expect(html).toContain('$11,492');
        // L'esperluette de la query string doit ressortir echappee dans l'attribut.
        expect(html).toContain('?h=abc&amp;s=def');
    });
});

describe('renderEmailTemplate', () => {
    it('echappe les valeurs injectees', () => {
        // Un nom de navire vient en dernier ressort d'une saisie armateur.
        const html = renderEmailTemplate(TX_VESSEL_ACCESS_CODE_HTML, {
            recipientName: '<script>alert(1)</script>',
            code: '000000',
        });
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('refuse un rendu incomplet plutot que d envoyer un marqueur', () => {
        // Mieux vaut un envoi echoue et journalise (tous les appelants sont en
        // fail-soft) qu'un e-mail annoncant « {{amount}} » a l'armateur.
        expect(() => renderEmailTemplate(TX_VESSEL_ACCESS_CODE_HTML, { code: '000000' }))
            .toThrow(/missing values for: \{\{recipientName\}\}/);
    });

    it('accepte une valeur numerique', () => {
        const html = renderEmailTemplate('<b>{{n}}</b>', { n: 45 });
        expect(html).toBe('<b>45</b>');
    });
});
