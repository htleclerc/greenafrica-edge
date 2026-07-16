-- ============================================================
-- Green-Gate Platform — PostgreSQL Schema
-- Version: 1.0
-- Date: 2026-07-12
-- ============================================================

BEGIN;

-- ============================================================
-- TYPES ENUM
-- ============================================================
CREATE TYPE verification_status AS ENUM (
  'PENDING_LOOKUP', 'PENDING_VERIFICATION', 'VERIFIED', 'BLOCKED'
);

CREATE TYPE onboarding_stage AS ENUM (
  'IDENTIFICATION', 'PENDING_INVITE', 'INVITED', 'KYC', 'SIGNED',
  'ACTIVE', 'BLOCKED_OFAC', 'BLOCKED_UN', 'SUSPENDED', 'CASE_BY_CASE'
);

CREATE TYPE vessel_type AS ENUM (
  'BULK_CARRIER', 'CONTAINER_SHIP', 'GENERAL_CARGO', 'CHEMICAL_TANKER',
  'LIVESTOCK_CARRIER', 'OIL_TANKER', 'RO_RO', 'OTHER'
);

CREATE TYPE vessel_status AS ENUM (
  'ACTIVE', 'EXPECTED', 'SCRAPPED', 'RENAMED', 'INACTIVE'
);

CREATE TYPE fuel_type AS ENUM (
  'HFO', 'MDO', 'LNG', 'METHANOL', 'AMMONIA'
);

CREATE TYPE voyage_status AS ENUM (
  'EXPECTED', 'ARRIVED', 'AT_PORT', 'DEPARTED', 'CANCELLED'
);

CREATE TYPE proforma_type AS ENUM ('MARITIME', 'AVIATION');

CREATE TYPE payment_status AS ENUM (
  'DRAFT', 'PENDING', 'SENT', 'PARTIAL', 'PAID', 'OVERDUE', 'DISPUTED', 'WRITE_OFF'
);

CREATE TYPE send_method AS ENUM (
  'EMAIL', 'POSTAL', 'IN_REM', 'BAILIFF_NOTICE'
);

CREATE TYPE relance_tier AS ENUM (
  'J15', 'J30', 'J45', 'BAILIFF', 'JUDICIAL'
);

CREATE TYPE armateur_response_type AS ENUM (
  'SILENT', 'ACKNOWLEDGE', 'DISPUTE', 'PAYMENT_PROMISE',
  'PARTIAL_PAYMENT', 'PAID', 'REFUSED'
);

CREATE TYPE payment_method AS ENUM (
  'SWIFT', 'WIRE', 'CHECK', 'ASCR_TOKEN', 'CASH', 'OTHER'
);

