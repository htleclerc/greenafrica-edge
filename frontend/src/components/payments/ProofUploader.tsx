'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Upload, Trash2, FileText, Loader2 } from 'lucide-react';

export interface UploadedProof {
    id: string;
    name: string;
    sizeBytes: number;
    mimeType: string;
}

interface Props {
    list: () => Promise<UploadedProof[]>;
    upload: (file: File) => Promise<void>;
    remove: (id: string) => Promise<void>;
    maxSizeBytes?: number;
    accept?: string;
    disabled?: boolean;
}

const DEFAULT_MAX = 5 * 1024 * 1024;
const DEFAULT_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';

export function ProofUploader({ list, upload, remove, maxSizeBytes = DEFAULT_MAX, accept = DEFAULT_ACCEPT, disabled }: Props) {
    const t = useTranslations('OwnerPortal.proofUpload');
    const [proofs, setProofs] = React.useState<UploadedProof[]>([]);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const refresh = React.useCallback(async () => {
        try { setProofs(await list()); } catch (e) { setError(e instanceof Error ? e.message : 'load failed'); }
    }, [list]);

    React.useEffect(() => { void refresh(); }, [refresh]);

    async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setError(null);
        if (file.size > maxSizeBytes) { setError(t('errors.tooLarge', { max: Math.round(maxSizeBytes / 1024 / 1024) })); return; }
        setBusy(true);
        try { await upload(file); await refresh(); }
        catch (err) { setError(err instanceof Error ? err.message : t('errors.uploadFailed')); }
        finally { setBusy(false); }
    }

    async function onRemove(id: string) {
        setBusy(true); setError(null);
        try { await remove(id); await refresh(); }
        catch (err) { setError(err instanceof Error ? err.message : t('errors.deleteFailed')); }
        finally { setBusy(false); }
    }

    return (
        <div className="flex flex-col gap-2">
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm text-[#10B981] hover:underline">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {t('addButton')}
                <input
                    data-testid="proof-input"
                    type="file"
                    accept={accept}
                    className="hidden"
                    disabled={disabled || busy}
                    onChange={onPick}
                />
            </label>
            <p className="text-[11px] text-[var(--os-text-muted)]">{t('hint', { max: Math.round(maxSizeBytes / 1024 / 1024) })}</p>

            {error && <p role="alert" className="text-xs text-[#EF4444]">{error}</p>}

            <ul className="flex flex-col gap-1.5">
                {proofs.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] px-3 py-2">
                        <FileText className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                        <span className="flex-1 truncate text-xs font-mono">{p.name}</span>
                        <span className="text-[10px] text-[var(--os-text-muted)]">{(p.sizeBytes / 1024).toFixed(0)} KB</span>
                        {!disabled && (
                            <button type="button" onClick={() => onRemove(p.id)} disabled={busy} aria-label={t('removeAria', { name: p.name })} className="text-[var(--os-text-muted)] hover:text-[#EF4444]">
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
