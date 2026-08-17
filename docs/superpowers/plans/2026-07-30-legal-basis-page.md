# Legal Basis Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the public page `greengate.africa/legal-basis`, which restates and justifies the Green-Gate carbon contribution calculation against its national and international legal basis.

**Architecture:** A server component at `frontend/src/app/(legal)/legal-basis/page.tsx` carries the SEO metadata and JSON-LD, and renders a client content component built on the existing `LegalPageShell` (the same shell as privacy-policy / terms-of-service / security-audit). All copy lives in the `LegalBasis` next-intl namespace across the six locale files; a message-parity test guards against the real failure mode (a key missing in one locale makes next-intl throw at render for that language).

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4 with `--os-*` CSS variables, next-intl (cookie-based locale, no URL prefix), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-30-legal-basis-page-design.md`

## Global Constraints

- **TypeScript strict. Never use `any`.**
- **Locale is cookie-based** (`NEXT_LOCALE`, see `frontend/src/i18n/request.ts`). There are **no** `/en/...` locale-prefixed routes — never emit `alternates.languages`.
- **Colors come from `--os-*` CSS variables** plus the accent hexes already used in `LegalPageShell` (`#00D97E` green, `#F59E0B` amber). The Tailwind palette `forest-*` **does not exist** in this codebase — never use it.
- **Six locales, full parity**: `en`, `fr`, `ar`, `pt`, `sw`, `so` in `frontend/messages/`.
- **Never invent legal figures, document references, or citations.** Every number and document reference in this plan was verified against `docs/onboarding/seeds/`. Reproduce them exactly.
- **The page must contain no hyperlink to a PDF.** The source documents are listed as citable texts with an "available on request" statement. There are no PDFs in `frontend/public/docs/`.
- Run commands from `frontend/`. Test: `npm run test`. Lint: `npm run lint`.
- Commits: author `Loic Leclerc <leclerc@drwintech.com>`, conventional humanised messages, explicit path staging (never `git add -A`), **no AI co-author or "Generated with" footer**.

---

### Task 1: English message catalog

**Files:**
- Modify: `frontend/messages/en.json`
- Test: `frontend/src/components/legal/legalBasisMessages.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: the `LegalBasis` namespace key set — the canonical reference every other locale must match, and the exact keys `LegalBasisContent.tsx` calls in Task 4. Also `Legal.badge_legal_basis`, `Legal.footer_legal_basis`, `Footer.legal_basis`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/legal/legalBasisMessages.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import en from '../../../messages/en.json';

type Messages = Record<string, Record<string, string>>;

const EN = en as unknown as Messages;

describe('LegalBasis message catalog — English reference', () => {
    it('defines the LegalBasis namespace', () => {
        expect(EN.LegalBasis).toBeDefined();
    });

    it('defines the document header keys', () => {
        for (const key of ['title', 'subtitle', 'version', 'effective_date', 'last_updated']) {
            expect(EN.LegalBasis[key], `LegalBasis.${key}`).toBeTruthy();
        }
    });

    it('defines a title for each of the seven sections', () => {
        for (let i = 1; i <= 7; i++) {
            const key = `section_0${i}_title`;
            expect(EN.LegalBasis[key], `LegalBasis.${key}`).toBeTruthy();
        }
    });

    it('defines the shell integration keys', () => {
        expect(EN.Legal.badge_legal_basis).toBeTruthy();
        expect(EN.Legal.footer_legal_basis).toBeTruthy();
        expect(EN.Footer.legal_basis).toBeTruthy();
    });

    it('has no empty or whitespace-only value', () => {
        for (const [key, value] of Object.entries(EN.LegalBasis)) {
            expect(typeof value, `LegalBasis.${key} must be a string`).toBe('string');
            expect(value.trim(), `LegalBasis.${key} must not be blank`).not.toBe('');
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/legal/legalBasisMessages.test.ts`
Expected: FAIL — `expected undefined to be defined` on the `LegalBasis` namespace.

- [ ] **Step 3: Add the `LegalBasis` namespace to `frontend/messages/en.json`**

Insert this namespace as a new top-level key. Place it immediately after the existing `"SecurityAudit"` namespace so the legal namespaces stay grouped. Reproduce the values **exactly** — they are the published legal text.

