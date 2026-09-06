import { getTranslations } from 'next-intl/server';
import { Lock } from 'lucide-react';

/** Volet réservé aux rôles qui voient les montants facturés (arbitrage PO 2026-09-06). */
export async function FinanceOnlyNotice() {
    const t = await getTranslations('AdminOwnerView');
    return (
        <div className="mx-auto max-w-6xl p-6">
            <div className="os-card flex items-start gap-3 p-5">
                <Lock className="mt-0.5 size-4 shrink-0 text-[var(--os-text-muted)]" aria-hidden />
                <p className="text-sm text-[var(--os-text-secondary)]">{t('financeOnly')}</p>
            </div>
        </div>
    );
}
