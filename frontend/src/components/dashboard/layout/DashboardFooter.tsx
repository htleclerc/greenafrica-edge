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
            className="fixed bottom-0 right-0 z-30 flex items-center justify-between px-2 sm:px-4 h-8 text-[10px] text-[var(--os-text-muted)] left-0 md:left-[var(--os-sidebar-w)]"
            style={{
                backgroundColor: 'var(--os-surface)',
                borderTop: '1px solid var(--os-border)',
                transition: 'left 220ms cubic-bezier(0.4,0,0.2,1)',
            }}
        >
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
                <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm bg-[var(--os-text-muted)]" />
                    <span className="hidden sm:inline">{t('footer_government')}</span>
                </span>
                <span className="hidden sm:inline">{t('footer_copyright')}</span>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 flex-wrap sm:flex-nowrap">
                <span className="hidden sm:inline">⬛ {nodeId}</span>
                <span>🔒 {encryption}</span>
                <span>⚡ {version}</span>
            </div>
        </footer>
    );
}