```json
"LegalBasis": {
  "title": "Legal Basis & Methodology References",
  "subtitle": "Green-Gate Programme — the national legal framework, international methodology and calculation rules underpinning every carbon contribution pro-forma issued by SOLIDE TECHNOLOGY on behalf of the Republic of Somaliland.",
  "version": "1.0",
  "effective_date": "31 March 2026",
  "last_updated": "30 July 2026",

  "section_01_title": "Programme Summary",
  "s01_intro": "The Green-Gate Programme is a national sovereign carbon contribution scheme established by ministerial decree and operated under a ten-year concession. The table below states its essential parameters.",
  "s01_table_header_field": "Field",
  "s01_table_header_value": "Details",
  "s01_row_programme_label": "Programme",
  "s01_row_programme_value": "Green-Gate Sovereign Carbon Contribution Programme",
  "s01_row_concessionaire_label": "Concessionaire",
  "s01_row_concessionaire_value": "SOLIDE TECHNOLOGY — 10-year concession under Decree MOE&CC/MWI/36/2026",
  "s01_row_perimeter_label": "Perimeter",
  "s01_row_perimeter_value": "All vessels calling at any Somaliland port (maritime); all commercial flights transiting the Somaliland Flight Information Region (aviation)",
  "s01_row_rate_label": "Carbon rate",
  "s01_row_rate_value": "USD 40 per tonne of CO2 — uniform across maritime and aviation",
  "s01_row_currency_label": "Currency",
  "s01_row_currency_value": "US Dollar (USD)",
  "s01_row_bank_label": "Bank",
  "s01_row_bank_value": "Premier Bank Limited, Durdur Branch, Hargeisa — SWIFT PBSMSOSM",
  "s01_decree_note": "Ministerial Decree <b>MOE&CC/MWI/36/2026</b>, adopted in Hargeisa on 31 March 2026 by the Ministry of Environment & Climate Change together with the Ministry of Water Industry.",

  "section_02_title": "National Legal Framework (Somaliland)",
  "s02_a1_title": "A.1 — Ministerial Decree MOE&CC/MWI/36/2026",
  "s02_a1_p1": "Adopted in Hargeisa on 31 March 2026 by the Ministry of Environment & Climate Change together with the Ministry of Water Industry, this decree formally establishes the Green-Gate Programme as a national sovereign carbon contribution scheme applicable to all commercial vessels and aircraft operating within Somaliland jurisdiction.",
  "s02_a1_articles_label": "Key provisions",
  "s02_a1_art_1": "Article 1 — Establishment of the Green-Gate Programme",
  "s02_a1_art_2": "Article 2 — Perimeter of application (EEZ + FIR)",
  "s02_a1_art_3": "Article 3 — Appointment of SOLIDE TECHNOLOGY as concessionaire (10 years, renewable)",
  "s02_a1_art_4": "Article 4 — Carbon rate set at USD 40 per tonne of CO2",
  "s02_a1_art_5": "Article 5 — Collection, remittance and audit obligations",
  "s02_a1_art_6": "Article 6 — Late-payment penalty (flat USD 20,000 per document)",
  "s02_a1_art_7": "Article 7 — Recovery procedure and international enforcement",
  "s02_a1_doc_label": "Reference document: English translation of the decree, certified by the Ministry of Foreign Affairs.",
  "s02_a2_title": "A.2 — Somaliland Maritime Carbon Tax Act (2024)",
  "s02_a2_p1": "National framework legislation adopted in 2024 authorising the imposition of carbon contributions on all maritime commerce calling at Somaliland ports. This Act provides the parent authorisation under which Decree MOE&CC/MWI/36/2026 was issued.",
  "s02_a2_doc_label": "Reference document: Somaliland Maritime Carbon Tax Act 2024, English text.",
  "s02_a3_title": "A.3 — SOLIDE TECHNOLOGY concession agreement",
  "s02_a3_p1": "The ten-year concession agreement between the Republic of Somaliland and SOLIDE TECHNOLOGY, signed in Hargeisa on 31 March 2026, sets out the operational, financial and reporting obligations of the concessionaire.",
  "s02_a3_doc_label": "Reference document: concession agreement, extracts — commercial terms redacted.",
  "s02_availability": "Certified copies of the instruments listed in this section are available on request to <b>st.operations@greengate.africa</b>. Requests from counsel acting for a debtor are answered with the certified English translation of the decree and the parent Act.",

  "section_03_title": "Maritime Methodology (IMO / UNCLOS / EU MRV)",
  "s03_b1_title": "B.1 — IMO MEPC.346(78): voyage-based CO2 method",
  "s03_b1_p1": "The Green-Gate maritime contribution is calculated using the internationally recognised voyage-based CO2 measurement method defined by the International Maritime Organization in resolution MEPC.346(78), adopted at the 78th session of the Marine Environment Protection Committee.",
  "s03_b1_formula": "CO2 emitted = bunker fuel consumed × emission factor of the fuel",
  "s03_b1_p2": "For Heavy Fuel Oil (HFO) the emission factor is <b>3.114 tonnes of CO2 per tonne of fuel</b> (IMO MEPC.346(78), Table 1). Alternative factors apply to Marine Diesel Oil, LNG, methanol and ammonia.",
  "s03_b2_title": "B.2 — UNCLOS Article 211: port-State sovereignty",
  "s03_b2_p1": "The United Nations Convention on the Law of the Sea (UNCLOS), Article 211, confers on port States the right to impose environmental measures, including monetary charges, on vessels calling at their ports and operating within their Exclusive Economic Zone.",
  "s03_b2_p2": "The Republic of Somaliland exercises this sovereign right through the Green-Gate Programme, which applies to all vessels berthing at the Port of Berbera and other Somaliland maritime facilities.",
  "s03_b3_title": "B.3 — EU MRV Regulation 2023/957: calibration reference",
  "s03_b3_p1": "Regulation (EU) 2023/957 on the monitoring, reporting and verification of CO2 emissions from maritime transport is used as a calibration reference for the Green-Gate methodology, ensuring compatibility with international reporting standards.",
  "s03_b4_title": "B.4 — Calculation formula and worked example",
  "s03_b4_formula": "Contribution (USD) = voyage CO2 (tCO2) × 50% (international voyage allocation) × USD 40 per tCO2",
  "s03_b4_caption": "Worked example — vessel RASHA, bulk carrier, 17,784 GT, IMO 9235957, pro-forma PRO-2026-064001 (voyage Dubai → Berbera, arrival 26 April 2026).",
  "s03_b4_table_header_step": "Step",
  "s03_b4_table_header_value": "Value",
  "s03_b4_row1_step": "Standardised voyage distance",
  "s03_b4_row1_value": "4,500 nm",
  "s03_b4_row2_step": "Standard speed",
  "s03_b4_row2_value": "13 knots",
  "s03_b4_row3_step": "Voyage duration",
  "s03_b4_row3_value": "14.4 days",
  "s03_b4_row4_step": "HFO bunker consumption",
  "s03_b4_row4_value": "465.6 t",
  "s03_b4_row5_step": "CO2 emission factor (HFO)",
  "s03_b4_row5_value": "× 3.114 tCO2 per tonne",
  "s03_b4_row6_step": "Total voyage CO2",
  "s03_b4_row6_value": "1,450 tCO2",
  "s03_b4_row7_step": "International allocation",
  "s03_b4_row7_value": "× 50%",
  "s03_b4_row8_step": "Taxable CO2",
  "s03_b4_row8_value": "725 tCO2",
  "s03_b4_row9_step": "Carbon rate",
  "s03_b4_row9_value": "× USD 40.00 per tonne",
  "s03_b4_row10_step": "Total contribution due",
  "s03_b4_row10_value": "USD 29,000",
  "s03_b4_note": "The figures above are illustrative and rounded for presentation. Where an issued pro-forma states a different amount — pro-forma PRO-2026-064001 states USD 28,999.99 — <b>the amount printed on the pro-forma invoice prevails</b>.",

  "section_04_title": "Aviation Methodology (Chicago Convention / CORSIA / IPCC)",
  "s04_c1_title": "C.1 — Chicago Convention 1944, Articles 15 and 24",
  "s04_c1_p1": "The Convention on International Civil Aviation (Chicago, 7 December 1944) permits States to levy airport and route charges under Article 15 and prohibits the taxation of aviation fuel under Article 24, while allowing environmental charges based on emissions.",
  "s04_c1_p2": "The Green-Gate aviation contribution is structured as an environmental charge on CO2-equivalent emissions, not as a fuel tax, and is therefore compatible with Article 24.",
  "s04_c2_title": "C.2 — CORSIA: ICAO Annex 16, Volume IV",
  "s04_c2_p1": "The Carbon Offsetting and Reduction Scheme for International Aviation (CORSIA), established by ICAO through Annex 16 Volume IV to the Chicago Convention, provides the international framework for measuring, reporting and offsetting aviation CO2 emissions.",
  "s04_c2_p2": "CORSIA becomes mandatory in 2027. The Green-Gate methodology is aligned with CORSIA measurement standards.",
  "s04_c3_title": "C.3 — IPCC AR6: Radiative Forcing Index",
  "s04_c3_p1": "The Sixth Assessment Report of the Intergovernmental Panel on Climate Change (IPCC AR6) confirms that aviation's total climate impact is approximately twice its CO2 emissions, owing to non-CO2 effects: contrails, NOx-induced ozone formation and water vapour.",
  "s04_c3_p2": "Green-Gate applies a <b>Radiative Forcing Index multiplier of 2.0</b> to cruise emissions, in line with the IPCC AR6 central estimate and consistent with EU ETS aviation methodology.",
  "s04_c4_title": "C.4 — Calculation formula and worked example",
  "s04_c4_formula": "Contribution (USD) = voyage CO2 baseline (tCO2) × RFI 2.0 × USD 40 per tCO2",
  "s04_c4_caption": "Worked example — Ethiopian Airlines Group flight ET-309, route ADD-HGA, Boeing 737-800, pro-forma AVI-MAI-2026-0001 (flight of 1 May 2026).",
  "s04_c4_table_header_step": "Step",
  "s04_c4_table_header_value": "Value",
  "s04_c4_row1_step": "Aircraft type",
  "s04_c4_row1_value": "B737-800",
  "s04_c4_row2_step": "Route",
  "s04_c4_row2_value": "ADD-HGA",
  "s04_c4_row3_step": "LTO cycle CO2",
  "s04_c4_row3_value": "2.50 tCO2",
  "s04_c4_row4_step": "Cruise CO2 (1.5 h × 3.0 tCO2/h)",
  "s04_c4_row4_value": "4.50 tCO2",
  "s04_c4_row5_step": "Voyage CO2 baseline",
  "s04_c4_row5_value": "7.00 tCO2",
  "s04_c4_row6_step": "Radiative Forcing Index",
  "s04_c4_row6_value": "× 2.0",
  "s04_c4_row7_step": "Effective CO2-equivalent",
  "s04_c4_row7_value": "14.00 tCO2e",
  "s04_c4_row8_step": "Carbon rate",
  "s04_c4_row8_value": "× USD 40.00 per tonne",
  "s04_c4_row9_step": "Total contribution due",
  "s04_c4_row9_value": "USD 560",
  "s04_c4_note": "The passenger-based component was removed by decision of the SOLIDE Committee in June 2026 and does not apply to any pro-forma issued thereafter.",

  "section_05_title": "Governance & Audit",
  "s05_d1_title": "D.1 — ASCR, Africa Sovereign Carbon Registry",
  "s05_d1_p1": "The Africa Sovereign Carbon Registry (ASCR) is a pan-African foundation endorsed by the African Union, providing the continental settlement registry for sovereign carbon contributions collected under national programmes such as Green-Gate.",
  "s05_d1_members": "ASCR members as of July 2026: Djibouti, Gabon, Liberia, Somaliland.",
  "s05_d2_title": "D.2 — Independent auditors",
  "s05_d2_amspec": "AmSpec Group — independent maritime and aviation emissions auditor, headquartered in Cranbury, New Jersey, United States.",
  "s05_d2_mazars": "Forvis Mazars — independent financial auditor, a top-ten global audit firm headquartered in Paris.",
  "s05_d2_p1": "Both auditors publish annual assurance reports on the Green-Gate Programme, available on request from the concessionaire.",
  "s05_d3_title": "D.3 — African Union endorsement",
  "s05_d3_p1": "The Green-Gate framework is endorsed under the African Union Climate & Development Strategy 2022-2032, paragraph 4.7 on sovereign carbon mechanisms.",

  "section_06_title": "Dispute Resolution & Jurisdiction",
  "s06_e1_title": "E.1 — Dispute period",
  "s06_e1_p1": "Any debtor may raise a formal dispute in writing within <b>10 business days</b> of receipt of a pro-forma invoice. Disputes must be sent to st.operations@greengate.africa together with all supporting documentation.",
  "s06_e2_title": "E.2 — Governing law",
  "s06_e2_p1": "Pro-forma invoices issued under the Green-Gate Programme are governed by the laws of the Republic of Somaliland. The Somaliland courts have exclusive jurisdiction over the substantive validity of the contribution.",
  "s06_e3_title": "E.3 — Recovery jurisdiction",
  "s06_e3_p1": "Non-payment triggers a graduated recovery process:",
  "s06_e3_j15": "Day 15 — first reminder, issued by the SOLIDE TECHNOLOGY operations team.",
  "s06_e3_j30": "Day 30 — formal notice, issued by SOLIDE TECHNOLOGY management, copied to the Ministry of Environment & Climate Change.",
  "s06_e3_j45": "Day 45 — referral to the bailiff Eidle Advocats in Hargeisa for in rem enforcement, particularly in respect of entities designated under OFAC or UN sanctions, and to the Antwerp Bar (cabinet Van Hooydonk) for international recovery within the European Union.",
  "s06_e3_j90": "Day 90 — public listing on the Green-Gate registry and notification to national maritime authorities and to IATA.",

  "section_07_title": "Contact & Correspondence",
  "s07_org": "SOLIDE TECHNOLOGY — Concessionaire, Green-Gate Programme",
  "s07_address": "Masalaha Street, M.Haybe District, Hargeisa, Republic of Somaliland",
  "s07_director_label": "Director",
  "s07_director_value": "Noël KPATCHAVI",
  "s07_email_label": "Email",
  "s07_email_value": "st.operations@greengate.africa",
  "s07_phone_label": "Phone",
  "s07_phone_value": "+33 7 51 42 23 84",
  "s07_ministry_label": "Ministry of supervision",
  "s07_ministry_value": "Ministry of Environment & Climate Change — Republic of Somaliland",
  "s07_dossier": "The consolidated legal dossier, comprising the ministerial decree, the parent Act, the concession extracts and the methodology references cited on this page, is <b>available on request to st.operations@greengate.africa</b>."
}
```

