import Image from 'next/image';
import type { CoverageCountry } from '@/components/landing/coverage';

/**
 * Drapeau d'une juridiction, vendoré sous /public.
 *
 * Rendu à hauteur fixe et largeur dérivée du ratio réel : aucun recadrage,
 * y compris pour le Somaliland qui est en 2:1 là où les drapeaux ISO sont en
 * 4:3. Toujours décoratif — le nom du pays est systématiquement à côté, donc
 * `alt` est vide et le lecteur d'écran ne l'annonce pas deux fois.
 */
export function Flag({ country, height }: Readonly<{ country: CoverageCountry; height: number }>) {
    const width = Math.round(height * country.ratio);
    return (
        <span
            className="shrink-0 overflow-hidden rounded-[3px]"
            style={{ width, height, border: '1px solid var(--ais-page-border)' }}
        >
            <Image src={country.flag} alt="" width={width} height={height} unoptimized />
        </span>
    );
}
