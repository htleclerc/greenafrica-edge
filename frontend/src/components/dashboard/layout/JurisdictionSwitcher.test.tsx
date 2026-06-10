import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { JurisdictionSwitcher } from './JurisdictionSwitcher';

const SO = '00000000-0000-4000-8000-00000000534f';
const DJ = '22222222-2222-4222-8222-222222222222';

const messages = {
    JurisdictionSwitcher: {
        label: 'Jurisdiction',
        select: 'Select jurisdiction…',
        error: 'Could not switch',
    },
};

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: mockRefresh }),
}));

const mockSetActiveJurisdiction = vi.fn();
vi.mock('@/actions/setActiveJurisdiction', () => ({
    setActiveJurisdiction: (...args: unknown[]) => mockSetActiveJurisdiction(...args),
}));

// Mutable fetch response
let fetchResponse: object = { memberships: [], active: null };

function setup() {
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => fetchResponse,
    });
}

function wrap(component: React.ReactElement) {
    return (
        <NextIntlClientProvider locale="en" messages={messages}>
            {component}
        </NextIntlClientProvider>
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    setup();
});

describe('JurisdictionSwitcher', () => {
    it('renders nothing when 0 memberships', async () => {
        fetchResponse = { memberships: [], active: null };
        const { container } = render(wrap(<JurisdictionSwitcher expanded={true} />));
        await waitFor(() => {
            // fetch resolved — component should render null
            expect(container.firstChild).toBeNull();
        });
    });

    it('renders a static label when exactly 1 membership', async () => {
        fetchResponse = {
            memberships: [{ id: SO, code: 'SO', name: 'Somaliland' }],
            active: SO,
        };
        render(wrap(<JurisdictionSwitcher expanded={true} />));
        await waitFor(() => {
            expect(screen.getByText(/SO · Somaliland/)).toBeInTheDocument();
        });
        // No select element
        expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('renders a dropdown when >1 memberships', async () => {
        fetchResponse = {
            memberships: [
                { id: SO, code: 'SO', name: 'Somaliland' },
                { id: DJ, code: 'DJ', name: 'Djibouti' },
            ],
            active: SO,
        };
        render(wrap(<JurisdictionSwitcher expanded={true} />));
        await waitFor(() => {
            expect(screen.getByRole('combobox')).toBeInTheDocument();
        });
        expect(screen.getByText('SO · Somaliland')).toBeInTheDocument();
        expect(screen.getByText('DJ · Djibouti')).toBeInTheDocument();
    });

    it('onChange calls setActiveJurisdiction and router.refresh on success', async () => {
        fetchResponse = {
            memberships: [
                { id: SO, code: 'SO', name: 'Somaliland' },
                { id: DJ, code: 'DJ', name: 'Djibouti' },
            ],
            active: SO,
        };
        mockSetActiveJurisdiction.mockResolvedValue({ ok: true });

        render(wrap(<JurisdictionSwitcher expanded={true} />));
        await waitFor(() => {
            expect(screen.getByRole('combobox')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByRole('combobox'), { target: { value: DJ } });

        await waitFor(() => {
            expect(mockSetActiveJurisdiction).toHaveBeenCalledWith({ jurisdictionId: DJ });
            expect(mockRefresh).toHaveBeenCalled();
        });
    });

    it('shows error text when setActiveJurisdiction returns ok:false', async () => {
        fetchResponse = {
            memberships: [
                { id: SO, code: 'SO', name: 'Somaliland' },
                { id: DJ, code: 'DJ', name: 'Djibouti' },
            ],
            active: SO,
        };
        mockSetActiveJurisdiction.mockResolvedValue({ ok: false, error: 'not a member' });

        render(wrap(<JurisdictionSwitcher expanded={true} />));
        await waitFor(() => {
            expect(screen.getByRole('combobox')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByRole('combobox'), { target: { value: DJ } });

        await waitFor(() => {
            expect(screen.getByText('Could not switch')).toBeInTheDocument();
        });
        expect(mockRefresh).not.toHaveBeenCalled();
    });
});