- [ ] **Step 4: Add the three shell integration keys**

In `frontend/messages/en.json`, add to the **existing** `Legal` namespace:

```json
"badge_legal_basis": "Legal Basis & Methodology",
"footer_legal_basis": "Legal Basis"
```

and to the **existing** `Footer` namespace:

```json
"legal_basis": "Legal Basis"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/legal/legalBasisMessages.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/messages/en.json frontend/src/components/legal/legalBasisMessages.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(legal): textes anglais de la page base légale"
```

---

### Task 2: French message catalog

**Files:**
- Modify: `frontend/messages/fr.json`
- Modify: `frontend/src/components/legal/legalBasisMessages.test.ts`

**Interfaces:**
- Consumes: the `LegalBasis` key set defined in Task 1 (`frontend/messages/en.json`) — read that file for the authoritative key list and English source text.
- Produces: `fr.json` with a `LegalBasis` namespace whose key set is identical to English.

- [ ] **Step 1: Extend the test to require English/French parity**

Append to `frontend/src/components/legal/legalBasisMessages.test.ts`:

```ts
import fr from '../../../messages/fr.json';

const FR = fr as unknown as Messages;

describe('LegalBasis message catalog — French', () => {
    it('has exactly the English key set', () => {
        expect(Object.keys(FR.LegalBasis ?? {}).sort()).toEqual(Object.keys(EN.LegalBasis).sort());
    });

    it('has no empty or whitespace-only value', () => {
        for (const [key, value] of Object.entries(FR.LegalBasis ?? {})) {
            expect(typeof value, `LegalBasis.${key} must be a string`).toBe('string');
            expect(value.trim(), `LegalBasis.${key} must not be blank`).not.toBe('');
        }
    });

    it('defines the shell integration keys', () => {
        expect(FR.Legal.badge_legal_basis).toBeTruthy();
        expect(FR.Legal.footer_legal_basis).toBeTruthy();
        expect(FR.Footer.legal_basis).toBeTruthy();
    });
});
```