-- ============================================================
-- ARMATEURS
-- ============================================================
CREATE TABLE armateurs (
  id                  TEXT PRIMARY KEY,
  nom_legal           TEXT NOT NULL,
  alias               TEXT[] DEFAULT '{}',
  pays_hq             VARCHAR(2),
  adresse_hq          TEXT,
  email_principal     TEXT UNIQUE,
  email_ops           TEXT,
  telephone           TEXT,
  is_ofac_sdn         BOOLEAN NOT NULL DEFAULT FALSE,
  is_un_prohibited    BOOLEAN NOT NULL DEFAULT FALSE,
  verification_status verification_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
  onboarding_stage    onboarding_stage NOT NULL DEFAULT 'PENDING_INVITE',
  equasis_id          TEXT,
  imo_manager_id      TEXT,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_armateurs_verif ON armateurs(verification_status);
CREATE INDEX idx_armateurs_stage ON armateurs(onboarding_stage);
CREATE INDEX idx_armateurs_pays ON armateurs(pays_hq);

-- ============================================================
-- COMPAGNIES AÉRIENNES
-- ============================================================
CREATE TABLE compagnies_aeriennes (
  id                  TEXT PRIMARY KEY,
  nom_legal           TEXT NOT NULL,
  iata_code           VARCHAR(3) UNIQUE,
  icao_code           VARCHAR(3) UNIQUE,
  hub_principal       VARCHAR(3) NOT NULL,
  pays_hq             VARCHAR(2),
  email_ops           TEXT,
  email_finance       TEXT,
  onboarding_stage    onboarding_stage NOT NULL DEFAULT 'PENDING_INVITE',
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_compagnies_stage ON compagnies_aeriennes(onboarding_stage);

-- ============================================================
-- NAVIRES
-- ============================================================
CREATE TABLE navires (
  id                  TEXT PRIMARY KEY,
  armateur_id         TEXT NOT NULL REFERENCES armateurs(id) ON DELETE RESTRICT,
  nom                 TEXT NOT NULL,
  imo                 VARCHAR(7) UNIQUE,
  mmsi                VARCHAR(9),
  pavillon            VARCHAR(2),
  type_navire         vessel_type NOT NULL,
  gt                  INTEGER NOT NULL,
  dwt                 INTEGER,
  annee_construction  INTEGER,
  status              vessel_status NOT NULL DEFAULT 'ACTIVE',
  previous_names      TEXT[] DEFAULT '{}',
  wave_tag            TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_navires_armateur ON navires(armateur_id);
CREATE INDEX idx_navires_imo ON navires(imo);
CREATE INDEX idx_navires_status ON navires(status);

-- ============================================================
-- VOYAGES
-- ============================================================
CREATE TABLE voyages (
  id                  TEXT PRIMARY KEY,
  navire_id           TEXT NOT NULL REFERENCES navires(id) ON DELETE RESTRICT,
  port_origine        TEXT NOT NULL,
  port_destination    TEXT NOT NULL DEFAULT 'Berbera',
  date_arrivee        DATE NOT NULL,
  date_depart         DATE,
  distance_nm         INTEGER NOT NULL,
  vitesse_kn          NUMERIC(5,2) NOT NULL,
  voyage_days         NUMERIC(6,2) NOT NULL,
  carburant_type      fuel_type NOT NULL DEFAULT 'HFO',
  fuel_consumed_t     NUMERIC(10,2) NOT NULL,
  co2_voyage_tco2     NUMERIC(10,2) NOT NULL,
  co2_facturable_tco2 NUMERIC(10,2) NOT NULL,
  contribution_usd    NUMERIC(10,2) NOT NULL,
  wave_tag            TEXT,
  status              voyage_status NOT NULL DEFAULT 'EXPECTED',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_voyages_navire ON voyages(navire_id);
CREATE INDEX idx_voyages_status ON voyages(status);
CREATE INDEX idx_voyages_wave ON voyages(wave_tag);
CREATE INDEX idx_voyages_arrivee ON voyages(date_arrivee);

-- ============================================================
-- PROFORMAS
-- ============================================================
CREATE TABLE proformas (
  id                    TEXT PRIMARY KEY,
  reference             TEXT UNIQUE NOT NULL,
  type                  proforma_type NOT NULL,
  armateur_id           TEXT REFERENCES armateurs(id),
  compagnie_id          TEXT REFERENCES compagnies_aeriennes(id),
  navire_id             TEXT REFERENCES navires(id),
  vol_details           JSONB,
  total_usd             NUMERIC(10,2) NOT NULL,
  total_paye_usd        NUMERIC(10,2) NOT NULL DEFAULT 0,
  outstanding_usd       NUMERIC(10,2) NOT NULL,
  date_emission         DATE NOT NULL,
  date_echeance         DATE NOT NULL,
  payment_status        payment_status NOT NULL DEFAULT 'DRAFT',
  pdf_url               TEXT,
  sent_at               TIMESTAMPTZ,
  sent_method           send_method,
  is_erratum            BOOLEAN NOT NULL DEFAULT FALSE,
  original_proforma_id  TEXT REFERENCES proformas(id),
  wave_tag              TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_proforma_owner CHECK (
    (type = 'MARITIME' AND armateur_id IS NOT NULL) OR
    (type = 'AVIATION' AND compagnie_id IS NOT NULL)
  )
);

CREATE INDEX idx_proformas_armateur ON proformas(armateur_id);
CREATE INDEX idx_proformas_compagnie ON proformas(compagnie_id);
CREATE INDEX idx_proformas_status ON proformas(payment_status);
CREATE INDEX idx_proformas_emission ON proformas(date_emission);
CREATE INDEX idx_proformas_echeance ON proformas(date_echeance);

-- Table many-to-many proforma <-> voyages
CREATE TABLE proforma_voyages (
  proforma_id  TEXT NOT NULL REFERENCES proformas(id) ON DELETE CASCADE,
  voyage_id    TEXT NOT NULL REFERENCES voyages(id) ON DELETE CASCADE,
  PRIMARY KEY (proforma_id, voyage_id)
);

-- ============================================================
-- RELANCES
-- ============================================================
CREATE TABLE relances (
  id                      TEXT PRIMARY KEY,
  proforma_id             TEXT NOT NULL REFERENCES proformas(id) ON DELETE CASCADE,
  tier                    relance_tier NOT NULL,
  sent_at                 TIMESTAMPTZ NOT NULL,
  sent_email              TEXT NOT NULL,
  cc_emails               TEXT[] DEFAULT '{}',
  template_used           TEXT NOT NULL,
  armateur_response_at    TIMESTAMPTZ,
  armateur_response_type  armateur_response_type NOT NULL DEFAULT 'SILENT',
  escalated_bailiff       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_relances_proforma ON relances(proforma_id);
CREATE INDEX idx_relances_tier ON relances(tier);

-- ============================================================
-- PAIEMENTS
-- ============================================================
CREATE TABLE paiements (
  id                    TEXT PRIMARY KEY,
  proforma_id           TEXT NOT NULL REFERENCES proformas(id) ON DELETE RESTRICT,
  montant_usd           NUMERIC(10,2) NOT NULL,
  date_recu             DATE NOT NULL,
  methode               payment_method NOT NULL,
  reference_bancaire    TEXT NOT NULL,
  banque_emettrice      TEXT,
  confirmation_pdf      TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_paiements_proforma ON paiements(proforma_id);
CREATE INDEX idx_paiements_date ON paiements(date_recu);

-- ============================================================
-- USERS + AUDIT LOG
-- ============================================================
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  nom         TEXT NOT NULL,
  role        TEXT NOT NULL,
  actif       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_log (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id),
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  action       TEXT NOT NULL,
  changes      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- ============================================================
-- TRIGGER updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_armateurs_updated BEFORE UPDATE ON armateurs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_compagnies_updated BEFORE UPDATE ON compagnies_aeriennes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_navires_updated BEFORE UPDATE ON navires
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_voyages_updated BEFORE UPDATE ON voyages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_proformas_updated BEFORE UPDATE ON proformas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
