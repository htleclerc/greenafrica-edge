'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { OsFilterTabs } from '@/components/ui/OsFilterTabs';
import { RegisterForm } from './RegisterForm';
import { AirRegisterForm } from './AirRegisterForm';

interface Props {
    recaptchaSiteKey: string;
    maritimeEnabled: boolean;
    airEnabled: boolean;
    /**
     * IMO du navire à l'origine de la demande (venu du rattachement
     * `/pay/claim`), pré-rempli en lecture seule dans le formulaire
     * maritime. Sans objet côté aviation, qui n'a pas de champ IMO navire.
     */
    prefillImo?: string;
}

type Mode = 'MARITIME' | 'AIR';

export function RegisterModeSwitcher({ recaptchaSiteKey, maritimeEnabled, airEnabled, prefillImo }: Props) {
    const t = useTranslations('AirRegister');
    const [mode, setMode] = useState<Mode>(maritimeEnabled ? 'MARITIME' : 'AIR');
    const bothEnabled = maritimeEnabled && airEnabled;

    return (
        <div>
            {/*
              * Les deux onglets se confondaient : l'état actif portait la classe
              * `os-button`, qui n'est définie NULLE PART dans la feuille de
              * style. Actif et inactif tombaient donc sur le même rendu, et
              * seul l'anneau de focus distinguait l'un de l'autre.
              *
              * `OsFilterTabs` porte le contraste du système de design — pastille
              * pleine contre surface secondaire — et la navigation aux flèches
              * avec `tabIndex` roulant, qu'il aurait fallu réécrire ici.
              */}
            {bothEnabled && (
                <OsFilterTabs
                    label={t('mode_switcher_label')}
                    value={mode}
                    onChange={(v) => setMode(v as Mode)}
                    className="mb-6"
                    tabs={[
                        { value: 'MARITIME', label: t('tab_maritime') },
                        { value: 'AIR', label: t('tab_air') },
                    ]}
                />
            )}
            {mode === 'MARITIME' && maritimeEnabled
                ? <RegisterForm recaptchaSiteKey={recaptchaSiteKey} prefillImo={prefillImo} />
                : <AirRegisterForm recaptchaSiteKey={recaptchaSiteKey} />}
        </div>
    );
}
