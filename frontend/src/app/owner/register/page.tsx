import { redirect } from 'next/navigation';
// Operator self-service moved to the unified /signup. Keep this route as a 301
// for legacy links (invitation emails, bookmarks).
export default function OwnerRegisterRedirect() {
    redirect('/signup');
}
