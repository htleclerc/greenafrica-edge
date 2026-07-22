import { getInitialPrincipal } from '@/lib/auth/getInitialPrincipal';
import { DashboardShell } from '@/components/dashboard/layout/DashboardShell';

// Resolve the principal ONCE, server-side, and seed the client shell with it.
// This removes the client-side getUser()/profiles/shipowners round trips that
// used to block first paint (the "Initializing session…" spinner). Route
// enforcement stays with middleware + each page's requirePrincipal() guard;
// getInitialPrincipal() itself never redirects.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
    const initialPrincipal = await getInitialPrincipal();
    return <DashboardShell initialPrincipal={initialPrincipal}>{children}</DashboardShell>;
}
