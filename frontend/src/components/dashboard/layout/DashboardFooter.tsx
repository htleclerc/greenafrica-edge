'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

interface DashboardFooterProps {
    nodeId?: string;
    version?: string;
    encryption?: string;
}

export function DashboardFooter({
    nodeId = 'BER-DC1',
    version = 'v1.2.4-secure',
    encryption = 'AES-256',
}: DashboardFooterProps) {
    const t = useTranslations('Dashboard');
    return (
        <footer
            className="fixed bottom-0 right-0 z-30 flex items-center justify-between px-4 h-8 text-[10px] text-[var(--os-text-muted)]"
            style={{
                left: 'var(--os-sidebar-w)',
                backgroundColor: 'var(--os-surface)',
                borderTop: '1px solid var(--os-border)',
            }}
        >
            <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm bg-[var(--os-text-muted)]" />
                    {t('footer_government')}
                </span>
                <span>{t('footer_copyright')}</span>
            </div>
            <div className="flex items-center gap-4">
                <span>⬛ {nodeId}</span>
                <span>🔒 {encryption} {t('footer_encrypted')}</span>
                <span>⚡ {version}</span>
            </div>
        </footer>
    );
}
