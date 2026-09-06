import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { createPlatformClient } from '@/lib/supabase/tenant';
import { listPlatformUsers } from '@/services/platformUsersService';
import { UsersDirectory } from './UsersDirectory';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN', 'MANAGER'];

/**
 * Annuaire : toutes les personnes qui peuvent se connecter — titulaires,
 * membres, représentants, et le staff pour un SUPERADMIN (même règle que
 * /admin/staff). Les e-mails sont visibles à tout le staff qui voit les
 * armateurs (arbitrage PO 2026-09-06) : ce sont des contacts professionnels.
 */
export default async function UsersPage() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', auth.user.id).single();
    if (!profile || !ALLOWED_ROLES.includes(profile.role)) redirect('/dashboard');

    const users = await listPlatformUsers(supabase, createPlatformClient(), {
        includeStaff: profile.role === 'SUPERADMIN',
    });
    const t = await getTranslations('AdminUsers');

    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-1 text-[var(--os-text-primary)]">{t('title')}</h1>
            <p className="text-sm text-[var(--os-text-muted)] mb-5">{t('subtitle')}</p>
            <UsersDirectory users={users} canViewAs={ALLOWED_ROLES.includes(profile.role)} />
        </div>
    );
}
