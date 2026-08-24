import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the most recent call to resend.emails.send so each test
// can inspect subject / html / text payloads.
const sendMock = vi.fn().mockResolvedValue({ data: { id: 'msg-123' }, error: null });

vi.mock('resend', () => ({
    Resend: class {
        emails = { send: sendMock };
    },
}));

import {
    sendPaymentRejectedEmail,
    sendProformaReminderEmail,
    sendProformaIssuedEmail,
    sendWalletTopupEmail,
    sendKycRejectedEmail,
    sendVesselAccessCodeEmail,
    sendLoginLinkEmail,
} from './emailService';

beforeEach(() => {
    sendMock.mockClear();
    sendMock.mockResolvedValue({ data: { id: 'msg-123' }, error: null });
    process.env.RESEND_API_KEY = 'test-key';
});

describe('sendPaymentRejectedEmail', () => {
    it('sends with subject and escaped reason', async () => {
        const result = await sendPaymentRejectedEmail({
            to: 'owner@example.com',
            recipientName: '<script>Alice</script>',
            invoiceRef: 'PRO-2026-0001',
            reason: 'Invalid IBAN <bad>',
        });
        expect(result.success).toBe(true);
        expect(sendMock).toHaveBeenCalledTimes(1);
        const call = sendMock.mock.calls[0][0];
        expect(call.subject).toContain('Payment declined');
        expect(call.subject).toContain('PRO-2026-0001');
        expect(call.html).toContain('&lt;script&gt;');
        expect(call.html).toContain('&lt;bad&gt;');
        expect(call.html).not.toContain('<script>Alice');
    });
});

describe('sendProformaReminderEmail', () => {
    it('sends with age and amount in subject', async () => {
        const result = await sendProformaReminderEmail({
            to: 'owner@example.com',
            recipientName: 'Bob',
            invoiceRef: 'PRO-2026-0002',
            amountUsd: 12500,
            ageDays: 7,
        });
        expect(result.success).toBe(true);
        const call = sendMock.mock.calls[0][0];
        expect(call.subject).toContain('PRO-2026-0002');
        expect(call.subject).toContain('7 days');
        expect(call.html).toContain('Payment Reminder');
    });
});

describe('sendProformaIssuedEmail', () => {
    it('sends with invoice ref + amount in subject and escapes the name', async () => {
        const result = await sendProformaIssuedEmail({
            to: 'operator@example.com',
            recipientName: '<b>Air Co</b>',
            invoiceRef: 'PRO-2026-0099',
            amountUsd: 5040,
            vesselName: '6O-GGA',
        });
        expect(result.success).toBe(true);
        const call = sendMock.mock.calls[0][0];
        expect(call.subject).toContain('PRO-2026-0099');
        expect(call.html).toContain('Pro-forma Invoice Issued');
        expect(call.html).toMatch(/\$5[,.\s]?040/); // locale-agnostic amount check
        expect(call.html).toContain('&lt;b&gt;');
        expect(call.html).not.toContain('<b>Air Co');
    });
});

describe('sendWalletTopupEmail', () => {
    it('sends with amount and new balance', async () => {
        const result = await sendWalletTopupEmail({
            to: 'owner@example.com',
            recipientName: 'Carol',
            amountUsd: 5000,
            newBalanceUsd: 15000,
        });
        expect(result.success).toBe(true);
        const call = sendMock.mock.calls[0][0];
        expect(call.subject).toContain('Wallet topped up');
        expect(call.html).toContain('Wallet Topped Up');
    });
});

describe('sendKycRejectedEmail', () => {
    it('sends with escaped reason', async () => {
        const result = await sendKycRejectedEmail({
            to: 'applicant@example.com',
            recipientName: 'Dave',
            reason: 'Document <missing>',
        });
        expect(result.success).toBe(true);
        const call = sendMock.mock.calls[0][0];
        expect(call.subject).toBe('Registration not approved');
        expect(call.html).toContain('&lt;missing&gt;');
    });
});

