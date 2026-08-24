'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Ship, Pencil, Unlink, Scale, AlertCircle } from 'lucide-react';
import { OsCard, OsCardHeader } from '@/components/ui/OsCard';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput } from '@/components/ui/OsInput';
import { OsBadge } from '@/components/ui/OsBadge';
import { renameOwnerVessel, detachOwnerVessel } from '@/actions/updateOwnerVessel';
import type { OwnerPrivileges } from '@/lib/auth/ownerPrivileges';
import { OWNER_INVOICES_PATH } from '@/lib/routes/ownerPaths';
import type { FleetVessel } from '@/services/ownerFleetService';

interface Props {
    fleet: FleetVessel[];
    /**
     * Sous-permissions de la personne connectée (mig 135). Elles retirent le
     * geste de l'écran ; le refus qui compte reste celui de l'action serveur.
     */
    privileges: OwnerPrivileges;
    isMember: boolean;
}

/**
 * Flotte de l'armateur, en libre-service.
 *
 * Trois gestes seulement : renommer, retirer si le navire ne porte aucune
 * facture vivante, contester sinon. Aucun geste ne touche à une transaction —
 * l'immuabilité fiscale n'est ni contournée ni assouplie, et une contestation
 * est une demande, pas une annulation.
 *
 * « Contester » renvoie vers l'écran des factures plutôt que d'ouvrir un
 * litige ici : le parcours y existe déjà, avec son motif et sa pièce jointe.
 * Un second chemin finirait par diverger du premier.
 */
