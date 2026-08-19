'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { classifyVesselIdentifier, type VesselIdentifierProblem } from '@/lib/vessels/identifier';

const PROBLEM_MESSAGE_KEY: Record<VesselIdentifierProblem, string> = {
    FORMAT: 'form_invalid',
    IMO_CHECKSUM: 'form_invalid_checksum',
};

/**
 * Champ de recherche par IMO/MMSI. Monté à deux endroits — le hero d'accueil et
 * la page /pay — et volontairement pas dupliqué : une correction de
 * normalisation doit s'appliquer aux deux d'un coup.
 *
 * La validation est faite ici, avant navigation : une saisie invalide ne part
 * pas au serveur et ne consomme donc aucun quota de rate-limit.
 */
export function VesselLookupForm({
    autoFocus = false,
    defaultValue = '',
}: {
    autoFocus?: boolean;
    defaultValue?: string;
}) {
    const t = useTranslations('VesselLookup');
    const router = useRouter();
    const [value, setValue] = React.useState(defaultValue);
    const [problem, setProblem] = React.useState<VesselIdentifierProblem | null>(null);

    function onSubmit(e: React.FormEvent) {
        e.preventDefault();
        const result = classifyVesselIdentifier(value);
        if (!result.ok) {
            setProblem(result.problem);
            return;
        }
        setProblem(null);
        router.push(`/pay?q=${encodeURIComponent(result.identifier.value)}`);
    }

    return (
        <form onSubmit={onSubmit} className="w-full max-w-xl mx-auto">
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                    <label htmlFor="vessel-lookup-input" className="sr-only">
                        {t('form_label')}
                    </label>
                    <input
                        id="vessel-lookup-input"
                        name="q"
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        autoFocus={autoFocus}
                        value={value}
                        onChange={(e) => { setValue(e.target.value); setProblem(null); }}
                        placeholder={t('form_placeholder')}
                        aria-invalid={problem !== null}
                        aria-describedby={problem !== null ? 'vessel-lookup-error' : undefined}
                        className="w-full px-5 py-3.5 rounded-xl text-base bg-transparent
                                   focus-visible:outline-none focus-visible:ring-2
                                   focus-visible:ring-emerald-500"
                        style={{
                            color: 'var(--ais-page-text)',
                            border: '1px solid var(--ais-page-border)',
                            backgroundColor: 'var(--ais-page-surface)',
                        }}
                    />
                </div>
                <button
                    type="submit"
                    className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl
                               font-semibold transition-all flex items-center justify-center gap-2
                               focus-visible:outline-none focus-visible:ring-2
                               focus-visible:ring-emerald-400"
                    style={{ color: '#FFFFFF' }}
                >
                    <Search className="w-4 h-4" aria-hidden="true" />
                    {t('form_submit')}
                </button>
            </div>

            {problem !== null ? (
                <p
                    id="vessel-lookup-error"
                    role="alert"
                    className="mt-2 text-sm text-red-400 text-center sm:text-left"
                >
                    {t(PROBLEM_MESSAGE_KEY[problem])}
                </p>
            ) : (
                <p className="mt-2 text-xs text-center sm:text-left" style={{ color: 'var(--ais-page-text-dim)' }}>
                    {t('form_hint')}
                </p>
            )}
        </form>
    );
}
