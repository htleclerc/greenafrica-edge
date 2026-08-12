'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FileText } from 'lucide-react';

/**
 * Branche B : aucune adresse enregistrée pour cet armateur (ou armateur de
 * regroupement). La demande part vers le circuit d'inscription existant
 * (`/signup`, qui alimente `admin/registrations`) plutôt que d'ouvrir un
 * second circuit parallèle. `identifier` est l'IMO canonique du navire
 * (résolu côté serveur par `lookupVesselTeaser`), pré-rempli en lecture
 * seule dans le formulaire d'inscription via le paramètre `imo`.
 */
export function ClaimByStaffPanel({ identifier }: { identifier: string }) {
    const t = useTranslations('VesselLookup');

    return (
        <section className="os-card p-8 max-w-md mx-auto">
            <h1 className="text-xl font-semibold mb-4" style={{ color: 'var(--ais-page-text)' }}>
                {t('claim_staff_title')}
            </h1>
            <p className="text-sm mb-6 flex items-start gap-2" style={{ color: 'var(--ais-page-text-muted)' }}>
                <FileText className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                {t('claim_staff_intro')}
            </p>
            <Link
                href={`/signup?imo=${encodeURIComponent(identifier)}`}
                className="block text-center px-6 py-3 rounded-xl font-semibold bg-emerald-600
                           hover:bg-emerald-500 transition-colors"
                style={{ color: '#FFFFFF' }}
            >
                {t('claim_staff_submit')}
            </Link>
        </section>
    );
}
