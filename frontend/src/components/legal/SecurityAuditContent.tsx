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
                    headers={[t('section_01_table_header_indicator'), t('section_01_table_header_status'), t('section_01_table_header_standard')]}
                    rows={[
                        [t('section_01_row1_indicator'), t('section_01_row1_status'), t('section_01_row1_standard')],
                        [t('section_01_row2_indicator'), t('section_01_row2_status'), t('section_01_row2_standard')],
                        [t('section_01_row3_indicator'), t('section_01_row3_status'), t('section_01_row3_standard')],
                        [t('section_01_row4_indicator'), t('section_01_row4_status'), t('section_01_row4_standard')],
                        [t('section_01_row5_indicator'), t('section_01_row5_status'), t('section_01_row5_standard')],
                        [t('section_01_row6_indicator'), t('section_01_row6_status'), t('section_01_row6_standard')],
                        [t('section_01_row7_indicator'), t('section_01_row7_status'), t('section_01_row7_standard')],
                        [t('section_01_row8_indicator'), t('section_01_row8_status'), t('section_01_row8_standard')],
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
                    headers={[t('section_02_table_header_component'), t('section_02_table_header_scope'), t('section_02_table_header_methodology')]}
                    rows={[
                        [t('section_02_row1_component'), t('section_02_row1_scope'), t('section_02_row1_methodology')],
                        [t('section_02_row2_component'), t('section_02_row2_scope'), t('section_02_row2_methodology')],
                        [t('section_02_row3_component'), t('section_02_row3_scope'), t('section_02_row3_methodology')],
                        [t('section_02_row4_component'), t('section_02_row4_scope'), t('section_02_row4_methodology')],
                        [t('section_02_row5_component'), t('section_02_row5_scope'), t('section_02_row5_methodology')],
                        [t('section_02_row6_component'), t('section_02_row6_scope'), t('section_02_row6_methodology')],
                        [t('section_02_row7_component'), t('section_02_row7_scope'), t('section_02_row7_methodology')],
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
                    headers={[t('section_04_table_header_control'), t('section_04_table_header_implementation'), t('section_04_table_header_status')]}
                    rows={[
                        [t('section_04_row1_control'), t('section_04_row1_implementation'), t('section_04_row1_status')],
                        [t('section_04_row2_control'), t('section_04_row2_implementation'), t('section_04_row2_status')],
                        [t('section_04_row3_control'), t('section_04_row3_implementation'), t('section_04_row3_status')],
                        [t('section_04_row4_control'), t('section_04_row4_implementation'), t('section_04_row4_status')],
                        [t('section_04_row5_control'), t('section_04_row5_implementation'), t('section_04_row5_status')],
                        [t('section_04_row6_control'), t('section_04_row6_implementation'), t('section_04_row6_status')],
                        [t('section_04_row7_control'), t('section_04_row7_implementation'), t('section_04_row7_status')],
                        [t('section_04_row8_control'), t('section_04_row8_implementation'), t('section_04_row8_status')],
                    ]}
                />
            </LegalSection>

            {/* 05 */}
            <LegalSection id="encryption" number="05" title={t('section_05_title')}>
                <LegalTable
                    headers={[t('section_05_table_header_context'), t('section_05_table_header_algorithm'), t('section_05_table_header_key_mgmt')]}
                    rows={[
                        [t('section_05_row1_context'), t('section_05_row1_algorithm'), t('section_05_row1_key_mgmt')],
                        [t('section_05_row2_context'), t('section_05_row2_algorithm'), t('section_05_row2_key_mgmt')],
                        [t('section_05_row3_context'), t('section_05_row3_algorithm'), t('section_05_row3_key_mgmt')],
                        [t('section_05_row4_context'), t('section_05_row4_algorithm'), t('section_05_row4_key_mgmt')],
                        [t('section_05_row5_context'), t('section_05_row5_algorithm'), t('section_05_row5_key_mgmt')],
                        [t('section_05_row6_context'), t('section_05_row6_algorithm'), t('section_05_row6_key_mgmt')],
                        [t('section_05_row7_context'), t('section_05_row7_algorithm'), t('section_05_row7_key_mgmt')],
                        [t('section_05_row8_context'), t('section_05_row8_algorithm'), t('section_05_row8_key_mgmt')],
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
                    headers={[t('section_08_table_header_id'), t('section_08_table_header_category'), t('section_08_table_header_severity'), t('section_08_table_header_status'), t('section_08_table_header_remediation')]}
                    rows={[
                        [t('section_08_row1_id'), t('section_08_row1_category'), t('section_08_row1_severity'), t('section_08_row1_status'), t('section_08_row1_remediation')],
                        [t('section_08_row2_id'), t('section_08_row2_category'), t('section_08_row2_severity'), t('section_08_row2_status'), t('section_08_row2_remediation')],
                        [t('section_08_row3_id'), t('section_08_row3_category'), t('section_08_row3_severity'), t('section_08_row3_status'), t('section_08_row3_remediation')],
                        [t('section_08_row4_id'), t('section_08_row4_category'), t('section_08_row4_severity'), t('section_08_row4_status'), t('section_08_row4_remediation')],
                        [t('section_08_row5_id'), t('section_08_row5_category'), t('section_08_row5_severity'), t('section_08_row5_status'), t('section_08_row5_remediation')],
                    ]}
                />
                <LegalHighlight>
                    {t.rich('section_08_highlight', richTextComponents)}
                </LegalHighlight>
            </LegalSection>

            {/* 09 */}
            <LegalSection id="compliance" number="09" title={t('section_09_title')}>
                <LegalTable
                    headers={[t('section_09_table_header_framework'), t('section_09_table_header_scope'), t('section_09_table_header_status'), t('section_09_table_header_review')]}
                    rows={[
                        [t('section_09_row01_framework'), t('section_09_row01_scope'), t('section_09_row01_status'), t('section_09_row01_review')],
                        [t('section_09_row02_framework'), t('section_09_row02_scope'), t('section_09_row02_status'), t('section_09_row02_review')],
                        [t('section_09_row03_framework'), t('section_09_row03_scope'), t('section_09_row03_status'), t('section_09_row03_review')],
                        [t('section_09_row04_framework'), t('section_09_row04_scope'), t('section_09_row04_status'), t('section_09_row04_review')],
                        [t('section_09_row05_framework'), t('section_09_row05_scope'), t('section_09_row05_status'), t('section_09_row05_review')],
                        [t('section_09_row06_framework'), t('section_09_row06_scope'), t('section_09_row06_status'), t('section_09_row06_review')],
                        [t('section_09_row07_framework'), t('section_09_row07_scope'), t('section_09_row07_status'), t('section_09_row07_review')],
                        [t('section_09_row08_framework'), t('section_09_row08_scope'), t('section_09_row08_status'), t('section_09_row08_review')],
                        [t('section_09_row09_framework'), t('section_09_row09_scope'), t('section_09_row09_status'), t('section_09_row09_review')],
                        [t('section_09_row10_framework'), t('section_09_row10_scope'), t('section_09_row10_status'), t('section_09_row10_review')],
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
                    headers={[t('section_10_table_header_cve'), t('section_10_table_header_component'), t('section_10_table_header_severity'), t('section_10_table_header_status')]}
                    rows={[
                        [t('section_10_row1_cve'), t('section_10_row1_component'), t('section_10_row1_severity'), t('section_10_row1_status')],
                        [t('section_10_row2_cve'), t('section_10_row2_component'), t('section_10_row2_severity'), t('section_10_row2_status')],
                        [t('section_10_row3_cve'), t('section_10_row3_component'), t('section_10_row3_severity'), t('section_10_row3_status')],
                        [t('section_10_row4_cve'), t('section_10_row4_component'), t('section_10_row4_severity'), t('section_10_row4_status')],
                    ]}
                />
            </LegalSection>

            {/* 11 */}
            <LegalSection id="incident" number="11" title={t('section_11_title')}>
                <LegalP>
                    {t('section_11_p1')}
                </LegalP>
                <LegalTable
                    headers={[t('section_11_table_header_phase'), t('section_11_table_header_procedure'), t('section_11_table_header_sla')]}
                    rows={[
                        [t('section_11_row1_phase'), t('section_11_row1_procedure'), t('section_11_row1_sla')],
                        [t('section_11_row2_phase'), t('section_11_row2_procedure'), t('section_11_row2_sla')],
                        [t('section_11_row3_phase'), t('section_11_row3_procedure'), t('section_11_row3_sla')],
                        [t('section_11_row4_phase'), t('section_11_row4_procedure'), t('section_11_row4_sla')],
                        [t('section_11_row5_phase'), t('section_11_row5_procedure'), t('section_11_row5_sla')],
                        [t('section_11_row6_phase'), t('section_11_row6_procedure'), t('section_11_row6_sla')],
                    ]}
                />
                <LegalHighlight>
                    {t.rich('section_11_highlight', richTextComponents)}
                </LegalHighlight>
            </LegalSection>

            {/* 12 */}
            <LegalSection id="roadmap" number="12" title={t('section_12_title')}>
                <LegalTable
                    headers={[t('section_12_table_header_initiative'), t('section_12_table_header_target'), t('section_12_table_header_status')]}
                    rows={[
                        [t('section_12_row01_initiative'), t('section_12_row01_target'), t('section_12_row01_status')],
                        [t('section_12_row02_initiative'), t('section_12_row02_target'), t('section_12_row02_status')],
                        [t('section_12_row03_initiative'), t('section_12_row03_target'), t('section_12_row03_status')],
                        [t('section_12_row04_initiative'), t('section_12_row04_target'), t('section_12_row04_status')],
                        [t('section_12_row05_initiative'), t('section_12_row05_target'), t('section_12_row05_status')],
                        [t('section_12_row06_initiative'), t('section_12_row06_target'), t('section_12_row06_status')],
                        [t('section_12_row07_initiative'), t('section_12_row07_target'), t('section_12_row07_status')],
                        [t('section_12_row08_initiative'), t('section_12_row08_target'), t('section_12_row08_status')],
                        [t('section_12_row09_initiative'), t('section_12_row09_target'), t('section_12_row09_status')],
                        [t('section_12_row10_initiative'), t('section_12_row10_target'), t('section_12_row10_status')],
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
