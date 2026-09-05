'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { OsInput } from '@/components/ui/OsInput';
import { OsButton } from '@/components/ui/OsButton';

interface Props {
    recaptchaSiteKey: string;
    /**
     * IMO venu du rattachement `/pay/claim` : affiché en lecture seule, la
     * saisie ne doit pas pouvoir diverger du navire pour lequel la demande a
     * été ouverte.
     */
    prefillImo?: string;
}

declare global {
    interface Window {
        grecaptcha?: {
            execute: (key: string, opts: { action: string }) => Promise<string>;
        };
    }
}

/**
 * Quatre champs : qui écrit, pour quelle société, sur quel navire. Le MMSI est
 * facultatif et ne sert qu'à retrouver le navire quand l'IMO ne tombe pas juste.
 *
 * Le téléversement d'une pièce justificative a disparu avec le reste : chaque
 * demande passe désormais par une revue humaine (`/admin/registrations`), et
 * l'agent qui instruit réclame les pièces s'il en a besoin. Voir
 * `registerShipowner.ts` pour ce que cette simplification a coûté.
 */
export function RegisterForm({ recaptchaSiteKey, prefillImo }: Props) {
    const t = useTranslations('OwnerRegister');
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setSubmitting(true);
        setResult(null);

        const formData = new FormData(e.currentTarget);

        const token =
            recaptchaSiteKey && window.grecaptcha
                ? await window.grecaptcha.execute(recaptchaSiteKey, {
                    action: 'register_shipowner',
                })
                : 'dev-skip';

        const mmsi = String(formData.get('mmsi') ?? '').trim();
        const body = {
            email: formData.get('email'),
            name: formData.get('name'),
            vessel_imo: formData.get('vessel_imo'),
            // Champ vide ⇒ absent du corps : le schéma le déclare facultatif,
            // pas « chaîne vide autorisée ».
            mmsi: mmsi || undefined,
            recaptcha_token: token,
        };
        const res = await fetch('/api/auth/register-shipowner', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        setSubmitting(false);
        setResult({ ok: data.ok, message: data.message });
    }

    if (result?.ok) {
        return (
            <div className="os-card p-6 text-center">
                <h2 className="text-xl mb-2">{t('thanks_title')}</h2>
                <p>{result.message}</p>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <OsInput
                name="email"
                label={t('email')}
                type="email"
                required
            />
            <OsInput
                name="name"
                label={t('company_name')}
                required
            />
            <OsInput
                name="vessel_imo"
                label={t('vessel_imo')}
                pattern="\d{7}"
                inputMode="numeric"
                required
                defaultValue={prefillImo}
                readOnly={!!prefillImo}
                aria-readonly={!!prefillImo}
            />
            <OsInput
                name="mmsi"
                label={t('mmsi_optional')}
                pattern="\d{9}"
                inputMode="numeric"
                placeholder="636012345"
            />
            {result && !result.ok && (
                <div className="text-red-400 text-sm">{result.message}</div>
            )}
            {/* `os-button` n'existe pas dans la feuille de style : le bouton
              * d'envoi était aussi peu visible que les onglets. */}
            <OsButton type="submit" size="lg" loading={submitting} className="w-full">
                {submitting ? t('submitting') : t('submit')}
            </OsButton>
        </form>
    );
}