Move the `import fr` line up beside the existing `import en` line — imports must sit at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/legal/legalBasisMessages.test.ts`
Expected: FAIL — the French key set is `[]` against ~110 English keys.

- [ ] **Step 3: Translate the namespace into `frontend/messages/fr.json`**

Add a `LegalBasis` namespace with **the identical key set**, translating each English value into formal institutional French. Translation rules:

- **Never translate**: organisation names (SOLIDE TECHNOLOGY, AmSpec Group, Forvis Mazars, Eidle Advocats, Ethiopian Airlines Group, Premier Bank Limited), document references (`MOE&CC/MWI/36/2026`, `MEPC.346(78)`, `PRO-2026-064001`, `AVI-MAI-2026-0001`, `PBSMSOSM`, `IMO 9235957`), vessel and route codes (RASHA, ET-309, ADD-HGA, B737-800), and the acronyms IMO, UNCLOS, MRV, CORSIA, ICAO, IPCC, ASCR, AU, IATA, OFAC, EEZ/FIR (use "ZEE" and "FIR" in French).
- **Never alter a figure**: `4,500 nm`, `13 knots`, `14.4 days`, `465.6 t`, `3.114`, `1,450 tCO2`, `50%`, `725 tCO2`, `USD 40.00`, `USD 29,000`, `USD 28,999.99`, `2.50`, `4.50`, `7.00`, `2.0`, `14.00`, `USD 560`, `USD 20,000`, `10 business days`, days 15/30/45/90. Use French number formatting (`4 500 nm`, `14,4 jours`, `465,6 t`, `3,114`, `1 450 tCO2`, `28 999,99 USD`) but never a different quantity.
- **Preserve the `<b>…</b>` tags** exactly where they appear in the English value — they are rendered through `t.rich`.
- Keep `title`, `version`, `effective_date` (`31 mars 2026`) and `last_updated` (`30 juillet 2026`) consistent with English.

- [ ] **Step 4: Add the three shell integration keys to `fr.json`**

To the existing `Legal` namespace: `"badge_legal_basis": "Base légale et méthodologie"`, `"footer_legal_basis": "Base légale"`. To the existing `Footer` namespace: `"legal_basis": "Base légale"`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/legal/legalBasisMessages.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/messages/fr.json frontend/src/components/legal/legalBasisMessages.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(legal): traduction française de la page base légale"
```

