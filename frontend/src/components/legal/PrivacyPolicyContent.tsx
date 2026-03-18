'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
    LegalPageShell, LegalSection, LegalP, LegalUl, LegalLi,
    LegalHighlight, LegalWarning, LegalTable,
} from '@/components/legal/LegalPageShell';

const richTextComponents = {
    b: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
};

export default function PrivacyPolicyContent() {
    const t = useTranslations('PrivacyPolicy');
    const legal = useTranslations('Legal');

    const SECTIONS = [
        { id: 'preamble',      title: t('section_01_title') },
        { id: 'controller',    title: t('section_02_title') },
        { id: 'data-collected', title: t('section_03_title') },
        { id: 'purpose',       title: t('section_04_title') },
        { id: 'legal-basis',   title: t('section_05_title') },
        { id: 'retention',     title: t('section_06_title') },
        { id: 'sharing',       title: t('section_07_title') },
        { id: 'rights',        title: t('section_08_title') },
        { id: 'ais-data',      title: t('section_09_title') },
        { id: 'security',      title: t('section_10_title') },
        { id: 'cookies',       title: t('section_11_title') },
        { id: 'contact',       title: t('section_12_title') },
    ];

    return (
        <LegalPageShell
            title={t('title')}
            subtitle={t('subtitle')}
            version={t('version')}
            effectiveDate={t('effective_date')}
            lastUpdated={t('last_updated')}
            badgeLabel={legal('badge_privacy')}
            badgeColor="#38BDF8"
            sections={SECTIONS}
        >
            {/* 01 */}
            <LegalSection id="preamble" number="01" title={t('section_01_title')}>
                <LegalP>
                    {t.rich('section_01_p1', richTextComponents)}
                </LegalP>
                <LegalHighlight>
                    {t.rich('section_01_highlight', richTextComponents)}
                </LegalHighlight>
                <LegalP>
                    {t.rich('section_01_p2', richTextComponents)}
                </LegalP>
            </LegalSection>

            {/* 02 */}
            <LegalSection id="controller" number="02" title={t('section_02_title')}>
                <LegalTable
                    headers={[t('section_02_table_h1'), t('section_02_table_h2')]}
                    rows={[
                        [t('section_02_row_01_c1'), t('section_02_row_01_c2')],
                        [t('section_02_row_02_c1'), t('section_02_row_02_c2')],
                        [t('section_02_row_03_c1'), t('section_02_row_03_c2')],
                        [t('section_02_row_04_c1'), t('section_02_row_04_c2')],
                        [t('section_02_row_05_c1'), t('section_02_row_05_c2')],
                        [t('section_02_row_06_c1'), t('section_02_row_06_c2')],
                        [t('section_02_row_07_c1'), t('section_02_row_07_c2')],
                    ]}
                />
            </LegalSection>

            {/* 03 */}
            <LegalSection id="data-collected" number="03" title={t('section_03_title')}>
                <LegalP>{t('section_03_p1')}</LegalP>

                <div className="flex flex-col gap-4">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-[#00D97E] mb-2">{t('section_03_cat_a_title')}</p>
                        <LegalUl>
                            <LegalLi>{t('section_03_cat_a_li1')}</LegalLi>
                            <LegalLi>{t('section_03_cat_a_li2')}</LegalLi>
                            <LegalLi>{t('section_03_cat_a_li3')}</LegalLi>
                            <LegalLi>{t('section_03_cat_a_li4')}</LegalLi>
                            <LegalLi>{t('section_03_cat_a_li5')}</LegalLi>
                            <LegalLi>{t('section_03_cat_a_li6')}</LegalLi>
                        </LegalUl>
                    </div>
                    <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-[#38BDF8] mb-2">{t('section_03_cat_b_title')}</p>
                        <LegalUl>
                            <LegalLi>{t('section_03_cat_b_li1')}</LegalLi>
                            <LegalLi>{t('section_03_cat_b_li2')}</LegalLi>
                            <LegalLi>{t('section_03_cat_b_li3')}</LegalLi>
                            <LegalLi>{t('section_03_cat_b_li4')}</LegalLi>
                            <LegalLi>{t('section_03_cat_b_li5')}</LegalLi>
                        </LegalUl>
                    </div>
                    <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-[#F59E0B] mb-2">{t('section_03_cat_c_title')}</p>
                        <LegalUl>
                            <LegalLi>{t('section_03_cat_c_li1')}</LegalLi>
                            <LegalLi>{t('section_03_cat_c_li2')}</LegalLi>
                            <LegalLi>{t('section_03_cat_c_li3')}</LegalLi>
                            <LegalLi>{t('section_03_cat_c_li4')}</LegalLi>
                            <LegalLi>{t('section_03_cat_c_li5')}</LegalLi>
                        </LegalUl>
                    </div>
                </div>
            </LegalSection>

            {/* 04 */}
            <LegalSection id="purpose" number="04" title={t('section_04_title')}>
                <LegalTable
                    headers={[t('section_04_table_h1'), t('section_04_table_h2'), t('section_04_table_h3')]}
                    rows={[
                        [t('section_04_row_01_c1'), t('section_04_row_01_c2'), t('section_04_row_01_c3')],
                        [t('section_04_row_02_c1'), t('section_04_row_02_c2'), t('section_04_row_02_c3')],
                        [t('section_04_row_03_c1'), t('section_04_row_03_c2'), t('section_04_row_03_c3')],
                        [t('section_04_row_04_c1'), t('section_04_row_04_c2'), t('section_04_row_04_c3')],
                        [t('section_04_row_05_c1'), t('section_04_row_05_c2'), t('section_04_row_05_c3')],
                        [t('section_04_row_06_c1'), t('section_04_row_06_c2'), t('section_04_row_06_c3')],
                        [t('section_04_row_07_c1'), t('section_04_row_07_c2'), t('section_04_row_07_c3')],
                        [t('section_04_row_08_c1'), t('section_04_row_08_c2'), t('section_04_row_08_c3')],
                    ]}
                />
            </LegalSection>

            {/* 05 */}
            <LegalSection id="legal-basis" number="05" title={t('section_05_title')}>
                <LegalP>
                    {t('section_05_p1')}
                </LegalP>
                <LegalUl>
                    <LegalLi>{t.rich('section_05_li1', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_05_li2', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_05_li3', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_05_li4', richTextComponents)}</LegalLi>
                </LegalUl>
                <LegalWarning>
                    {t.rich('section_05_warning', richTextComponents)}
                </LegalWarning>
            </LegalSection>

            {/* 06 */}
            <LegalSection id="retention" number="06" title={t('section_06_title')}>
                <LegalTable
                    headers={[t('section_06_table_h1'), t('section_06_table_h2'), t('section_06_table_h3')]}
                    rows={[
                        [t('section_06_row_01_c1'), t('section_06_row_01_c2'), t('section_06_row_01_c3')],
                        [t('section_06_row_02_c1'), t('section_06_row_02_c2'), t('section_06_row_02_c3')],
                        [t('section_06_row_03_c1'), t('section_06_row_03_c2'), t('section_06_row_03_c3')],
                        [t('section_06_row_04_c1'), t('section_06_row_04_c2'), t('section_06_row_04_c3')],
                        [t('section_06_row_05_c1'), t('section_06_row_05_c2'), t('section_06_row_05_c3')],
                        [t('section_06_row_06_c1'), t('section_06_row_06_c2'), t('section_06_row_06_c3')],
                        [t('section_06_row_07_c1'), t('section_06_row_07_c2'), t('section_06_row_07_c3')],
                        [t('section_06_row_08_c1'), t('section_06_row_08_c2'), t('section_06_row_08_c3')],
                    ]}
                />
                <LegalP>
                    {t('section_06_p1')}
                </LegalP>
            </LegalSection>

            {/* 07 */}
            <LegalSection id="sharing" number="07" title={t('section_07_title')}>
                <LegalP>{t('section_07_p1')}</LegalP>
                <LegalUl>
                    <LegalLi>{t.rich('section_07_li1', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_07_li2', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_07_li3', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_07_li4', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_07_li5', richTextComponents)}</LegalLi>
                </LegalUl>
                <LegalWarning>
                    {t.rich('section_07_warning', richTextComponents)}
                </LegalWarning>
            </LegalSection>

            {/* 08 */}
            <LegalSection id="rights" number="08" title={t('section_08_title')}>
                <LegalP>
                    {t('section_08_p1')}
                </LegalP>
                <LegalTable
                    headers={[t('section_08_table_h1'), t('section_08_table_h2'), t('section_08_table_h3')]}
                    rows={[
                        [t('section_08_row_01_c1'), t('section_08_row_01_c2'), t('section_08_row_01_c3')],
                        [t('section_08_row_02_c1'), t('section_08_row_02_c2'), t('section_08_row_02_c3')],
                        [t('section_08_row_03_c1'), t('section_08_row_03_c2'), t('section_08_row_03_c3')],
                        [t('section_08_row_04_c1'), t('section_08_row_04_c2'), t('section_08_row_04_c3')],
                        [t('section_08_row_05_c1'), t('section_08_row_05_c2'), t('section_08_row_05_c3')],
                        [t('section_08_row_06_c1'), t('section_08_row_06_c2'), t('section_08_row_06_c3')],
                        [t('section_08_row_07_c1'), t('section_08_row_07_c2'), t('section_08_row_07_c3')],
                    ]}
                />
                <LegalP>
                    {t.rich('section_08_p2', richTextComponents)}
                </LegalP>
            </LegalSection>

            {/* 09 */}
            <LegalSection id="ais-data" number="09" title={t('section_09_title')}>
                <LegalHighlight>
                    {t('section_09_highlight')}
                </LegalHighlight>
                <LegalP>
                    {t('section_09_p1')}
                </LegalP>
                <LegalP>
                    {t('section_09_p2')}
                </LegalP>
            </LegalSection>

            {/* 10 */}
            <LegalSection id="security" number="10" title={t('section_10_title')}>
                <LegalP>
                    {t('section_10_p1')}
                </LegalP>
                <LegalUl>
                    <LegalLi>{t.rich('section_10_li1', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_10_li2', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_10_li3', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_10_li4', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_10_li5', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_10_li6', richTextComponents)}</LegalLi>
                </LegalUl>
            </LegalSection>

            {/* 11 */}
            <LegalSection id="cookies" number="11" title={t('section_11_title')}>
                <LegalP>
                    {t('section_11_p1')}
                </LegalP>
                <LegalTable
                    headers={[t('section_11_table_h1'), t('section_11_table_h2'), t('section_11_table_h3'), t('section_11_table_h4')]}
                    rows={[
                        [t('section_11_row_01_c1'), t('section_11_row_01_c2'), t('section_11_row_01_c3'), t('section_11_row_01_c4')],
                        [t('section_11_row_02_c1'), t('section_11_row_02_c2'), t('section_11_row_02_c3'), t('section_11_row_02_c4')],
                        [t('section_11_row_03_c1'), t('section_11_row_03_c2'), t('section_11_row_03_c3'), t('section_11_row_03_c4')],
                        [t('section_11_row_04_c1'), t('section_11_row_04_c2'), t('section_11_row_04_c3'), t('section_11_row_04_c4')],
                    ]}
                />
                <LegalP>
                    {t.rich('section_11_p2', richTextComponents)}
                </LegalP>
            </LegalSection>

            {/* 12 */}
            <LegalSection id="contact" number="12" title={t('section_12_title')}>
                <LegalTable
                    headers={[t('section_12_table_h1'), t('section_12_table_h2')]}
                    rows={[
                        [t('section_12_row_01_c1'), t('section_12_row_01_c2')],
                        [t('section_12_row_02_c1'), t('section_12_row_02_c2')],
                        [t('section_12_row_03_c1'), t('section_12_row_03_c2')],
                        [t('section_12_row_04_c1'), t('section_12_row_04_c2')],
                        [t('section_12_row_05_c1'), t('section_12_row_05_c2')],
                    ]}
                />
                <LegalP>
                    {t.rich('section_12_p1', richTextComponents)}
                </LegalP>
                <LegalHighlight>
                    {t.rich('section_12_highlight', richTextComponents)}
                </LegalHighlight>
            </LegalSection>
        </LegalPageShell>
    );
}
