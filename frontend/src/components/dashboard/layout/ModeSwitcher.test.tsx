import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { ModeSwitcher } from './ModeSwitcher';

const messages = {
    ModeSwitcher: {
        label: 'Transport mode',
        both: 'Both',
        maritime: 'Maritime',
        air: 'Air',
        error: 'Could not switch mode',
        retry: 'Retry',
    },
};

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: mockRefresh }),
}));

const mockSetActiveMode = vi.fn();
vi.mock('@/actions/setActiveMode', () => ({
    setActiveMode: (...args: unknown[]) => mockSetActiveMode(...args),
}));

let fetchResponse: object = { enabled: [], active: 'BOTH' };
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

describe('ModeSwitcher', () => {
    it('renders nothing when 0 modes enabled', async () => {
        fetchResponse = { enabled: [], active: 'BOTH' };
        const { container } = render(wrap(<ModeSwitcher expanded={true} />));
        await waitFor(() => {
            expect(container.firstChild).toBeNull();
        });
    });

    it('renders nothing when only 1 mode enabled', async () => {
        fetchResponse = { enabled: ['MARITIME'], active: 'MARITIME' };
        const { container } = render(wrap(<ModeSwitcher expanded={true} />));
        await waitFor(() => {
            // fetch resolved — one mode only, switcher is useless → null
            expect(container.firstChild).toBeNull();
        });
    });

    it('renders a dropdown when >1 modes enabled', async () => {
        fetchResponse = { enabled: ['MARITIME', 'AIR'], active: 'BOTH' };
        render(wrap(<ModeSwitcher expanded={true} />));
        await waitFor(() => {
            expect(screen.getByRole('combobox')).toBeInTheDocument();
        });
        expect(screen.getByText('Both')).toBeInTheDocument();
        expect(screen.getByText('Maritime')).toBeInTheDocument();
        expect(screen.getByText('Air')).toBeInTheDocument();
    });

    it('onChange calls setActiveMode and router.refresh on success', async () => {
        fetchResponse = { enabled: ['MARITIME', 'AIR'], active: 'BOTH' };
        mockSetActiveMode.mockResolvedValue({ ok: true });

        render(wrap(<ModeSwitcher expanded={true} />));
        await waitFor(() => {
            expect(screen.getByRole('combobox')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'MARITIME' } });

        await waitFor(() => {
            expect(mockSetActiveMode).toHaveBeenCalledWith({ mode: 'MARITIME' });
            expect(mockRefresh).toHaveBeenCalled();
        });
    });

    it('select reflects new mode immediately after successful switch (no snap-back)', async () => {
        fetchResponse = { enabled: ['MARITIME', 'AIR'], active: 'BOTH' };
        mockSetActiveMode.mockResolvedValue({ ok: true });

        render(wrap(<ModeSwitcher expanded={true} />));
        await waitFor(() => {
            expect(screen.getByRole('combobox')).toBeInTheDocument();
        });

        const select = screen.getByRole('combobox') as HTMLSelectElement;
        expect(select.value).toBe('BOTH');

        fireEvent.change(select, { target: { value: 'AIR' } });

        await waitFor(() => {
            expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('AIR');
        });
    });

    it('shows error text when setActiveMode returns ok:false', async () => {
        fetchResponse = { enabled: ['MARITIME', 'AIR'], active: 'BOTH' };
        mockSetActiveMode.mockResolvedValue({ ok: false });

        render(wrap(<ModeSwitcher expanded={true} />));
        await waitFor(() => {
            expect(screen.getByRole('combobox')).toBeInTheDocument();
        });

        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'MARITIME' } });

        await waitFor(() => {
            expect(screen.getByText('Could not switch mode')).toBeInTheDocument();
        });
        expect(mockRefresh).not.toHaveBeenCalled();
    });

    it('renders inline error with retry button on fetch failure', async () => {
        fetchShouldFail = true;

        render(wrap(<ModeSwitcher expanded={true} />));

        await waitFor(() => {
            expect(screen.getByText('Could not switch mode')).toBeInTheDocument();
        });
        expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('retries fetch when retry button is clicked after fetch failure', async () => {
        fetchShouldFail = true;

        render(wrap(<ModeSwitcher expanded={true} />));

        await waitFor(() => {
            expect(screen.getByText('Retry')).toBeInTheDocument();
        });

        fetchShouldFail = false;
        fetchResponse = { enabled: ['MARITIME', 'AIR'], active: 'BOTH' };
        setup();

        await act(async () => {
            fireEvent.click(screen.getByText('Retry'));
        });

        await waitFor(() => {
            expect(screen.getByRole('combobox')).toBeInTheDocument();
        });
    });
});
