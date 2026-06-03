'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RegisterForm } from './RegisterForm';
import { AirRegisterForm } from './AirRegisterForm';

interface Props {
    recaptchaSiteKey: string;
    maritimeEnabled: boolean;
    airEnabled: boolean;
}

type Mode = 'MARITIME' | 'AIR';

export function RegisterModeSwitcher({ recaptchaSiteKey, maritimeEnabled, airEnabled }: Props) {
    const t = useTranslations('AirRegister');
    const [mode, setMode] = useState<Mode>(maritimeEnabled ? 'MARITIME' : 'AIR');
    const bothEnabled = maritimeEnabled && airEnabled;

    return (
        <div>
            {bothEnabled && (
                <div role="tablist" className="flex gap-2 mb-6">
                    <button
                        role="tab"
                        aria-selected={mode === 'MARITIME'}
                        onClick={() => setMode('MARITIME')}
                        className={`px-4 h-9 rounded-lg text-sm ${mode === 'MARITIME' ? 'os-button' : 'bg-[var(--os-surface-2)] border border-[var(--os-border)]'}`}
                    >
                        {t('tab_maritime')}
                    </button>
                    <button
                        role="tab"
                        aria-selected={mode === 'AIR'}
                        onClick={() => setMode('AIR')}
                        className={`px-4 h-9 rounded-lg text-sm ${mode === 'AIR' ? 'os-button' : 'bg-[var(--os-surface-2)] border border-[var(--os-border)]'}`}
                    >
                        {t('tab_air')}
                    </button>
                </div>
            )}
            {mode === 'MARITIME' && maritimeEnabled
                ? <RegisterForm recaptchaSiteKey={recaptchaSiteKey} />
                : <AirRegisterForm recaptchaSiteKey={recaptchaSiteKey} />}
        </div>
    );
}