export function OwnerFleetPanel({ fleet, privileges, isMember }: Props) {
    const t = useTranslations('MyFleet');
    const router = useRouter();

    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [draftName, setDraftName] = React.useState('');
    const [confirmDetachId, setConfirmDetachId] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [pending, startTransition] = React.useTransition();

    function submitRename(vesselId: string) {
        setError(null);
        startTransition(async () => {
            const r = await renameOwnerVessel({ vesselId, name: draftName.trim() });
            if (!r.ok) { setError(r.reason); return; }
            setEditingId(null);
            router.refresh();
        });
    }

    function submitDetach(vesselId: string) {
        setError(null);
        startTransition(async () => {
            const r = await detachOwnerVessel({ vesselId });
            if (!r.ok) { setError(r.reason); return; }
            setConfirmDetachId(null);
            router.refresh();
        });
    }

    const totalDue = fleet.reduce((s, v) => s + v.outstandingUsd, 0);

    return (
        <div className="flex flex-col gap-4 p-4 sm:p-6">
            <OsCard>
                <OsCardHeader title={t('title')} />
                <div className="flex flex-wrap gap-6 px-1 pb-2 text-sm">
                    <span className="text-[var(--os-text-muted)]">
                        {t('kpiVessels')} <strong className="text-[var(--os-text-primary)]">{fleet.length}</strong>
                    </span>
                    <span className="text-[var(--os-text-muted)]">
                        {t('kpiOutstanding')}{' '}
                        <strong className="text-[#EAB308]">
                            ${totalDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </strong>
                    </span>
                </div>
            </OsCard>

            {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                    <p className="text-xs text-red-400">{error}</p>
                </div>
            )}

            {fleet.length === 0 && (
                <OsCard>
                    <p className="text-sm text-[var(--os-text-muted)] p-2">{t('emptyFleet')}</p>
                </OsCard>
            )}

            {fleet.map((v) => (
                <OsCard key={v.id}>
                    <div className="flex flex-wrap items-start gap-4">
                        <Ship className="w-5 h-5 mt-1 text-[#00D97E] flex-shrink-0" />

                        <div className="flex-1 min-w-[220px]">
                            {editingId === v.id ? (
                                <div className="flex flex-wrap items-end gap-2">
                                    <div className="flex-1 min-w-[180px]">
                                        <OsInput
                                            label={t('renameLabel')}
                                            value={draftName}
                                            onChange={(e) => setDraftName(e.target.value)}
                                            disabled={pending}
                                        />
                                    </div>
                                    <OsButton
                                        variant="primary" size="sm" loading={pending}
                                        disabled={pending || draftName.trim().length === 0}
                                        onClick={() => submitRename(v.id)}
                                    >
                                        {t('renameSubmit')}
                                    </OsButton>
                                    <OsButton variant="ghost" size="sm" disabled={pending} onClick={() => setEditingId(null)}>
                                        {t('cancel')}
                                    </OsButton>
                                </div>
                            ) : (
                                <>
                                    <p className="font-semibold text-[var(--os-text-primary)]">{v.name}</p>
                                    <p className="text-xs text-[var(--os-text-muted)]">
                                        {v.imoNumber ? `IMO ${v.imoNumber}` : t('noImo')}
                                        {v.mmsi ? ` · MMSI ${v.mmsi}` : ''} · {v.flagCode}
                                    </p>
                                </>
                            )}
                        </div>

                        <div className="flex flex-col items-end gap-1 min-w-[140px]">
                            {/* C'est l'ECHEANCE qui decide de l'alarme, pas la
                                simple existence d'une facture. Un navire dont
                                tout etait regle s'affichait aussi alarmant
                                qu'un impaye, et une somme due dans trois
                                semaines aussi urgente qu'une somme en retard.
                                Rouge = delai depasse. Orange = il reste a
                                payer, dans les temps. Vert = solde. Bleu =
                                aucune facture. Le reglement partiel se lit
                                dans le libelle : c'est une information, pas un
                                degre d'urgence. */}
                            <OsBadge
                                variant={
                                    v.canRemove ? 'draft'
                                        : v.outstandingUsd <= 0 ? 'paid'
                                            : v.overdue ? 'payment_due'
                                                : 'processing'
                                }
                                label={
                                    v.canRemove ? t('noInvoice')
                                        : v.outstandingUsd <= 0
                                            ? t('invoiceCountSettled', { count: v.invoiceCount })
                                            : v.partiallyPaid
                                                ? t('invoiceCountPartial', { count: v.invoiceCount })
                                                : t('invoiceCount', { count: v.invoiceCount })
                                }
                            />
                            {v.outstandingUsd > 0 && (
                                <span className="text-xs" style={{ color: v.overdue ? '#EF4444' : '#F97316' }}>
                                    ${v.outstandingUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            )}
                        </div>

                        {editingId !== v.id && (privileges.canManageVessels || privileges.canDispute) && (
                            <div className="flex flex-wrap items-center gap-2">
                                {privileges.canManageVessels && (
                                <OsButton
                                    variant="secondary" size="sm" disabled={pending}
                                    icon={<Pencil className="w-3.5 h-3.5" />}
                                    onClick={() => { setEditingId(v.id); setDraftName(v.name); setError(null); }}
                                >
                                    {t('rename')}
                                </OsButton>
                                )}

                                {!privileges.canManageVessels ? null : v.canRemove ? (
                                    confirmDetachId === v.id ? (
                                        <>
                                            <span className="text-xs text-[var(--os-text-muted)]">{t('confirmDetach')}</span>
                                            <OsButton variant="danger" size="sm" loading={pending} onClick={() => submitDetach(v.id)}>
                                                {t('detachConfirmYes')}
                                            </OsButton>
                                            <OsButton variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmDetachId(null)}>
                                                {t('cancel')}
                                            </OsButton>
                                        </>
                                    ) : (
                                        <OsButton
                                            variant="secondary" size="sm" disabled={pending}
                                            icon={<Unlink className="w-3.5 h-3.5" />}
                                            onClick={() => { setConfirmDetachId(v.id); setError(null); }}
                                        >
                                            {t('detach')}
                                        </OsButton>
                                    )
                                ) : privileges.canDispute ? (
                                    <Link href={OWNER_INVOICES_PATH}>
                                        <OsButton variant="secondary" size="sm" icon={<Scale className="w-3.5 h-3.5" />}>
                                            {t('dispute')}
                                        </OsButton>
                                    </Link>
                                ) : null}
                            </div>
                        )}

                        {/* Le titulaire a tout : seul un membre a besoin de
                            comprendre pourquoi le geste manque. */}
                        {isMember && !privileges.canManageVessels && (
                            <p className="text-[11px] mt-2 text-[var(--os-text-muted)]">{t('restricted')}</p>
                        )}
                    </div>

                    {!v.canRemove && (
                        <p className="text-[11px] mt-2 text-[var(--os-text-muted)]">
                            {v.outstandingUsd > 0 ? t('detachBlocked') : t('detachBlockedSettled')}
                        </p>
                    )}
                </OsCard>
            ))}
        </div>
    );
}
