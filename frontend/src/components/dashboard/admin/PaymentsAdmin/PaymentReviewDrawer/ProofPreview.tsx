'use client';

import * as React from 'react';
import { FileText, Image as ImageIcon, ExternalLink } from 'lucide-react';

interface Proof {
    id: string;
    storage_path: string;
    mime_type: string;
    size_bytes: number;
    uploaded_at: string;
    signed_url: string;
}

export function ProofPreview({ proof }: { proof: Proof }) {
    const isImage = proof.mime_type.startsWith('image/');
    const isPdf = proof.mime_type === 'application/pdf';
    const filename = proof.storage_path.split('/').pop() ?? proof.id;

    return (
        <div className="rounded-lg border border-[var(--os-border)] bg-[var(--os-surface-2)] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--os-border)]">
                {isImage ? <ImageIcon className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />
                         : <FileText className="w-3.5 h-3.5 text-[var(--os-text-muted)]" />}
                <span className="flex-1 truncate text-[11px] font-mono">{filename}</span>
                <span className="text-[10px] text-[var(--os-text-muted)]">{(proof.size_bytes / 1024).toFixed(0)} KB</span>
                <a
                    href={proof.signed_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--os-text-muted)] hover:text-[#10B981]"
                >
                    <ExternalLink className="w-3.5 h-3.5" />
                </a>
            </div>
            {isImage && (
                <img src={proof.signed_url} alt={filename} className="w-full max-h-64 object-contain bg-black/40" />
            )}
            {isPdf && (
                <iframe src={proof.signed_url} className="w-full h-64" title={filename} />
            )}
            {!isImage && !isPdf && (
                <a
                    href={proof.signed_url}
                    download
                    className="block px-3 py-2 text-xs text-[#10B981] hover:underline"
                >
                    Download
                </a>
            )}
        </div>
    );
}