describe('sendVesselAccessCodeEmail', () => {
    it('carries the raw six-digit code in subject, html and text (Finding 1)', async () => {
        const result = await sendVesselAccessCodeEmail({
            to: 'contact@hornshipping.com',
            recipientName: 'Horn Shipping SA',
            code: '654321',
        });
        expect(result.success).toBe(true);
        const call = sendMock.mock.calls[0][0];
        expect(call.to).toEqual(['contact@hornshipping.com']);
        expect(call.subject).toContain('654321');
        expect(call.html).toContain('654321');
        expect(call.text).toContain('654321');
        // No link to click — the whole point of this template is that the
        // OTP travels as a code, not a GoTrue action_link.
        expect(call.html).not.toContain('action_link');
        expect(call.html).not.toContain('/auth/v1/verify');
    });

    it('escapes an unexpected recipient name', async () => {
        await sendVesselAccessCodeEmail({
            to: 'contact@hornshipping.com',
            recipientName: '<script>Alice</script>',
            code: '111111',
        });
        const call = sendMock.mock.calls[0][0];
        expect(call.html).toContain('&lt;script&gt;');
        expect(call.html).not.toContain('<script>Alice');
    });

    it('falls back to a generic salutation when no recipient name is given', async () => {
        await sendVesselAccessCodeEmail({ to: 'contact@hornshipping.com', code: '222222' });
        const call = sendMock.mock.calls[0][0];
        expect(call.html).toContain('Dear Shipowner');
    });
});

/**
 * Garde de non-régression : les blocs « étiquette → valeur » étaient en
 * flexbox, que Gmail supprime. Les deux cellules retombaient collées — le
 * destinataire lisait « VesselGG DEMO STAR ». Ils sont en table depuis, avec
 * des styles en ligne, parce que le `<style>` de l'en-tête n'est pas garanti
 * partout non plus.
 */
describe('lignes de métadonnées — ce que Gmail sait rendre', () => {
    async function loginHtml(): Promise<string> {
        await sendLoginLinkEmail({
            to: 'owner@example.com',
            recipientName: 'Green Gate Demo Armateur',
            link: 'https://greengate.africa/auth/sl?t=abc',
            code: '688664',
            vesselName: 'GG DEMO STAR',
        });
        return sendMock.mock.calls[0][0].html as string;
    }

    it('rend la ligne en table, jamais en flex', async () => {
        const html = await loginHtml();
        expect(html).toContain('<td align="right"');
        expect(html).not.toContain('class="meta-row"');
        // Le bug d'origine : les deux libellés bout à bout, sans cellule entre eux.
        expect(html).not.toContain('VesselGG DEMO STAR');
    });

    it('porte ses couleurs en ligne, pas seulement dans le <style>', async () => {
        const html = await loginHtml();
        expect(html).toMatch(/<td align="left" style="[^"]*color:#64748B/);
        expect(html).toMatch(/<td align="right" style="[^"]*color:#FFFFFF/);
    });

    it('sépare la bordure en couleur pleine — Outlook ignore l’alpha d’un rgba()', async () => {
        const html = await loginHtml();
        expect(html).toContain('border-bottom:1px solid #1F2A26');
        // Seulement dans les cellules : le <style> de la mise en page garde ses
        // rgba pour l'en-tête et le pied, qui ne sont pas l'objet de ce correctif.
        const cells = html.match(/<td [^>]*>/g) ?? [];
        expect(cells.length).toBeGreaterThan(0);
        expect(cells.some((c) => c.includes('rgba'))).toBe(false);
    });

    it('garde l’étiquette et la valeur séparées et lisibles', async () => {
        const html = await loginHtml();
        const row = html.slice(html.indexOf('>Vessel<') - 400, html.indexOf('>Vessel<') + 400);
        expect(row).toContain('GG DEMO STAR');
        expect(row).toContain('</td>');
    });
});
