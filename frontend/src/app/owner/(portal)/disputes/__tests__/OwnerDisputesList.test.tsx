import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OwnerDisputesList, type OwnerDisputeRow } from '../OwnerDisputesList';

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

const rows: OwnerDisputeRow[] = [
    { id: 'd1', ref: 'DSP-1', vesselName: 'MV Test', status: 'OPEN', originalAmountUsd: 1200, createdAt: '2026-05-01T00:00:00Z' },
];

it('renders a dispute row with its ref, vessel and status', () => {
    render(<OwnerDisputesList rows={rows} />);
    expect(screen.getByText('DSP-1')).toBeInTheDocument();
    expect(screen.getByText('MV Test')).toBeInTheDocument();
    expect(screen.getByText('OPEN')).toBeInTheDocument();
});

it('renders an empty state when there are no disputes', () => {
    render(<OwnerDisputesList rows={[]} />);
    expect(screen.getByText('empty')).toBeInTheDocument();
});
