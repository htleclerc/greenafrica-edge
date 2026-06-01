// ─────────────────────────────────────────────────────────────────────────────
// /owner/notifications — full notifications page
// ─────────────────────────────────────────────────────────────────────────────
//
// Thin server component: enforces SHIPOWNER RBAC via requireOwner() and hands
// off to <NotificationsPageClient>, which talks to GET /api/owner/notifications
// for paginated reads (the API uses service-role since mig 053 has RLS-on +
// zero-policies). All interactive state lives in the client component:
//   - filter (All / Unread)
//   - offset/limit pagination ("Load more" appends next 20)
//   - mark-all-read button
//   - mark-on-click optimistic update
// ─────────────────────────────────────────────────────────────────────────────

import { requireOwner } from '@/lib/auth/requireOwner';
import { NotificationsPageClient } from './NotificationsPageClient';

export const metadata = {
    title: 'Owner portal — notifications',
};

export const dynamic = 'force-dynamic';

export default async function OwnerNotificationsPage() {
    // RBAC gate. Hydrating data is left to the client so the page can react
    // to filter toggling / load-more without a hard reload.
    await requireOwner();

    return <NotificationsPageClient />;
}
