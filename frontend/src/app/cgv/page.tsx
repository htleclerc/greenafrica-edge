import { getTranslations } from 'next-intl/server';

export default async function CgvPage() {
    const t = await getTranslations('Cgv');
    return (
        <div className="min-h-screen os-bg p-8 max-w-3xl mx-auto">
            <h1 className="text-3xl font-semibold mb-6">{t('title')}</h1>
            <div className="os-card p-6 space-y-4 text-sm">
                <p>{t('placeholder_p1')}</p>
                <p>{t('placeholder_p2')}</p>
                <p className="text-amber-400">{t('draft_notice')}</p>
            </div>
        </div>
    );
}