---

### Task 3: Arabic, Portuguese, Swahili and Somali catalogs

**Files:**
- Modify: `frontend/messages/ar.json`, `frontend/messages/pt.json`, `frontend/messages/sw.json`, `frontend/messages/so.json`
- Modify: `frontend/src/components/legal/legalBasisMessages.test.ts`

**Interfaces:**
- Consumes: the `LegalBasis` key set and English source text from `frontend/messages/en.json`.
- Produces: all six locales at full parity — the precondition for Task 4's page to render in every language.

- [ ] **Step 1: Replace the per-locale describe blocks with a table-driven parity test**

Rewrite `frontend/src/components/legal/legalBasisMessages.test.ts` so the English reference block from Task 1 stays exactly as it is, and the whole `describe('LegalBasis message catalog — French', …)` block from Task 2 is **deleted** and replaced by the loop below. Also delete the now-unused `const FR = fr as unknown as Messages;` line — `fr` is consumed by the `TRANSLATIONS` table instead. Keep exactly one `import fr` statement, grouped with the other locale imports at the top of the file:

```ts
import ar from '../../../messages/ar.json';
import fr from '../../../messages/fr.json';
import pt from '../../../messages/pt.json';
import so from '../../../messages/so.json';
import sw from '../../../messages/sw.json';

const TRANSLATIONS: ReadonlyArray<readonly [string, Messages]> = [
    ['ar', ar as unknown as Messages],
    ['fr', fr as unknown as Messages],
    ['pt', pt as unknown as Messages],
    ['so', so as unknown as Messages],
    ['sw', sw as unknown as Messages],
];

describe.each(TRANSLATIONS)('LegalBasis message catalog — %s', (locale, messages) => {
    it('has exactly the English key set', () => {
        expect(Object.keys(messages.LegalBasis ?? {}).sort()).toEqual(Object.keys(EN.LegalBasis).sort());
    });

    it('has no empty or whitespace-only value', () => {
        for (const [key, value] of Object.entries(messages.LegalBasis ?? {})) {
            expect(typeof value, `${locale} LegalBasis.${key} must be a string`).toBe('string');
            expect(value.trim(), `${locale} LegalBasis.${key} must not be blank`).not.toBe('');
        }
    });

    it('defines the shell integration keys', () => {
        expect(messages.Legal.badge_legal_basis, `${locale} Legal.badge_legal_basis`).toBeTruthy();
        expect(messages.Legal.footer_legal_basis, `${locale} Legal.footer_legal_basis`).toBeTruthy();
        expect(messages.Footer.legal_basis, `${locale} Footer.legal_basis`).toBeTruthy();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/legal/legalBasisMessages.test.ts`
