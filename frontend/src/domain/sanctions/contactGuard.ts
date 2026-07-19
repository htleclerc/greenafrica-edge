/**
 * Garde sanctions internationales — règle métier ABSOLUE Green-Gate.
 *
 * Aucun contact commercial direct (email, invitation portail, relance) ne doit
 * jamais atteindre un débiteur sous sanctions :
 *  - OFAC SDN  → procédure in rem uniquement (Bailiff Eidle Omer, Hargeisa)
 *  - UN prohibited → notification consulaire uniquement
 *
 * Chaque appelant DOIT invoquer assertContactAllowed() avant tout envoi sortant
 * et logger le refus dans audit_logs (fait par l'appelant, qui a le contexte user).
 */

export interface SanctionFlags {
    is_ofac_sdn: boolean;
    is_un_prohibited: boolean;
    name: string;
}

export type SanctionCode = 'OFAC_SDN' | 'UN_PROHIBITED';

export class SanctionedContactError extends Error {
    readonly code: SanctionCode;
    readonly shipownerName: string;

    constructor(code: SanctionCode, shipownerName: string) {
        super(
            code === 'OFAC_SDN'
                ? `Contact interdit : ${shipownerName} est sur la liste OFAC SDN (procédure in rem uniquement)`
                : `Contact interdit : ${shipownerName} est sous sanctions UN (notification consulaire uniquement)`,
        );
        this.name = 'SanctionedContactError';
        this.code = code;
        this.shipownerName = shipownerName;
    }
}

export function isContactBlocked(shipowner: SanctionFlags): boolean {
    return shipowner.is_ofac_sdn || shipowner.is_un_prohibited;
}

export function assertContactAllowed(shipowner: SanctionFlags): void {
    if (shipowner.is_ofac_sdn) {
        throw new SanctionedContactError('OFAC_SDN', shipowner.name);
    }
    if (shipowner.is_un_prohibited) {
        throw new SanctionedContactError('UN_PROHIBITED', shipowner.name);
    }
}
