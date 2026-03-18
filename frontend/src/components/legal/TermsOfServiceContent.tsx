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

export default function TermsOfServiceContent() {
    const t = useTranslations('TermsOfService');

    const SECTIONS = [
        { id: 'acceptance',        title: t('section_01_title') },
        { id: 'definitions',       title: t('section_02_title') },
        { id: 'eligibility',       title: t('section_03_title') },
        { id: 'obligations',       title: t('section_04_title') },
        { id: 'carbon-tax',        title: t('section_05_title') },
        { id: 'proforma',          title: t('section_06_title') },
        { id: 'prohibited',        title: t('section_07_title') },
        { id: 'ip',                title: t('section_08_title') },
        { id: 'data-sovereignty',  title: t('section_09_title') },
        { id: 'right-to-export',   title: t('section_10_title') },
        { id: 'liability',         title: t('section_11_title') },
        { id: 'suspension',        title: t('section_12_title') },
        { id: 'amendments',        title: t('section_13_title') },
        { id: 'governing-law',     title: t('section_14_title') },
    ];

    return (
        <LegalPageShell
            title={t('title')}
            subtitle={t('subtitle')}
            version={t('version')}
            effectiveDate={t('effective_date')}
            lastUpdated={t('last_updated')}
            badgeLabel={t('badge_label')}
            badgeColor="#00D97E"
            sections={SECTIONS}
        >
            {/* 01 */}
            <LegalSection id="acceptance" number="01" title={t('section_01_title')}>
                <LegalHighlight>
                    {t.rich('section_01_highlight', richTextComponents)}
                </LegalHighlight>
                <LegalP>
                    {t.rich('section_01_p1', richTextComponents)}
                </LegalP>
                <LegalP>
                    {t('section_01_p2')}
                </LegalP>
            </LegalSection>

            {/* 02 */}
            <LegalSection id="definitions" number="02" title={t('section_02_title')}>
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
                        [t('section_02_row_08_c1'), t('section_02_row_08_c2')],
                        [t('section_02_row_09_c1'), t('section_02_row_09_c2')],
                        [t('section_02_row_10_c1'), t('section_02_row_10_c2')],
                    ]}
                />
            </LegalSection>

            {/* 03 */}
            <LegalSection id="eligibility" number="03" title={t('section_03_title')}>
                <LegalP>
                    {t('section_03_p1')}
                </LegalP>
                <LegalUl>
                    <LegalLi>{t.rich('section_03_li1', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_03_li2', richTextComponents)}</LegalLi>
                </LegalUl>
                <LegalP>
                    {t('section_03_p2')}
                </LegalP>
                <LegalWarning>
                    {t.rich('section_03_warning', richTextComponents)}
                </LegalWarning>
            </LegalSection>

            {/* 04 */}
            <LegalSection id="obligations" number="04" title={t('section_04_title')}>
                <LegalP>{t('section_04_p1')}</LegalP>
                <LegalUl>
                    <LegalLi>{t('section_04_li1')}</LegalLi>
                    <LegalLi>{t.rich('section_04_li2', richTextComponents)}</LegalLi>
                    <LegalLi>{t('section_04_li3')}</LegalLi>
                    <LegalLi>{t('section_04_li4')}</LegalLi>
                    <LegalLi>{t('section_04_li5')}</LegalLi>
                    <LegalLi>{t('section_04_li6')}</LegalLi>
                </LegalUl>

                <div className="mt-2">
                    <p className="text-xs font-bold uppercase tracking-widest text-[#F59E0B] mb-2">{t('section_04_additional_title')}</p>
                    <LegalUl>
                        <LegalLi>{t('section_04_li7')}</LegalLi>
                        <LegalLi>{t('section_04_li8')}</LegalLi>
                        <LegalLi>{t('section_04_li9')}</LegalLi>
                    </LegalUl>
                </div>
            </LegalSection>

            {/* 05 */}
            <LegalSection id="carbon-tax" number="05" title={t('section_05_title')}>
                <LegalHighlight>
                    {t.rich('section_05_highlight', richTextComponents)}
                </LegalHighlight>
                <LegalTable
                    headers={[t('section_05_table_h1'), t('section_05_table_h2'), t('section_05_table_h3')]}
                    rows={[
                        [t('section_05_row_01_c1'), t('section_05_row_01_c2'), t('section_05_row_01_c3')],
                        [t('section_05_row_02_c1'), t('section_05_row_02_c2'), t('section_05_row_02_c3')],
                        [t('section_05_row_03_c1'), t('section_05_row_03_c2'), t('section_05_row_03_c3')],
                        [t('section_05_row_04_c1'), t('section_05_row_04_c2'), t('section_05_row_04_c3')],
                    ]}
                />
                <LegalP>
                    {t('section_05_p1')}
                </LegalP>
                <LegalP>
                    {t('section_05_p2')}
                </LegalP>
            </LegalSection>

            {/* 06 */}
            <LegalSection id="proforma" number="06" title={t('section_06_title')}>
                <LegalUl>
                    <LegalLi>{t('section_06_li1')}</LegalLi>
                    <LegalLi>{t('section_06_li2')}</LegalLi>
                    <LegalLi>{t('section_06_li3')}</LegalLi>
                    <LegalLi>{t('section_06_li4')}</LegalLi>
                    <LegalLi>{t('section_06_li5')}</LegalLi>
                </LegalUl>
                <LegalWarning>
                    {t.rich('section_06_warning', richTextComponents)}
                </LegalWarning>
            </LegalSection>

            {/* 07 */}
            <LegalSection id="prohibited" number="07" title={t('section_07_title')}>
                <LegalP>{t('section_07_p1')}</LegalP>
                <LegalUl>
                    <LegalLi>{t('section_07_li1')}</LegalLi>
                    <LegalLi>{t('section_07_li2')}</LegalLi>
                    <LegalLi>{t('section_07_li3')}</LegalLi>
                    <LegalLi>{t('section_07_li4')}</LegalLi>
                    <LegalLi>{t('section_07_li5')}</LegalLi>
                    <LegalLi>{t('section_07_li6')}</LegalLi>
                    <LegalLi>{t('section_07_li7')}</LegalLi>
                    <LegalLi>{t('section_07_li8')}</LegalLi>
                </LegalUl>
            </LegalSection>

            {/* 08 */}
            <LegalSection id="ip" number="08" title={t('section_08_title')}>
                <LegalP>
                    {t.rich('section_08_p1', richTextComponents)}
                </LegalP>
                <LegalP>
                    {t.rich('section_08_p2', richTextComponents)}
                </LegalP>
                <LegalP>
                    {t('section_08_p3')}
                </LegalP>
            </LegalSection>

            {/* 09 */}
            <LegalSection id="data-sovereignty" number="09" title={t('section_09_title')}>
                <LegalHighlight>
                    {t('section_09_highlight')}
                </LegalHighlight>
                <LegalP>
                    {t('section_09_p1')}
                </LegalP>
                <LegalUl>
                    <LegalLi>{t.rich('section_09_li1', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_09_li2', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_09_li3', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_09_li4', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_09_li5', richTextComponents)}</LegalLi>
                </LegalUl>
                <LegalWarning>
                    {t.rich('section_09_warning', richTextComponents)}
                </LegalWarning>
            </LegalSection>

            {/* 10 */}
            <LegalSection id="right-to-export" number="10" title={t('section_10_title')}>
                <LegalHighlight>
                    {t('section_10_highlight')}
                </LegalHighlight>
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
                <LegalP>
                    {t.rich('section_10_p2', richTextComponents)}
                </LegalP>
            </LegalSection>

            {/* 11 */}
            <LegalSection id="liability" number="11" title={t('section_11_title')}>
                <LegalP>
                    {t('section_11_p1')}
                </LegalP>
                <LegalUl>
                    <LegalLi>{t('section_11_li1')}</LegalLi>
                    <LegalLi>{t('section_11_li2')}</LegalLi>
                    <LegalLi>{t('section_11_li3')}</LegalLi>
                    <LegalLi>{t('section_11_li4')}</LegalLi>
                </LegalUl>
            </LegalSection>

            {/* 12 */}
            <LegalSection id="suspension" number="12" title={t('section_12_title')}>
                <LegalTable
                    headers={[t('section_12_table_h1'), t('section_12_table_h2'), t('section_12_table_h3')]}
                    rows={[
                        [t('section_12_row_01_c1'), t('section_12_row_01_c2'), t('section_12_row_01_c3')],
                        [t('section_12_row_02_c1'), t('section_12_row_02_c2'), t('section_12_row_02_c3')],
                        [t('section_12_row_03_c1'), t('section_12_row_03_c2'), t('section_12_row_03_c3')],
                        [t('section_12_row_04_c1'), t('section_12_row_04_c2'), t('section_12_row_04_c3')],
                        [t('section_12_row_05_c1'), t('section_12_row_05_c2'), t('section_12_row_05_c3')],
                    ]}
                />
            </LegalSection>

            {/* 13 */}
            <LegalSection id="amendments" number="13" title={t('section_13_title')}>
                <LegalP>
                    {t('section_13_p1')}
                </LegalP>
                <LegalUl>
                    <LegalLi>{t.rich('section_13_li1', richTextComponents)}</LegalLi>
                    <LegalLi>{t('section_13_li2')}</LegalLi>
                    <LegalLi>{t('section_13_li3')}</LegalLi>
                </LegalUl>
                <LegalP>
                    {t('section_13_p2')}
                </LegalP>
            </LegalSection>

            {/* 14 */}
            <LegalSection id="governing-law" number="14" title={t('section_14_title')}>
                <LegalHighlight>
                    {t.rich('section_14_highlight', richTextComponents)}
                </LegalHighlight>
                <LegalP>
                    {t.rich('section_14_p1', richTextComponents)}
                </LegalP>
                <LegalP>
                    {t.rich('section_14_p2', richTextComponents)}
                </LegalP>
            </LegalSection>
        </LegalPageShell>
    );
}
