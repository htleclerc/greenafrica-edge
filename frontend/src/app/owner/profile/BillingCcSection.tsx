'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { OsCard, OsCardHeader } from '@/components/ui/OsCard';
import { OsInput } from '@/components/ui/OsInput';
import { OsButton } from '@/components/ui/OsButton';
import { MAX_CC_EMAILS } from '@/lib/armateurContacts';
import { updateOwnerBillingCc } from '@/actions/updateOwnerBillingCc';

interface Props {
    /** Adresse officielle — destinataire principal, jamais une copie. */
    officialEmail: string | null;
    initialEmails: string[];
}

/**
 * Gestion des copies de facturation par l'armateur lui-même.
 *
 * Jusqu'ici il fallait écrire au support : seul le personnel pouvait toucher
 * `billing_cc_emails`. Mettre son comptable en copie est pourtant son geste.
 *
 * L'écran dit explicitement ce que la liste fait — **et ne fait pas**. Une
 * adresse en copie reçoit les documents ; elle n'ouvre aucune session. Laisser
 * croire l'inverse serait la pire des ambiguïtés sur un écran qui ressemble à
 * une gestion d'accès.
 */
export function BillingCcSection({ officialEmail, initialEmails }: Props) {
    const t = useTranslations('OwnerProfile.billingCc');
    const router = useRouter();

    const [emails, setEmails] = React.useState<string[]>(initialEmails);
    const [draft, setDraft] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [saved, setSaved] = React.useState(false);
    const [pending, startTransition] = React.useTransition();

    const primary = (officialEmail ?? '').trim().toLowerCase();
    const normalisedDraft = draft.trim().toLowerCase();

    // Les mêmes refus que l'action, énoncés avant l'envoi : l'armateur corrige
    // sans aller-retour. L'action reste seule juge — ceci n'est qu'un raccourci.
    const draftProblem: string | null =
        !normalisedDraft ? null
        : !normalisedDraft.includes('@') || normalisedDraft.length < 5 ? t('errors.invalid')
        : normalisedDraft === primary ? t('errors.isPrimary')
        : emails.includes(normalisedDraft) ? t('errors.duplicate')
        : emails.length >= MAX_CC_EMAILS ? t('errors.tooMany', { max: MAX_CC_EMAILS })
        : null;

    function commit(next: string[]) {
        setError(null);
        setSaved(false);
        startTransition(async () => {
            const result = await updateOwnerBillingCc({ emails: next });
            if (!result.ok) {
                setError(t(`errors.${result.reason}`, { max: MAX_CC_EMAILS }));
                return;
            }
            // On reprend la liste normalisée par le serveur, pas celle qu'on a
            // envoyée : c'est lui qui déduplique et retire l'adresse principale.
            setEmails(result.emails);
            setDraft('');
            setSaved(true);
            router.refresh();
        });
    }

    return (
        <OsCard>
            <OsCardHeader title={t('title')} subtitle={t('subtitle')} />

            {/* La portée réelle, dite une fois et clairement. */}
            <p className="mb-4 rounded-lg border border-[var(--os-blue)]/25 bg-[var(--os-blue)]/8 px-3 py-2 text-xs leading-relaxed text-[var(--os-text-secondary)]">
                {t('scopeNotice')}
            </p>

            {emails.length > 0 ? (
                <ul className="mb-3 flex flex-col gap-2">
                    {emails.map((email) => (
                        <li
                            key={email}
                            className="flex items-center justify-between gap-3 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] px-3 py-2"
                        >
                            <span className="truncate font-mono text-[12.5px] text-[var(--os-text-primary)]">
                                {email}
                            </span>
                            <button
                                type="button"
                                onClick={() => commit(emails.filter((e) => e !== email))}
                                disabled={pending}
                                aria-label={t('remove', { email })}
                                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--os-text-muted)] transition-colors duration-150 hover:bg-[var(--os-surface-3)] hover:text-[var(--os-red)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--os-brand-green)]"
                            >
                                <X className="size-4" aria-hidden />
                            </button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="mb-3 text-[12.5px] text-[var(--os-text-muted)]">{t('empty')}</p>
            )}

            <div className="flex items-start gap-2">
                <div className="flex-1">
                    <OsInput
                        label={t('addLabel')}
                        type="email"
                        value={draft}
                        onChange={(e) => { setDraft(e.target.value); setError(null); setSaved(false); }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !draftProblem && normalisedDraft) {
                                e.preventDefault();
                                commit([...emails, normalisedDraft]);
                            }
                        }}
                        placeholder="comptabilite@exemple.com"
                        error={draftProblem ?? undefined}
                        hint={draftProblem ? undefined : t('remaining', { count: MAX_CC_EMAILS - emails.length })}
                    />
                </div>
                <OsButton
                    variant="secondary"
                    icon={<Plus className="size-4" />}
                    onClick={() => commit([...emails, normalisedDraft])}
                    disabled={pending || !normalisedDraft || !!draftProblem}
                    className="mt-6"
                >
                    {t('add')}
                </OsButton>
            </div>

            {error && <p className="mt-2 text-xs text-[var(--os-red)]">{error}</p>}
            {saved && !error && <p className="mt-2 text-xs text-[var(--os-green)]">{t('saved')}</p>}
        </OsCard>
    );
}
