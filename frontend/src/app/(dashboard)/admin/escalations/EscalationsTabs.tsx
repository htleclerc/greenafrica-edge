'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { OsTabs, OsTabsList, OsTabsTrigger, OsTabsContent } from '@/components/ui/OsTabs';
import type { EscalatedAlert, UnpaidProforma } from '@/services/escalationService';
import { UnclaimedPanel } from './UnclaimedPanel';
import { UnpaidPanel } from './UnpaidPanel';

interface Props {
    unclaimed: EscalatedAlert[];
    unpaid: UnpaidProforma[];
}

export function EscalationsTabs({ unclaimed, unpaid }: Props) {
    const t = useTranslations('AdminEscalations');

    return (
        <OsTabs defaultValue="unclaimed">
            <OsTabsList>
                <OsTabsTrigger value="unclaimed">
                    {t('tabs.unclaimed')}
                    <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-[var(--os-surface-2)] text-[10px] font-mono text-[var(--os-text-secondary)]">
                        {unclaimed.length}
                    </span>
                </OsTabsTrigger>
                <OsTabsTrigger value="unpaid">
                    {t('tabs.unpaid')}
                    <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full bg-[var(--os-surface-2)] text-[10px] font-mono text-[var(--os-text-secondary)]">
                        {unpaid.length}
                    </span>
                </OsTabsTrigger>
            </OsTabsList>

            <OsTabsContent value="unclaimed">
                <UnclaimedPanel rows={unclaimed} />
            </OsTabsContent>

            <OsTabsContent value="unpaid">
                <UnpaidPanel rows={unpaid} />
            </OsTabsContent>
        </OsTabs>
    );
}
