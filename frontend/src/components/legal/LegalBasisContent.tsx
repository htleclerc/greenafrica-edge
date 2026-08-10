'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
    LegalPageShell, LegalSection, LegalP, LegalUl, LegalLi,
    LegalHighlight, LegalTable,
} from '@/components/legal/LegalPageShell';

const richTextComponents = {
    b: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
    strong: (chunks: React.ReactNode) => <strong>{chunks}</strong>,
};

function SubHeading({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-xs font-bold uppercase tracking-widest text-[#00D97E] mt-3 mb-1">
            {children}
        </p>
    );
}

function Formula({ children }: { children: React.ReactNode }) {
    return (
        <div
            className="p-4 rounded-xl border font-mono text-xs leading-relaxed overflow-x-auto"
            style={{
                borderColor: 'var(--os-border)',
                backgroundColor: 'var(--os-surface-2)',
                color: 'var(--os-text-primary)',
            }}
        >
            {children}
        </div>
    );
}

function Caption({ children }: { children: React.ReactNode }) {
    return <p className="text-xs text-[var(--os-text-muted)] leading-relaxed">{children}</p>;
}

export default function LegalBasisContent() {
    const t = useTranslations('LegalBasis');
    const legal = useTranslations('Legal');

    const SECTIONS = [
        { id: 'programme-summary',    title: t('section_01_title') },
        { id: 'national-framework',   title: t('section_02_title') },
        { id: 'maritime-methodology', title: t('section_03_title') },
        { id: 'aviation-methodology', title: t('section_04_title') },
        { id: 'governance-audit',     title: t('section_05_title') },
        { id: 'dispute-jurisdiction', title: t('section_06_title') },
        { id: 'contact',              title: t('section_07_title') },
    ];

    const maritimeRows = Array.from({ length: 10 }, (_, i) => [
        t(`s03_b4_row${i + 1}_step`),
        t(`s03_b4_row${i + 1}_value`),
    ]);

    const aviationRows = Array.from({ length: 9 }, (_, i) => [
        t(`s04_c4_row${i + 1}_step`),
        t(`s04_c4_row${i + 1}_value`),
    ]);

    return (
        <LegalPageShell
            title={t('title')}
            subtitle={t('subtitle')}
            version={t('version')}
            effectiveDate={t('effective_date')}
            lastUpdated={t('last_updated')}
            badgeLabel={legal('badge_legal_basis')}
            badgeColor="#A78BFA"
            sections={SECTIONS}
        >
            {/* 01 — Programme summary */}
            <LegalSection id="programme-summary" number="01" title={t('section_01_title')}>
                <LegalP>{t('s01_intro')}</LegalP>
                <LegalTable
                    headers={[t('s01_table_header_field'), t('s01_table_header_value')]}
                    rows={[
                        [t('s01_row_programme_label'),      t('s01_row_programme_value')],
                        [t('s01_row_concessionaire_label'), t('s01_row_concessionaire_value')],
                        [t('s01_row_perimeter_label'),      t('s01_row_perimeter_value')],
                        [t('s01_row_rate_label'),           t('s01_row_rate_value')],
                        [t('s01_row_currency_label'),       t('s01_row_currency_value')],
                        [t('s01_row_bank_label'),           t('s01_row_bank_value')],
                    ]}
                />
                <LegalHighlight>{t.rich('s01_decree_note', richTextComponents)}</LegalHighlight>
            </LegalSection>

            {/* 02 — National legal framework */}
            <LegalSection id="national-framework" number="02" title={t('section_02_title')}>
                <SubHeading>{t('s02_a1_title')}</SubHeading>
                <LegalP>{t('s02_a1_p1')}</LegalP>
                <Caption>{t('s02_a1_articles_label')}</Caption>
                <LegalUl>
                    {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                        <LegalLi key={n}>{t(`s02_a1_art_${n}`)}</LegalLi>
                    ))}
                </LegalUl>
                <Caption>{t('s02_a1_doc_label')}</Caption>

                <SubHeading>{t('s02_a2_title')}</SubHeading>
                <LegalP>{t('s02_a2_p1')}</LegalP>
                <Caption>{t('s02_a2_doc_label')}</Caption>

                <SubHeading>{t('s02_a3_title')}</SubHeading>
                <LegalP>{t('s02_a3_p1')}</LegalP>
                <Caption>{t('s02_a3_doc_label')}</Caption>

                <LegalHighlight>{t.rich('s02_availability', richTextComponents)}</LegalHighlight>
            </LegalSection>

            {/* 03 — Maritime methodology */}
            <LegalSection id="maritime-methodology" number="03" title={t('section_03_title')}>
                <SubHeading>{t('s03_b1_title')}</SubHeading>
                <LegalP>{t('s03_b1_p1')}</LegalP>
                <Formula>{t('s03_b1_formula')}</Formula>
                <LegalP>{t.rich('s03_b1_p2', richTextComponents)}</LegalP>

                <SubHeading>{t('s03_b2_title')}</SubHeading>
                <LegalP>{t('s03_b2_p1')}</LegalP>
                <LegalP>{t('s03_b2_p2')}</LegalP>

                <SubHeading>{t('s03_b3_title')}</SubHeading>
                <LegalP>{t('s03_b3_p1')}</LegalP>

                <SubHeading>{t('s03_b4_title')}</SubHeading>
                <Formula>{t('s03_b4_formula')}</Formula>
                <Caption>{t('s03_b4_caption')}</Caption>
                <LegalTable
                    headers={[t('s03_b4_table_header_step'), t('s03_b4_table_header_value')]}
                    rows={maritimeRows}
                />
                <LegalHighlight>{t.rich('s03_b4_note', richTextComponents)}</LegalHighlight>
            </LegalSection>

            {/* 04 — Aviation methodology */}
            <LegalSection id="aviation-methodology" number="04" title={t('section_04_title')}>
                <SubHeading>{t('s04_c1_title')}</SubHeading>
                <LegalP>{t('s04_c1_p1')}</LegalP>
                <LegalP>{t('s04_c1_p2')}</LegalP>

                <SubHeading>{t('s04_c2_title')}</SubHeading>
                <LegalP>{t('s04_c2_p1')}</LegalP>
                <LegalP>{t('s04_c2_p2')}</LegalP>

                <SubHeading>{t('s04_c3_title')}</SubHeading>
                <LegalP>{t('s04_c3_p1')}</LegalP>
                <LegalP>{t.rich('s04_c3_p2', richTextComponents)}</LegalP>

                <SubHeading>{t('s04_c4_title')}</SubHeading>
                <Formula>{t('s04_c4_formula')}</Formula>
                <Caption>{t('s04_c4_caption')}</Caption>
                <LegalTable
                    headers={[t('s04_c4_table_header_step'), t('s04_c4_table_header_value')]}
                    rows={aviationRows}
                />
                <LegalHighlight>{t('s04_c4_note')}</LegalHighlight>
            </LegalSection>

            {/* 05 — Governance & audit */}
            <LegalSection id="governance-audit" number="05" title={t('section_05_title')}>
                <SubHeading>{t('s05_d1_title')}</SubHeading>
                <LegalP>{t('s05_d1_p1')}</LegalP>
                <Caption>{t('s05_d1_members')}</Caption>

                <SubHeading>{t('s05_d2_title')}</SubHeading>
                <LegalUl>
                    <LegalLi>{t('s05_d2_amspec')}</LegalLi>
                    <LegalLi>{t('s05_d2_mazars')}</LegalLi>
                </LegalUl>
                <LegalP>{t('s05_d2_p1')}</LegalP>

                <SubHeading>{t('s05_d3_title')}</SubHeading>
                <LegalP>{t('s05_d3_p1')}</LegalP>
            </LegalSection>

            {/* 06 — Dispute resolution & jurisdiction */}
            <LegalSection id="dispute-jurisdiction" number="06" title={t('section_06_title')}>
                <SubHeading>{t('s06_e1_title')}</SubHeading>
                <LegalP>{t.rich('s06_e1_p1', richTextComponents)}</LegalP>

                <SubHeading>{t('s06_e2_title')}</SubHeading>
                <LegalP>{t('s06_e2_p1')}</LegalP>

                <SubHeading>{t('s06_e3_title')}</SubHeading>
                <LegalP>{t('s06_e3_p1')}</LegalP>
                <LegalUl>
                    <LegalLi>{t('s06_e3_j15')}</LegalLi>
                    <LegalLi>{t('s06_e3_j30')}</LegalLi>
                    <LegalLi>{t('s06_e3_j45')}</LegalLi>
                    <LegalLi>{t('s06_e3_j90')}</LegalLi>
                </LegalUl>
            </LegalSection>

            {/* 07 — Contact */}
            <LegalSection id="contact" number="07" title={t('section_07_title')}>
                <LegalP>
                    <strong>{t('s07_org')}</strong>
                    <br />
                    {t('s07_address')}
                    <br />
                    <strong>{t('s07_director_label')}</strong>: {t('s07_director_value')}
                    <br />
                    <strong>{t('s07_email_label')}</strong>:{' '}
                    <a href={`mailto:${t('s07_email_value')}`} className="text-[#00D97E] hover:underline">
                        {t('s07_email_value')}
                    </a>
                    <br />
                    <strong>{t('s07_phone_label')}</strong>: {t('s07_phone_value')}
                    <br />
                    <strong>{t('s07_ministry_label')}</strong>: {t('s07_ministry_value')}
                </LegalP>
                <LegalHighlight>{t.rich('s07_dossier', richTextComponents)}</LegalHighlight>
            </LegalSection>
        </LegalPageShell>
    );
}
