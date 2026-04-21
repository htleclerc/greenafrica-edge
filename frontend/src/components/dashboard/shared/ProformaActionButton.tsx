'use client';

import * as React from 'react';
import { Zap, Download, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRole } from '@/lib/RoleContext';
import { UserRole } from '@/types/secure';
import { OsButton } from '@/components/ui/OsButton';

interface ProformaActionButtonProps {
    /** DB id of the transaction the proforma is attached to. */
    transactionId: string;
    /** Existing invoice_ref on the transaction — non-null ⇒ already generated. */
    invoiceRef?: string | null;
    /** Existing HMAC content_hash — required for armateur download URL. */
    contentHash?: string | null;
    /** Existing HMAC signature — required for armateur download URL. */
    verifySignature?: string | null;
    /** Optional click handler for STAFF — typically opens ProFormaModal. */
    onStaffClick?: () => void;
    /** Optional size override. Matches OsButton sizes (sm/md/lg). */
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}

/**
 * Role-aware proforma action button. Renders 3 distinct affordances:
 *
 *   staff (PORT_OFFICER | FINANCE_ADMIN | SUPERADMIN)
 *     → "Generate Pro-forma"   — emerald primary, opens ProFormaModal to POST
 *                                 /api/invoices/generate
 *
 *   armateur (SHIPPING_AGENT) with invoiceRef set
 *     → "Voir la proforma"     — emerald primary, links to the signed download
 *                                 URL; the armateur never triggers generation.
 *
 *   armateur without invoiceRef
 *     → "En attente"           — ghost disabled, tooltip-on-focus explaining
 *                                 that the port authority has not issued yet.
 */
export function ProformaActionButton({
    transactionId,
    invoiceRef,
    contentHash,
    verifySignature,
    onStaffClick,
    size = 'sm',
    className = '',
}: ProformaActionButtonProps) {
    const { role } = useRole();
    const t = useTranslations('ProformaActionButton');

    const isArmateur = role === UserRole.SHIPPING_AGENT;

    // Armateur — already-generated → view & download.
    if (isArmateur && invoiceRef && contentHash && verifySignature) {
        const href =
            `/api/invoices/${encodeURIComponent(invoiceRef)}/download` +
            `?h=${encodeURIComponent(contentHash)}` +
            `&s=${encodeURIComponent(verifySignature)}`;
        return (
            <OsButton
                variant="primary"
                size={size}
                icon={<Download className="w-4 h-4" />}
                onClick={(e) => {
                    e.stopPropagation();
                    window.open(href, '_blank', 'noopener,noreferrer');
                }}
                className={className}
                data-testid={`view-proforma-${transactionId}`}
            >
                {t('view')}
            </OsButton>
        );
    }

    // Armateur — not yet generated → passive informational state.
    if (isArmateur) {
        return (
            <OsButton
                variant="ghost"
                size={size}
                icon={<Clock className="w-4 h-4" />}
                disabled
                aria-disabled="true"
                title={t('pending_tooltip')}
                className={className}
                data-testid={`proforma-pending-${transactionId}`}
            >
                {t('pending')}
            </OsButton>
        );
    }

    // Staff — generation flow.
    return (
        <OsButton
            variant="primary"
            size={size}
            icon={<Zap className="w-4 h-4" />}
            onClick={(e) => {
                e.stopPropagation();
                onStaffClick?.();
            }}
            className={className}
            data-testid={`generate-proforma-${transactionId}`}
        >
            {t('generate')}
        </OsButton>
    );
}
