import { requireOwner } from '@/lib/auth/requireOwner';
import { OwnerShell } from '@/components/owner/OwnerShell';

export default async function OwnerPortalLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Single auth gate for every page in the portal route group. Pages
    // can re-call requireOwner() if they need the session payload — the
    // second call is cheap (cached on the request scope by Next.js).
    const session = await requireOwner();

    return (
        <OwnerShell ownerName={session.shipowner.name} email={session.email}>
            {children}
        </OwnerShell>
    );
}
