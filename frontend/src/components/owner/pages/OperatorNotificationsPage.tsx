// Reusable server component for the operator notifications view.
// Used by /owner/notifications (via thin wrapper) and /dashboard/notifications
// when the principal is an operator. Auth is already enforced by the caller
// (requireOwner or requirePrincipal); this component only renders the client UI.

import type { Principal } from '@/lib/auth/requirePrincipal';
import { NotificationsPageClient } from '@/app/owner/(portal)/notifications/NotificationsPageClient';

// Principal prop is accepted for consistency with the delegation pattern even
// though the client component talks to /api/owner/notifications directly.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface Props {
    principal: Extract<Principal, { kind: 'operator' }>;
}

export function OperatorNotificationsPage(_props: Props) {
    return <NotificationsPageClient />;
}
