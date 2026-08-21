import { describe, it, expect } from 'vitest';
import { resolveInvoiceRecipients } from './invoiceIssuanceService';

const base = {
    shipownerBillingEmail: null,
    agentEmail: null,
    vesselOwnerEmail: null,
    ownerCcEmails: [] as string[],
    jurisdictionCcEmails: [] as string[],
    platformCcEmail: null,
};

describe('resolveInvoiceRecipients — cascade du destinataire principal', () => {
    it("privilégie le contact de facturation de l'armateur", () => {
        expect(resolveInvoiceRecipients({
            ...base,
            shipownerBillingEmail: 'billing@armateur.com',
            agentEmail: 'agent@port.com',
            vesselOwnerEmail: 'owner@fleet.com',
        })).toEqual({ to: 'billing@armateur.com', cc: ['agent@port.com'] });
    });

    it("retombe sur l'agent quand l'armateur n'a pas de contact", () => {
        expect(resolveInvoiceRecipients({
            ...base,
            agentEmail: 'agent@port.com',
            vesselOwnerEmail: 'owner@fleet.com',
        })).toEqual({ to: 'agent@port.com', cc: [] });
    });

    it('retombe sur le propriétaire du navire en dernier recours', () => {
        expect(resolveInvoiceRecipients({ ...base, vesselOwnerEmail: 'owner@fleet.com' }))
            .toEqual({ to: 'owner@fleet.com', cc: [] });
    });

    it("renvoie null quand personne n'est joignable", () => {
        expect(resolveInvoiceRecipients(base)).toBeNull();
    });

    it('ignore les chaînes vides et les espaces', () => {
        expect(resolveInvoiceRecipients({
            ...base,
            shipownerBillingEmail: '   ',
            agentEmail: 'agent@port.com',
        })).toEqual({ to: 'agent@port.com', cc: [] });
    });
});

describe('resolveInvoiceRecipients — copies', () => {
    it('ajoute les copies de la juridiction et de la plateforme', () => {
        expect(resolveInvoiceRecipients({
            ...base,
            shipownerBillingEmail: 'billing@armateur.com',
            agentEmail: 'agent@port.com',
            jurisdictionCcEmails: ['finance@somaliland.gov'],
            platformCcEmail: 'archive@greengate.africa',
        })).toEqual({
            to: 'billing@armateur.com',
            cc: ['agent@port.com', 'finance@somaliland.gov', 'archive@greengate.africa'],
        });
    });

    it('ne met pas le destinataire principal en copie de lui-même', () => {
        expect(resolveInvoiceRecipients({
            ...base,
            shipownerBillingEmail: 'agent@port.com',
            agentEmail: 'agent@port.com',
        })).toEqual({ to: 'agent@port.com', cc: [] });
    });

    it('dédoublonne sans tenir compte de la casse', () => {
        expect(resolveInvoiceRecipients({
            ...base,
            shipownerBillingEmail: 'Billing@Armateur.com',
            agentEmail: 'BILLING@armateur.COM',
            jurisdictionCcEmails: ['finance@so.gov', 'Finance@SO.gov'],
            platformCcEmail: 'finance@so.gov',
        })).toEqual({ to: 'Billing@Armateur.com', cc: ['finance@so.gov'] });
    });

    it("n'envoie rien quand seules des copies sont renseignées", () => {
        expect(resolveInvoiceRecipients({
            ...base,
            jurisdictionCcEmails: ['finance@so.gov'],
            platformCcEmail: 'archive@greengate.africa',
        })).toBeNull();
    });

    it("ajoute les copies propres à l'armateur, après l'agent", () => {
        expect(resolveInvoiceRecipients({
            ...base,
            shipownerBillingEmail: 'billing@armateur.com',
            agentEmail: 'agent@port.com',
            ownerCcEmails: ['finance@armateur.com', 'ops@armateur.com'],
            jurisdictionCcEmails: ['finance@somaliland.gov'],
        })).toEqual({
            to: 'billing@armateur.com',
            cc: ['agent@port.com', 'finance@armateur.com', 'ops@armateur.com', 'finance@somaliland.gov'],
        });
    });

    it('ne duplique pas une copie déjà destinataire principal', () => {
        expect(resolveInvoiceRecipients({
            ...base,
            shipownerBillingEmail: 'billing@armateur.com',
            ownerCcEmails: ['BILLING@armateur.com'],
        })).toEqual({ to: 'billing@armateur.com', cc: [] });
    });
});
