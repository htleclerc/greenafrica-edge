import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { JurisdictionSwitcher } from './JurisdictionSwitcher';

const SO = '00000000-0000-4000-8000-00000000534f';
const DJ = '22222222-2222-4222-8222-222222222222';

const messages = {
    JurisdictionSwitcher: {
        label: 'Jurisdiction',
        select: 'Select jurisdiction…',
        error: 'Could not switch',
        retry: 'Retry',
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
let fetchShouldFail = false;

function setup() {
    global.fetch = vi.fn().mockImplementation(() => {
        if (fetchShouldFail) {
            return Promise.reject(new Error('network error'));
        }
        return Promise.resolve({
            ok: true,
            json: async () => fetchResponse,
        });
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
    fetchShouldFail = false;
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

    // ── NEW: select state fix (no snap-back after successful switch) ─────────
    it('select reflects new active jurisdiction immediately after successful switch (no snap-back)', async () => {
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

        const select = screen.getByRole('combobox') as HTMLSelectElement;
        expect(select.value).toBe(SO);

        fireEvent.change(select, { target: { value: DJ } });

        await waitFor(() => {
            // Local state must be updated to DJ so the select doesn't snap back to SO.
            expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(DJ);
        });
    });

    // ── NEW: auto-select on first multi-jurisdiction login ───────────────────
    it('auto-selects first membership when active is null and >1 memberships', async () => {
        // DJ sorts before SO alphabetically by code — after route sorts by code
        // the memberships array is [DJ, SO]. First = DJ.
        fetchResponse = {
            memberships: [
                { id: DJ, code: 'DJ', name: 'Djibouti' },
                { id: SO, code: 'SO', name: 'Somaliland' },
            ],
            active: null,
        };
        mockSetActiveJurisdiction.mockResolvedValue({ ok: true });

        render(wrap(<JurisdictionSwitcher expanded={true} />));

        await waitFor(() => {
            // Action must have been called with the first membership's id
            expect(mockSetActiveJurisdiction).toHaveBeenCalledWith({ jurisdictionId: DJ });
        });
        // Router must have been refreshed
        expect(mockRefresh).toHaveBeenCalled();
    });

    it('does NOT auto-select when only 1 membership', async () => {
        fetchResponse = {
            memberships: [{ id: SO, code: 'SO', name: 'Somaliland' }],
            active: null,
        };

        render(wrap(<JurisdictionSwitcher expanded={true} />));

        // Let fetch settle
        await waitFor(() => {
            expect(screen.getByText(/SO · Somaliland/)).toBeInTheDocument();
        });

        expect(mockSetActiveJurisdiction).not.toHaveBeenCalled();
    });

    // ── NEW: fetch failure renders retry, not null ───────────────────────────
    it('renders inline error with retry button on fetch failure', async () => {
        fetchShouldFail = true;

        render(wrap(<JurisdictionSwitcher expanded={true} />));

        await waitFor(() => {
            expect(screen.getByText('Could not switch')).toBeInTheDocument();
        });
        expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('retries fetch when retry button is clicked after fetch failure', async () => {
        fetchShouldFail = true;

        render(wrap(<JurisdictionSwitcher expanded={true} />));

        await waitFor(() => {
            expect(screen.getByText('Retry')).toBeInTheDocument();
        });

        // Now fix the fetch so retry succeeds with real data
        fetchShouldFail = false;
        fetchResponse = {
            memberships: [{ id: SO, code: 'SO', name: 'Somaliland' }],
            active: SO,
        };
        setup();

        await act(async () => {
            fireEvent.click(screen.getByText('Retry'));
        });

        await waitFor(() => {
            expect(screen.getByText(/SO · Somaliland/)).toBeInTheDocument();
        });
    });
});
