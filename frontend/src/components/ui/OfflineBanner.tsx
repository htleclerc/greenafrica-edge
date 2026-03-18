'use client';

import { WifiOff, RefreshCw, CloudOff } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTranslations } from 'next-intl';

/**
 * Floating banner displayed when the user loses connectivity.
 * Shows a warning with offline limitations and a retry button.
 */
export function OfflineBanner() {
    const { isOnline, wasOffline } = useOnlineStatus();
    const t = useTranslations('Offline');

    if (isOnline && !wasOffline) return null;

    return (
        <>
            {/* Offline banner */}
            {!isOnline && (
                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl border border-[#F59E0B]/30 bg-[#1C1508] text-[#F59E0B] max-w-md animate-in slide-in-from-bottom-4">
                    <WifiOff className="w-5 h-5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold">{t('title')}</p>
                        <p className="text-xs opacity-80 mt-0.5">{t('description')}</p>
                    </div>
                    <CloudOff className="w-4 h-4 opacity-40 flex-shrink-0" />
                </div>
            )}

            {/* Reconnected — data may be stale */}
            {isOnline && wasOffline && (
                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl border border-[#10B981]/30 bg-[#0A1A14] text-[#10B981] max-w-md">
                    <RefreshCw className="w-4 h-4 flex-shrink-0" />
                    <p className="text-xs font-medium">{t('reconnected')}</p>
                </div>
            )}
        </>
    );
}
