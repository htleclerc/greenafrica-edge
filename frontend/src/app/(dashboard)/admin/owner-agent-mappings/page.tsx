import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { listMappings } from '@/services/ownerAgentMappingService';
import { OwnerAgentMappingList } from './OwnerAgentMappingList';
import { AddMappingForm } from './AddMappingForm';

export const dynamic = 'force-dynamic';

export default async function OwnerAgentMappingsPage() {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) redirect('/login');

    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', auth.user.id)
        .single();
    if (!profile || !['PORT_OFFICER', 'FINANCE_ADMIN', 'SUPERADMIN'].includes(profile.role)) {
        redirect('/dashboard');
    }

    const [mappings, shipownersRes, agentsRes] = await Promise.all([
        listMappings(supabase),
        supabase.from('shipowners').select('id, name').order('name'),
        supabase
            .from('profiles')
            .select('id, full_name, email')
            .eq('role', 'SHIPPING_AGENT')
            .order('full_name'),
    ]);

    const t = await getTranslations('AdminMappings');

    return (
        <div className="px-6 py-4">
            <h1 className="text-2xl font-semibold mb-2 text-[var(--os-text-primary)]">
                {t('title')}
            </h1>
            <p className="text-[var(--os-text-muted)] mb-6 text-sm">{t('subtitle')}</p>

            <div className="mb-8">
                <h2 className="text-lg font-semibold mb-3 text-[var(--os-text-primary)]">
                    {t('addSectionTitle')}
                </h2>
                <AddMappingForm
                    shipowners={(shipownersRes.data ?? []) as { id: string; name: string }[]}
                    agents={
                        (agentsRes.data ?? []) as {
                            id: string;
                            full_name: string | null;
                            email: string;
                        }[]
                    }
                />
            </div>

            <OwnerAgentMappingList mappings={mappings} />
        </div>
    );
}