Expected: FAIL — four locales (`ar`, `pt`, `so`, `sw`) report an empty key set.

- [ ] **Step 3: Add the namespace to the four remaining locales**

Add a `LegalBasis` namespace with the identical key set to `ar.json`, `pt.json`, `sw.json` and `so.json`, translating the English values. **The same translation rules as Task 2 apply** — never translate organisation names, document references, vessel/route codes or acronyms; never alter a figure; preserve `<b>…</b>` tags exactly.

These four are a baseline translation for native review later, matching how the other locales in this repo were produced. Arabic is right-to-left: write natural RTL prose and leave Latin-script references and figures inline as they are.

Also add to each file's existing `Legal` namespace `badge_legal_basis` and `footer_legal_basis`, and to its existing `Footer` namespace `legal_basis`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/legal/legalBasisMessages.test.ts`
Expected: PASS — 20 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/messages/ar.json frontend/messages/pt.json frontend/messages/sw.json frontend/messages/so.json frontend/src/components/legal/legalBasisMessages.test.ts
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(legal): base légale traduite ar/pt/sw/so"
```

---

### Task 4: Page and content component

**Files:**
- Create: `frontend/src/components/legal/LegalBasisContent.tsx`
- Create: `frontend/src/app/(legal)/legal-basis/page.tsx`
- Test: `frontend/src/components/legal/LegalBasisContent.test.tsx` (create)

**Interfaces:**
- Consumes: `LegalPageShell, LegalSection, LegalP, LegalUl, LegalLi, LegalHighlight, LegalTable` from `@/components/legal/LegalPageShell`; the `LegalBasis` and `Legal` namespaces from Tasks 1–3.
- Produces: `export default function LegalBasisContent()` — a client component taking no props, consumed by the route's server component. Task 5 does not consume it.

- [ ] **Step 1: Write the failing render test**

Create `frontend/src/components/legal/LegalBasisContent.test.tsx`. It renders against the **real** English catalog, so a key the component asks for but the catalog lacks fails here:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../messages/en.json';
import LegalBasisContent from './LegalBasisContent';

vi.mock('next/navigation', () => ({
    useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/layout/Navbar', () => ({
    Navbar: () => <nav data-testid="navbar" />,
}));

function renderPage() {
    return render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <LegalBasisContent />
        </NextIntlClientProvider>,
    );
}

describe('LegalBasisContent', () => {
    it('renders the document title', () => {
        renderPage();
        expect(screen.getByRole('heading', { level: 1, name: /Legal Basis & Methodology References/i })).toBeInTheDocument();
    });

    it('renders all seven section headings', () => {
        renderPage();
        for (const title of [
            /Programme Summary/i,
            /National Legal Framework/i,
            /Maritime Methodology/i,
            /Aviation Methodology/i,
            /Governance & Audit/i,
            /Dispute Resolution & Jurisdiction/i,
            /Contact & Correspondence/i,
        ]) {
            expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
        }
    });

    it('states the verified maritime worked example', () => {
        renderPage();
        expect(screen.getByText('4,500 nm')).toBeInTheDocument();
        expect(screen.getByText('725 tCO2')).toBeInTheDocument();
        expect(screen.getByText('USD 29,000')).toBeInTheDocument();
    });

    it('states the verified aviation worked example and its real pro-forma reference', () => {
        renderPage();
        expect(screen.getByText('USD 560')).toBeInTheDocument();
        expect(screen.getByText(/AVI-MAI-2026-0001/)).toBeInTheDocument();
    });

    it('offers the source documents on request rather than as downloads', () => {
        renderPage();
        expect(screen.getAllByText(/available on request/i).length).toBeGreaterThan(0);
        expect(document.querySelector('a[href$=".pdf"]')).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/legal/LegalBasisContent.test.tsx`
