import { requireOwner } from '@/lib/auth/requireOwner';

export const metadata = {
    title: 'Owner portal — dashboard',
};

// Stub — Plan 6 Task 3 fleshes this out with counters, recent activity, etc.
// For now we just confirm the auth gate works end-to-end.

export default async function OwnerDashboardPage() {
    const session = await requireOwner();

    return (
        <div className="min-h-screen os-bg px-6 py-8">
            <h1 className="text-2xl font-semibold text-[var(--os-text-primary)] mb-2">
                Welcome, {session.shipowner.name}
            </h1>
            <p className="text-sm text-[var(--os-text-muted)]">
                Portal v0 — vessels, alerts, and invoices coming next.
            </p>
        </div>
    );
}
