'use client';

import * as React from 'react';
import { FileDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';

interface Props {
    /** Restreint le relevé à un navire (référence `ves_…`). Absent : toute la flotte. */
    vesselRef?: string;
}

/**
 * Relevé consolidé à la demande.
 *
 * Le relevé mensuel officiel n'arrive que le 1er du mois : entre deux, un
 * armateur qui veut savoir ce qu'il doit — pour un conseil d'administration,
 * une demande de financement, un rapprochement bancaire — n'avait aucun moyen
 * de l'obtenir.
 *
 * La date d'arrêté est le cœur du document : un solde sans sa date n'est pas
 * vérifiable, et deux relevés tirés à des jours différents doivent pouvoir
 * différer sans que l'un des deux soit faux. Elle est bornée à aujourd'hui —
 * un solde futur n'existe pas.
 */
export function StatementDownload({ vesselRef }: Props) {
    const t = useTranslations('OwnerPortal.statement');
    const today = new Date().toISOString().slice(0, 10);
    const [asOf, setAsOf] = React.useState(today);

    const href = `/api/owner/statement?asOf=${encodeURIComponent(asOf)}${
        vesselRef ? `&vessel=${encodeURIComponent(vesselRef)}` : ''
    }`;

    return (
        <section className="os-card p-4">
            <h2 className="text-sm font-semibold text-[var(--os-text-primary)]">{t('title')}</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--os-text-muted)]">
                {vesselRef ? t('hintVessel') : t('hintFleet')}
            </p>

            <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--os-text-muted)]">
                        {t('asOfLabel')}
                    </span>
                    <input
                        type="date"
                        value={asOf}
                        max={today}
                        onChange={(e) => setAsOf(e.target.value)}
                        className="h-9 rounded-[10px] border border-[var(--os-border-strong)] bg-[var(--os-surface-2)] px-2.5 text-[13px] text-[var(--os-text-primary)]"
                    />
                </label>

                <a href={href} target="_blank" rel="noopener noreferrer">
                    <OsButton variant="secondary" size="sm" icon={<FileDown className="w-3.5 h-3.5" />}>
                        {t('download')}
                    </OsButton>
                </a>
            </div>
        </section>
    );
}