Expected: FAIL — cannot resolve `./LegalBasisContent`.

- [ ] **Step 3: Create `frontend/src/components/legal/LegalBasisContent.tsx`**

```tsx
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
```

- [ ] **Step 4: Create the route at `frontend/src/app/(legal)/legal-basis/page.tsx`**

Note the `alternates` block carries **only** `canonical` — this app has no locale-prefixed routes.

```tsx
import type { Metadata } from 'next';
import LegalBasisContent from '@/components/legal/LegalBasisContent';

export const metadata: Metadata = {
    title: 'Legal Basis & Methodology | Green-Gate Programme',
    description:
        'Full legal framework, calculation methodology and international references supporting the Green-Gate sovereign carbon contribution — Republic of Somaliland. Ministerial Decree MOE&CC/MWI/36/2026, IMO MEPC.346(78), UNCLOS, CORSIA.',
    keywords: [
        'Green-Gate',
        'Somaliland carbon tax',
        'sovereign carbon contribution',
        'SOLIDE TECHNOLOGY',
        'MOE&CC/MWI/36/2026',
        'IMO MEPC.346(78)',
        'CORSIA',
        'UNCLOS Article 211',
        'ASCR',
    ],
    robots: { index: true, follow: true },
    alternates: { canonical: 'https://greengate.africa/legal-basis' },
    openGraph: {
        title: 'Green-Gate — Legal Basis & Methodology',
        description:
            'Ministerial Decree MOE&CC/MWI/36/2026 · IMO MEPC.346(78) · CORSIA · UNCLOS · ASCR',
        url: 'https://greengate.africa/legal-basis',
        type: 'article',
    },
};

const JSON_LD = {
    '@context': 'https://schema.org',
    '@type': 'GovernmentService',
    name: 'Green-Gate Sovereign Carbon Contribution Programme',
    provider: {
        '@type': 'Organization',
        name: 'SOLIDE TECHNOLOGY',
        url: 'https://greengate.africa',
        email: 'st.operations@greengate.africa',
    },
    serviceType: 'Environmental levy / carbon contribution',
    areaServed: { '@type': 'Country', name: 'Somaliland' },
    url: 'https://greengate.africa/legal-basis',
} as const;

export default function LegalBasisPage() {
    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
            />
            <LegalBasisContent />
        </>
    );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/legal/`
