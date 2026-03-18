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

export default function SecurityAuditContent() {
    const t = useTranslations('SecurityAudit');
    const legal = useTranslations('Legal');

    const SECTIONS = [
        { id: 'overview',        title: t('section_01_title') },
        { id: 'scope',           title: t('section_02_title') },
        { id: 'architecture',    title: t('section_03_title') },
        { id: 'access-control',  title: t('section_04_title') },
        { id: 'encryption',      title: t('section_05_title') },
        { id: 'audit-trail',     title: t('section_06_title') },
        { id: 'network',         title: t('section_07_title') },
        { id: 'pentest',         title: t('section_08_title') },
        { id: 'compliance',      title: t('section_09_title') },
        { id: 'vulnerabilities', title: t('section_10_title') },
        { id: 'incident',        title: t('section_11_title') },
        { id: 'roadmap',         title: t('section_12_title') },
    ];

    return (
        <LegalPageShell
            title={t('title')}
            subtitle={t('subtitle')}
            version={t('version')}
            effectiveDate={t('effective_date')}
            lastUpdated={t('last_updated')}
            badgeLabel={legal('badge_security')}
            badgeColor="#F59E0B"
            sections={SECTIONS}
        >
            {/* 01 */}
            <LegalSection id="overview" number="01" title={t('section_01_title')}>
                <LegalHighlight>
                    {t.rich('section_01_highlight', richTextComponents)}
                </LegalHighlight>
                <LegalTable
                    headers={[t('section_01_table_h1'), t('section_01_table_h2'), t('section_01_table_h3')]}
                    rows={[
                        [t('section_01_row_01_c1'), t('section_01_row_01_c2'), t('section_01_row_01_c3')],
                        [t('section_01_row_02_c1'), t('section_01_row_02_c2'), t('section_01_row_02_c3')],
                        [t('section_01_row_03_c1'), t('section_01_row_03_c2'), t('section_01_row_03_c3')],
                        [t('section_01_row_04_c1'), t('section_01_row_04_c2'), t('section_01_row_04_c3')],
                        [t('section_01_row_05_c1'), t('section_01_row_05_c2'), t('section_01_row_05_c3')],
                        [t('section_01_row_06_c1'), t('section_01_row_06_c2'), t('section_01_row_06_c3')],
                        [t('section_01_row_07_c1'), t('section_01_row_07_c2'), t('section_01_row_07_c3')],
                        [t('section_01_row_08_c1'), t('section_01_row_08_c2'), t('section_01_row_08_c3')],
                    ]}
                />
            </LegalSection>

            {/* 02 */}
            <LegalSection id="scope" number="02" title={t('section_02_title')}>
                <LegalP>
                    {t('section_02_p1')}
                </LegalP>
                <LegalUl>
                    <LegalLi>{t.rich('section_02_li1', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_02_li2', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_02_li3', richTextComponents)}</LegalLi>
                </LegalUl>
                <LegalP>{t('section_02_p2')}</LegalP>
                <LegalTable
                    headers={[t('section_02_table_h1'), t('section_02_table_h2'), t('section_02_table_h3')]}
                    rows={[
                        [t('section_02_row_01_c1'), t('section_02_row_01_c2'), t('section_02_row_01_c3')],
                        [t('section_02_row_02_c1'), t('section_02_row_02_c2'), t('section_02_row_02_c3')],
                        [t('section_02_row_03_c1'), t('section_02_row_03_c2'), t('section_02_row_03_c3')],
                        [t('section_02_row_04_c1'), t('section_02_row_04_c2'), t('section_02_row_04_c3')],
                        [t('section_02_row_05_c1'), t('section_02_row_05_c2'), t('section_02_row_05_c3')],
                        [t('section_02_row_06_c1'), t('section_02_row_06_c2'), t('section_02_row_06_c3')],
                        [t('section_02_row_07_c1'), t('section_02_row_07_c2'), t('section_02_row_07_c3')],
                    ]}
                />
            </LegalSection>

            {/* 03 */}
            <LegalSection id="architecture" number="03" title={t('section_03_title')}>
                <LegalP>
                    {t.rich('section_03_p1', richTextComponents)}
                </LegalP>
                <LegalUl>
                    <LegalLi>{t.rich('section_03_li1', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_03_li2', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_03_li3', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_03_li4', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_03_li5', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_03_li6', richTextComponents)}</LegalLi>
                </LegalUl>
            </LegalSection>

            {/* 04 */}
            <LegalSection id="access-control" number="04" title={t('section_04_title')}>
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
            <LegalSection id="encryption" number="05" title={t('section_05_title')}>
                <LegalTable
                    headers={[t('section_05_table_h1'), t('section_05_table_h2'), t('section_05_table_h3')]}
                    rows={[
                        [t('section_05_row_01_c1'), t('section_05_row_01_c2'), t('section_05_row_01_c3')],
                        [t('section_05_row_02_c1'), t('section_05_row_02_c2'), t('section_05_row_02_c3')],
                        [t('section_05_row_03_c1'), t('section_05_row_03_c2'), t('section_05_row_03_c3')],
                        [t('section_05_row_04_c1'), t('section_05_row_04_c2'), t('section_05_row_04_c3')],
                        [t('section_05_row_05_c1'), t('section_05_row_05_c2'), t('section_05_row_05_c3')],
                        [t('section_05_row_06_c1'), t('section_05_row_06_c2'), t('section_05_row_06_c3')],
                        [t('section_05_row_07_c1'), t('section_05_row_07_c2'), t('section_05_row_07_c3')],
                        [t('section_05_row_08_c1'), t('section_05_row_08_c2'), t('section_05_row_08_c3')],
                    ]}
                />
                <LegalP>
                    {t.rich('section_05_p1', richTextComponents)}
                </LegalP>
            </LegalSection>

            {/* 06 */}
            <LegalSection id="audit-trail" number="06" title={t('section_06_title')}>
                <LegalHighlight>
                    {t('section_06_highlight')}
                </LegalHighlight>
                <LegalP>{t('section_06_p1')}</LegalP>
                <LegalUl>
                    <LegalLi>{t.rich('section_06_li1', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_06_li2', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_06_li3', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_06_li4', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_06_li5', richTextComponents)}</LegalLi>
                </LegalUl>
            </LegalSection>

            {/* 07 */}
            <LegalSection id="network" number="07" title={t('section_07_title')}>
                <LegalUl>
                    <LegalLi>{t.rich('section_07_li1', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_07_li2', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_07_li3', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_07_li4', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_07_li5', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_07_li6', richTextComponents)}</LegalLi>
                </LegalUl>
            </LegalSection>

            {/* 08 */}
            <LegalSection id="pentest" number="08" title={t('section_08_title')}>
                <LegalWarning>
                    {t.rich('section_08_warning', richTextComponents)}
                </LegalWarning>
                <LegalTable
                    headers={[t('section_08_table_h1'), t('section_08_table_h2'), t('section_08_table_h3'), t('section_08_table_h4'), t('section_08_table_h5')]}
                    rows={[
                        [t('section_08_row_01_c1'), t('section_08_row_01_c2'), t('section_08_row_01_c3'), t('section_08_row_01_c4'), t('section_08_row_01_c5')],
                        [t('section_08_row_02_c1'), t('section_08_row_02_c2'), t('section_08_row_02_c3'), t('section_08_row_02_c4'), t('section_08_row_02_c5')],
                        [t('section_08_row_03_c1'), t('section_08_row_03_c2'), t('section_08_row_03_c3'), t('section_08_row_03_c4'), t('section_08_row_03_c5')],
                        [t('section_08_row_04_c1'), t('section_08_row_04_c2'), t('section_08_row_04_c3'), t('section_08_row_04_c4'), t('section_08_row_04_c5')],
                        [t('section_08_row_05_c1'), t('section_08_row_05_c2'), t('section_08_row_05_c3'), t('section_08_row_05_c4'), t('section_08_row_05_c5')],
                    ]}
                />
                <LegalHighlight>
                    {t.rich('section_08_highlight', richTextComponents)}
                </LegalHighlight>
            </LegalSection>

            {/* 09 */}
            <LegalSection id="compliance" number="09" title={t('section_09_title')}>
                <LegalTable
                    headers={[t('section_09_table_h1'), t('section_09_table_h2'), t('section_09_table_h3'), t('section_09_table_h4')]}
                    rows={[
                        [t('section_09_row_01_c1'), t('section_09_row_01_c2'), t('section_09_row_01_c3'), t('section_09_row_01_c4')],
                        [t('section_09_row_02_c1'), t('section_09_row_02_c2'), t('section_09_row_02_c3'), t('section_09_row_02_c4')],
                        [t('section_09_row_03_c1'), t('section_09_row_03_c2'), t('section_09_row_03_c3'), t('section_09_row_03_c4')],
                        [t('section_09_row_04_c1'), t('section_09_row_04_c2'), t('section_09_row_04_c3'), t('section_09_row_04_c4')],
                        [t('section_09_row_05_c1'), t('section_09_row_05_c2'), t('section_09_row_05_c3'), t('section_09_row_05_c4')],
                        [t('section_09_row_06_c1'), t('section_09_row_06_c2'), t('section_09_row_06_c3'), t('section_09_row_06_c4')],
                        [t('section_09_row_07_c1'), t('section_09_row_07_c2'), t('section_09_row_07_c3'), t('section_09_row_07_c4')],
                        [t('section_09_row_08_c1'), t('section_09_row_08_c2'), t('section_09_row_08_c3'), t('section_09_row_08_c4')],
                        [t('section_09_row_09_c1'), t('section_09_row_09_c2'), t('section_09_row_09_c3'), t('section_09_row_09_c4')],
                        [t('section_09_row_10_c1'), t('section_09_row_10_c2'), t('section_09_row_10_c3'), t('section_09_row_10_c4')],
                    ]}
                />
            </LegalSection>

            {/* 10 */}
            <LegalSection id="vulnerabilities" number="10" title={t('section_10_title')}>
                <LegalP>
                    {t('section_10_p1')}
                </LegalP>
                <LegalUl>
                    <LegalLi>{t.rich('section_10_li1', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_10_li2', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_10_li3', richTextComponents)}</LegalLi>
                    <LegalLi>{t.rich('section_10_li4', richTextComponents)}</LegalLi>
                </LegalUl>
                <LegalTable
                    headers={[t('section_10_table_h1'), t('section_10_table_h2'), t('section_10_table_h3'), t('section_10_table_h4')]}
                    rows={[
                        [t('section_10_row_01_c1'), t('section_10_row_01_c2'), t('section_10_row_01_c3'), t('section_10_row_01_c4')],
                        [t('section_10_row_02_c1'), t('section_10_row_02_c2'), t('section_10_row_02_c3'), t('section_10_row_02_c4')],
                        [t('section_10_row_03_c1'), t('section_10_row_03_c2'), t('section_10_row_03_c3'), t('section_10_row_03_c4')],
                        [t('section_10_row_04_c1'), t('section_10_row_04_c2'), t('section_10_row_04_c3'), t('section_10_row_04_c4')],
                    ]}
                />
            </LegalSection>

            {/* 11 */}
            <LegalSection id="incident" number="11" title={t('section_11_title')}>
                <LegalP>
                    {t('section_11_p1')}
                </LegalP>
                <LegalTable
                    headers={[t('section_11_table_h1'), t('section_11_table_h2'), t('section_11_table_h3')]}
                    rows={[
                        [t('section_11_row_01_c1'), t('section_11_row_01_c2'), t('section_11_row_01_c3')],
                        [t('section_11_row_02_c1'), t('section_11_row_02_c2'), t('section_11_row_02_c3')],
                        [t('section_11_row_03_c1'), t('section_11_row_03_c2'), t('section_11_row_03_c3')],
                        [t('section_11_row_04_c1'), t('section_11_row_04_c2'), t('section_11_row_04_c3')],
                        [t('section_11_row_05_c1'), t('section_11_row_05_c2'), t('section_11_row_05_c3')],
                        [t('section_11_row_06_c1'), t('section_11_row_06_c2'), t('section_11_row_06_c3')],
                    ]}
                />
                <LegalHighlight>
                    {t.rich('section_11_highlight', richTextComponents)}
                </LegalHighlight>
            </LegalSection>

            {/* 12 */}
            <LegalSection id="roadmap" number="12" title={t('section_12_title')}>
                <LegalTable
                    headers={[t('section_12_table_h1'), t('section_12_table_h2'), t('section_12_table_h3')]}
                    rows={[
                        [t('section_12_row_01_c1'), t('section_12_row_01_c2'), t('section_12_row_01_c3')],
                        [t('section_12_row_02_c1'), t('section_12_row_02_c2'), t('section_12_row_02_c3')],
                        [t('section_12_row_03_c1'), t('section_12_row_03_c2'), t('section_12_row_03_c3')],
                        [t('section_12_row_04_c1'), t('section_12_row_04_c2'), t('section_12_row_04_c3')],
                        [t('section_12_row_05_c1'), t('section_12_row_05_c2'), t('section_12_row_05_c3')],
                        [t('section_12_row_06_c1'), t('section_12_row_06_c2'), t('section_12_row_06_c3')],
                        [t('section_12_row_07_c1'), t('section_12_row_07_c2'), t('section_12_row_07_c3')],
                        [t('section_12_row_08_c1'), t('section_12_row_08_c2'), t('section_12_row_08_c3')],
                        [t('section_12_row_09_c1'), t('section_12_row_09_c2'), t('section_12_row_09_c3')],
                        [t('section_12_row_10_c1'), t('section_12_row_10_c2'), t('section_12_row_10_c3')],
                    ]}
                />
                <LegalP>
                    {t('section_12_p1')}
                </LegalP>
                <LegalWarning>
                    {t.rich('section_12_warning', richTextComponents)}
                </LegalWarning>
            </LegalSection>
        </LegalPageShell>
    );
}
