/**
 * Coordonnées bancaires du compte de collecte — la « RIB » que l'armateur doit
 * créditer pour un virement SWIFT.
 *
 * Constantes pures (aucun accès env ni Supabase) : le module est importable
 * depuis un composant client comme depuis le serveur.
 *
 * Trois surfaces citent ce compte et doivent rester d'accord :
 *   - ce module — écran de paiement de l'armateur et `paymentService`
 *     (`createWireTransfer`) ;
 *   - le pied de page du PDF de facture (`invoiceService`, section « Remit to »),
 *     encore écrit en dur faute de pouvoir changer la mise en page sans risque.
 *
 * Le concessionnaire qui perçoit est unique aujourd'hui (Solide Technology).
 * Le jour où une juridiction encaissera sur son propre compte, ces valeurs
 * devront venir de `jurisdictions`, pas d'une seconde constante.
 */
export interface WireBeneficiary {
    beneficiary: string;
    bank: string;
    bankAddress: string;
    swiftCode: string;
    iban: string;
}

export const WIRE_BENEFICIARY: WireBeneficiary = {
    beneficiary: 'Solide Technology Limited',
    bank: 'SYSTEM PAY SERVICES (MALTA) LIMITED',
    bankAddress: 'Ruby Workspaces, 3 Triq Santandrija, St Julians, STJ 9023, MT',
    swiftCode: 'SYPLMTM2XXX',
    iban: 'MT12SYPL39480821090981701607644',
};

/**
 * Référence à porter sur le virement. C'est elle qui permet au service
 * financier de rapprocher les fonds reçus : sans elle, un virement arrive
 * anonyme sur le compte de collecte.
 *
 * Même forme que le pied de page du PDF (`Ref: <invoiceRef>`). Une recharge de
 * portefeuille n'a pas de facture : on se rabat sur l'identifiant armateur,
 * seul lien disponible côté relevé bancaire.
 */
export function wireReference(invoiceRef: string | null, shipownerId: string): string {
    if (invoiceRef) return invoiceRef;
    return `TOPUP-${shipownerId.slice(0, 8).toUpperCase()}`;
}