Expected: PASS — the 5 render tests plus the 20 catalog tests.

- [ ] **Step 6: Verify types and lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/legal/LegalBasisContent.tsx frontend/src/components/legal/LegalBasisContent.test.tsx frontend/src/app/\(legal\)/legal-basis/page.tsx
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(legal): page publique base légale et méthodologie"
```

---

### Task 5: Navigation wiring

**Files:**
- Modify: `frontend/src/components/legal/LegalPageShell.tsx:110-114`
- Modify: `frontend/src/components/layout/Footer.tsx:16-22`

**Interfaces:**
- Consumes: `Legal.footer_legal_basis` and `Footer.legal_basis` from Tasks 1–3; the route created in Task 4.
- Produces: nothing consumed downstream — this is the final task.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/legal/LegalBasisContent.test.tsx`:

```tsx
describe('LegalBasisContent — cross-links', () => {
    it('links to the other legal documents from the shell footer', () => {
        renderPage();
        for (const href of ['/privacy-policy', '/terms-of-service', '/security-audit']) {
            expect(document.querySelector(`a[href="${href}"]`), href).not.toBeNull();
        }
    });

    it('exposes the legal-basis link in the shell footer', () => {
        renderPage();
        expect(document.querySelector('a[href="/legal-basis"]')).not.toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/legal/LegalBasisContent.test.tsx`
Expected: FAIL on the second test — the shell footer has only three links.

- [ ] **Step 3: Add the fourth link to the shell footer**

In `frontend/src/components/legal/LegalPageShell.tsx`, inside the footer link row (after the `security-audit` anchor), add:

```tsx
<a href={`/legal-basis${from ? `?from=${from}` : ''}`} className="hover:text-[#38BDF8] transition-colors">{t('footer_legal_basis')}</a>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/legal/LegalBasisContent.test.tsx`
Expected: PASS — 7 tests.

- [ ] **Step 5: Add the site footer entry**

In `frontend/src/components/layout/Footer.tsx`, add to `SUPPORT_ROUTES` after `security_audit`:

```ts
legal_basis:      '/legal-basis',
```

The footer renders `Object.entries(SUPPORT_ROUTES)` and calls `t(key)`, so `Footer.legal_basis` from Tasks 1–3 supplies the label — no further change is needed there.

- [ ] **Step 6: Run the full suite, types and lint**

Run: `cd frontend && npm run test && npx tsc --noEmit && npm run lint`
Expected: the whole suite passes with no type or lint error. `AdminWalletsPanel` is a known flaky test under load — if it is the only failure, re-run it alone to confirm.

- [ ] **Step 7: Verify the page renders in the running app**

Run: `cd frontend && npm run dev` then open `http://localhost:3300/legal-basis`.
Check: the sidebar lists seven sections, both worked-example tables render, no link points at a `.pdf`, and switching locale through the navbar switcher re-renders the page without a missing-message error.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/legal/LegalPageShell.tsx frontend/src/components/layout/Footer.tsx frontend/src/components/legal/LegalBasisContent.test.tsx
git commit --author="Loïc Leclerc <leclerc@drwintech.com>" -m "feat(legal): lien base légale dans les pieds de page"
```

---

## Out of scope

Confirmed with the PO, do **not** do these:

- No `sitemap.xml` — the repo has none; creating one is a separate SEO task.
- No change to the Go tax engine, to any migration, or to the PDF preamble in `invoiceService.ts`.
- No PDF files added under `frontend/public/docs/` — the Direction has not supplied them.
- Do not publish the production engine's methodology on this page. The spec's §8 records the divergence as an open question for the Direction; it stays out of the page.
