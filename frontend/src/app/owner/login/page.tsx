import { redirect } from 'next/navigation';

export const metadata = {
    title: 'Sign in — Green Gate',
};

// The owner portal no longer has its own login page. Everyone signs in at
// /login; this route exists only to redirect legacy links (invitation emails,
// bookmarks) and to preserve any error code as a query param.
export default async function OwnerLoginRedirect({
    searchParams,
}: {
    searchParams: Promise<{ error?: string }>;
}) {
    const { error } = await searchParams;
    redirect(error ? `/login?error=${encodeURIComponent(error)}` : '/login');
}
