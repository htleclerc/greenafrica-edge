-- ─────────────────────────────────────────────────────────────────────────────
-- Green-Gate — profil émetteur par juridiction (coordonnées, RIB, recouvrement)
-- Migration 131
--
-- POURQUOI
-- Tout ce que le pro-forma imprime en pied de page et en page 2 — émetteur,
-- directeur et son téléphone, e-mails de contact, comptes bancaires, pénalité,
-- délais, huissier, lien base légale — vivait en dur, éclaté entre
-- `invoiceService`, `wireBeneficiary.ts` et le service de relance. Un
-- changement de directeur ou d'IBAN demandait un déploiement, et les trois
-- sources divergeaient déjà : le PDF d'avril 2026 porte « Bank of Somaliland ·
-- SWIFT BSSLSO21 », les documents d'août portent le compte maltais.
--
-- MODÈLE
-- Une ligne par juridiction, plus UNE ligne de défaut (`jurisdiction_id IS
-- NULL`). La lecture applicative superpose : valeur de la juridiction si
-- renseignée, sinon celle du défaut. C'est la réponse du PO — « par défaut oui,
-- mais on peut les modifier ».
--
-- Les comptes bancaires sont un tableau JSONB ordonné, pas trois jeux de
-- colonnes : le document officiel en publie déjà trois (SEPA, hors-UE USD,
-- hors-UE EUR) et rien ne dit que la prochaine juridiction en aura le même
-- nombre.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.jurisdiction_issuer_profile (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- NULL = ligne de défaut plateforme. UNIQUE garantit une seule ligne par
    -- juridiction ; il ne protège PAS la ligne de défaut, deux NULL étant
    -- distincts pour un index unique — d'où l'index partiel plus bas.
    jurisdiction_id        UUID UNIQUE REFERENCES public.jurisdictions(id) ON DELETE CASCADE,

    -- ── Émetteur ────────────────────────────────────────────────────────────
    issuer_name            TEXT,        -- « SOLIDE TECHNOLOGY (Concessionaire) »
    issuer_legal_name      TEXT,        -- raison sociale portée sur le virement
    issuer_address         TEXT,
    sovereign_line         TEXT,        -- « Republic of Somaliland »
    supervising_ministry   TEXT,
    authority_line         TEXT,        -- « Maritime Carbon Tax Authority »
    decree_reference       TEXT,        -- visa imprimé sous l'en-tête

    -- ── Signataire ──────────────────────────────────────────────────────────
    director_name          TEXT,
    director_title         TEXT,
    director_email         TEXT,
    director_phone         TEXT,

    -- ── Correspondance ──────────────────────────────────────────────────────
    operations_email       TEXT,        -- contestations, preuves de paiement
    billing_email          TEXT,

    -- ── Conditions de règlement ─────────────────────────────────────────────
    payment_terms_days     INTEGER,     -- 45 sur les documents d'août 2026
    late_penalty_usd       NUMERIC(12,2),
    dispute_period_days    INTEGER,     -- jours ouvrés
    escalation_line        TEXT,        -- rampe J+15/30/45 imprimée en page 2
    bailiff_name           TEXT,
    legal_basis_url        TEXT,

    -- ── Comptes de collecte ─────────────────────────────────────────────────
    -- [{ label, currency, holder, holder_address, iban, account_number, swift,
    --    bank, bank_address, deposit_reference, is_primary }]
    -- `is_primary` désigne le compte imprimé sur la page 1 du pro-forma ; les
    -- autres n'apparaissent que sur le document de coordonnées bancaires.
    bank_accounts          JSONB NOT NULL DEFAULT '[]'::jsonb,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Une seule ligne de défaut, quelle que soit la version de Postgres : deux NULL
-- passeraient la contrainte UNIQUE ci-dessus, et la superposition applicative
-- deviendrait non déterministe.
CREATE UNIQUE INDEX IF NOT EXISTS idx_issuer_profile_single_default
    ON public.jurisdiction_issuer_profile ((jurisdiction_id IS NULL))
    WHERE jurisdiction_id IS NULL;

COMMENT ON TABLE public.jurisdiction_issuer_profile IS
  'mig 131 : coordonnées émetteur, comptes de collecte et paramètres de recouvrement imprimés sur les pro-formas. Une ligne par juridiction + une ligne de défaut (jurisdiction_id NULL) que l''applicatif superpose.';

CREATE TRIGGER jurisdiction_issuer_profile_updated_at
    BEFORE UPDATE ON public.jurisdiction_issuer_profile
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Lecture ouverte à tout compte authentifié : l'armateur voit ces coordonnées
-- sur son écran de paiement (le RIB) et sur son pro-forma. Rien de secret —
-- c'est un compte de collecte publié sur chaque facture.
-- Écriture réservée au SUPERADMIN et au FINANCE_ADMIN : changer l'IBAN imprimé
-- sur les factures est le geste le plus sensible de cette table.
ALTER TABLE public.jurisdiction_issuer_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS issuer_profile_read_authenticated ON public.jurisdiction_issuer_profile;
CREATE POLICY issuer_profile_read_authenticated
    ON public.jurisdiction_issuer_profile FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS issuer_profile_write_finance ON public.jurisdiction_issuer_profile;
CREATE POLICY issuer_profile_write_finance
    ON public.jurisdiction_issuer_profile FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
             WHERE id = auth.uid()
               AND is_active
               AND role IN ('SUPERADMIN'::public.user_role, 'FINANCE_ADMIN'::public.user_role)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
             WHERE id = auth.uid()
               AND is_active
               AND role IN ('SUPERADMIN'::public.user_role, 'FINANCE_ADMIN'::public.user_role)
        )
    );

