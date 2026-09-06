-- ============================================================================
-- 150 — Compte de collecte LOCAL (Premier Bank, Hargeisa)
-- ============================================================================
--
-- Le profil emetteur porte deja trois comptes (mig 131), tous a l'etranger :
-- Malte pour la zone euro, Espagne pour le hors-UE. Un armateur qui banque au
-- Somaliland payait donc un virement international pour regler une taxe
-- percue sur place — frais, delais, et un taux de rejet que le service
-- financier constatait sans pouvoir l'eviter.
--
-- Ce compte local est AJOUTE, pas substitue : le choix revient au payeur, qui
-- seul sait ou il banque. `is_primary` reste sur le compte maltais — changer
-- le defaut casserait les instructions deja remises aux armateurs etrangers.
--
-- Idempotent : reexecutable sans dupliquer la ligne, la presence est testee
-- sur le SWIFT du compte.
-- ============================================================================

UPDATE public.jurisdiction_issuer_profile
SET bank_accounts = bank_accounts || '[
  {
    "label": "Virement local (Somaliland) — en USD",
    "currency": "USD",
    "holder": "SOLIDE TECHNOLOGY",
    "holder_address": "Masalaha Street, M. Haybe District, Hargeisa, Somaliland",
    "iban": "SO950005100100613310001",
    "account_number": "100613310001",
    "swift": "PBSMSOSM",
    "bank": "Premier Bank Limited — Durdur Branch",
    "bank_address": "Hargeisa, Somaliland",
    "intermediary_bank": "Premier Bank Kenya Limited, Nairobi",
    "intermediary_swift": "IFCBKENA",
    "deposit_reference": null,
    "is_primary": false
  }
]'::jsonb
WHERE jurisdiction_id IS NULL
  AND NOT (bank_accounts @> '[{"swift": "PBSMSOSM"}]'::jsonb);

COMMENT ON COLUMN public.jurisdiction_issuer_profile.bank_accounts IS
  'Comptes de collecte, ordonnes pour affichage. `label` dit au payeur lequel '
  'le concerne (zone euro, hors-UE, local). `is_primary` ne designe qu''un '
  'defaut d''affichage : depuis la mig 150 le payeur choisit. '
  '`intermediary_bank` / `intermediary_swift` sont facultatifs et ne '
  'concernent que les comptes exigeant une banque correspondante.';
