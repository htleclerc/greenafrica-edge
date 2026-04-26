'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Ship } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OsButton } from '@/components/ui/OsButton';
import { OsInput, OsSelect } from '@/components/ui/OsInput';
import { addVesselManually } from '@/actions/addVesselManually';

interface Props {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
}

const CATEGORY_OPTIONS = [
    { value: 'CONTAINER',    label: 'Container' },
    { value: 'CARGO',        label: 'Cargo' },
    { value: 'TANKER',       label: 'Tanker' },
    { value: 'BULK_CARRIER', label: 'Bulk Carrier' },
    { value: 'FERRY',        label: 'Ferry' },
    { value: 'NAVAL',        label: 'Naval' },
    { value: 'SCIENTIFIC',   label: 'Scientific' },
];

export function AddVesselModal({ open, onClose, onCreated }: Props) {
    const t = useTranslations('VesselsPage');
    const [imo, setImo]               = React.useState('');
    const [mmsi, setMmsi]             = React.useState('');
    const [name, setName]             = React.useState('');
    const [callSign, setCallSign]     = React.useState('');
    const [flagCode, setFlagCode]     = React.useState('');
    const [category, setCategory]     = React.useState<string>('CARGO');
    const [dwt, setDwt]               = React.useState('');
    const [error, setError]           = React.useState<string | null>(null);
    const [pending, startTransition]  = React.useTransition();

    function reset() {
        setImo(''); setMmsi(''); setName(''); setCallSign('');
        setFlagCode(''); setCategory('CARGO'); setDwt(''); setError(null);
    }

    function submit() {
        const dwtNum = Number(dwt);
        if (!Number.isFinite(dwtNum) || dwtNum <= 0) {
            setError(t('add_vessel_error_dwt'));
            return;
        }
        setError(null);
        startTransition(async () => {
            const res = await addVesselManually({
                imoNumber: imo.trim(),
                mmsi: mmsi.trim(),
                name: name.trim(),
                callSign: callSign.trim(),
                flagCode: flagCode.trim().toUpperCase(),
                category,
                grossTonnageDwt: Math.round(dwtNum),
            });
            if (!res.ok) {
                setError(res.reason);
                return;
            }
            reset();
            onCreated();
            onClose();
        });
    }

    return (
        <Dialog.Root open={open} onOpenChange={(o) => { if (!o && !pending) { reset(); onClose(); } }}>
            <Dialog.Portal>
                <Dialog.Overlay
                    className="fixed inset-0 z-50"
                    style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
                />
                <Dialog.Content
                    className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-xl mx-4 rounded-2xl border overflow-hidden flex flex-col"
                    style={{
                        backgroundColor: 'var(--os-surface)',
                        borderColor: 'var(--os-border-strong)',
                        maxHeight: '90vh',
                    }}
                >
                    <div
                        className="flex items-center justify-between px-5 py-3 border-b"
                        style={{ borderColor: 'var(--os-border)' }}
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <Ship className="w-4 h-4 text-[#00D97E]" />
                            <div className="min-w-0">
                                <Dialog.Title className="text-sm font-bold text-[var(--os-text-primary)]">
                                    {t('add_vessel_title')}
                                </Dialog.Title>
                                <Dialog.Description className="text-[10px] text-[var(--os-text-muted)]">
                                    {t('add_vessel_subtitle')}
                                </Dialog.Description>
                            </div>
                        </div>
                        <Dialog.Close asChild>
                            <button
                                disabled={pending}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--os-text-muted)] hover:text-[var(--os-text-primary)] hover:bg-[var(--os-surface-2)] transition-colors disabled:opacity-50"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="overflow-y-auto flex-1 p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <OsInput
                            label={t('add_vessel_imo')}
                            placeholder="9839272"
                            inputMode="numeric"
                            maxLength={7}
                            value={imo}
                            onChange={(e) => setImo(e.target.value.replace(/\D/g, ''))}
                            disabled={pending}
                        />
                        <OsInput
                            label={t('add_vessel_mmsi')}
                            placeholder="636092841"
                            inputMode="numeric"
                            maxLength={9}
                            value={mmsi}
                            onChange={(e) => setMmsi(e.target.value.replace(/\D/g, ''))}
                            disabled={pending}
                        />
                        <div className="sm:col-span-2">
                            <OsInput
                                label={t('add_vessel_name')}
                                placeholder="MV ATLAS"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                disabled={pending}
                            />
                        </div>
                        <OsInput
                            label={t('add_vessel_call_sign')}
                            placeholder="D5GG1"
                            maxLength={16}
                            value={callSign}
                            onChange={(e) => setCallSign(e.target.value.toUpperCase())}
                            disabled={pending}
                        />
                        <OsInput
                            label={t('add_vessel_flag')}
                            placeholder="LR"
                            maxLength={2}
                            value={flagCode}
                            onChange={(e) => setFlagCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                            disabled={pending}
                        />
                        <OsSelect
                            label={t('add_vessel_type')}
                            options={CATEGORY_OPTIONS}
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            disabled={pending}
                        />
                        <OsInput
                            label={t('add_vessel_dwt')}
                            placeholder="78500"
                            inputMode="numeric"
                            value={dwt}
                            onChange={(e) => setDwt(e.target.value.replace(/[^\d]/g, ''))}
                            disabled={pending}
                        />

                        {error && (
                            <div className="sm:col-span-2 px-3 py-2 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/25 text-xs text-[#EF4444]">
                                {error}
                            </div>
                        )}
                    </div>

                    <div
                        className="px-5 py-3 border-t flex items-center justify-end gap-2"
                        style={{ borderColor: 'var(--os-border)' }}
                    >
                        <OsButton variant="ghost" size="sm" onClick={() => { reset(); onClose(); }} disabled={pending}>
                            {t('add_vessel_cancel')}
                        </OsButton>
                        <OsButton
                            variant="primary"
                            size="sm"
                            onClick={submit}
                            loading={pending}
                            disabled={pending}
                        >
                            {pending ? t('add_vessel_submitting') : t('add_vessel_submit')}
                        </OsButton>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