-- ── Ligne de défaut ──────────────────────────────────────────────────────────
-- Valeurs relevées sur les documents officiels du 2026-08-19 :
--   docs/designs/PRO-2026-064001-MAYAR.pdf (pages 1 et 2)
--   docs/designs/Coordonnees_Bancaires_InstaPay_SolideTechnology.pdf
INSERT INTO public.jurisdiction_issuer_profile (
    jurisdiction_id, issuer_name, issuer_legal_name, issuer_address,
    sovereign_line, supervising_ministry, authority_line, decree_reference,
    director_name, director_title, director_email, director_phone,
    operations_email, billing_email,
    payment_terms_days, late_penalty_usd, dispute_period_days,
    escalation_line, bailiff_name, legal_basis_url, bank_accounts
)
SELECT
    NULL,
    'SOLIDE TECHNOLOGY (Concessionaire)',
    'SOLIDE TECHNOLOGY LIMITED',
    'Masalaha Street, M.Haybe District, Hargeisa, Somaliland',
    'Republic of Somaliland',
    'Ministry of Environment & Climate Change — Republic of Somaliland',
    'Maritime Carbon Tax Authority',
    'MOE&CC/MWI/36/2026 (Hargeisa, 31 March 2026)',
    'Noël KPATCHAVI',
    'Director, Solide Technology',
    'st.operations@greengate.africa',
    '+33 7 51 42 23 84',
    'st.operations@greengate.africa',
    'billing@greengate.africa',
    45,
    20000.00,
    10,
    'Reminder > formal notice (copy Direction) > bailiff Eidle Advocats + Antwerp Bar',
    'Eidle Advocats + Antwerp Bar',
    'https://greengate.africa/legal-basis',
    '[
      {
        "label": "Virement depuis la zone euro (SEPA / UE)",
        "currency": "USD",
        "holder": "Solide Technology Limited",
        "iban": "MT12SYPL39480821090981701607644",
        "account_number": "MT12SYPL39480821090981701607644",
        "swift": "SYPLMTM2XXX",
        "bank": "SYSTEM PAY SERVICES (MALTA) LIMITED",
        "bank_address": "Ruby Workspaces, 3 Triq Sant''Andrija, St. Julian''s, STJ 9023, Malta",
        "deposit_reference": null,
        "is_primary": true
      },
      {
        "label": "Virement hors UE — en USD",
        "currency": "USD",
        "holder": "SYSTEM PAY SERVICES MALTA LTD",
        "holder_address": "Ruby Workspaces Office 3, Pendergardens Triq Gort, San Giljan, STJ 9023, MT",
        "iban": null,
        "account_number": "ES9601828510912010000487",
        "swift": "BBVAESMMXXX",
        "bank": "Banco Bilbao Vizcaya Argentaria, S.A.",
        "bank_address": "Plaza De San Nicolas 4, Bilbao, 48005, ES",
        "deposit_reference": "REF PY9F4G3",
        "is_primary": false
      },
      {
        "label": "Virement hors UE — en EUR",
        "currency": "EUR",
        "holder": "System Pay Services (Malta) Limited",
        "holder_address": "Ruby Workspaces Office 3, Pendergardens Triq Gort, San Giljan, STJ 9023, MT",
        "iban": null,
        "account_number": "ES8201828510940200010371",
        "swift": "BBVAESMMXXX",
        "bank": "Banco Bilbao Vizcaya Argentaria, S.A.",
        "bank_address": "De San Nicolas 4, Bilbao, 48005, ES",
        "deposit_reference": "REF 6JL69V3",
        "is_primary": false
      }
    ]'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM public.jurisdiction_issuer_profile WHERE jurisdiction_id IS NULL
);
