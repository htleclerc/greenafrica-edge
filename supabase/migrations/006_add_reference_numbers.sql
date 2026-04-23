-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 006: Add human-readable reference numbers
-- Never expose UUIDs to end users — use ref columns instead
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Sequences ─────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS seq_transaction_ref START 1;
CREATE SEQUENCE IF NOT EXISTS seq_audit_ref START 1;
CREATE SEQUENCE IF NOT EXISTS seq_exemption_ref START 1;
CREATE SEQUENCE IF NOT EXISTS seq_registration_ref START 1;
CREATE SEQUENCE IF NOT EXISTS seq_project_ref START 1;
CREATE SEQUENCE IF NOT EXISTS seq_tax_config_ref START 1;

-- ── Generator function ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION generate_ref(
    prefix TEXT,
    seq_name TEXT,
    with_year BOOLEAN DEFAULT TRUE
) RETURNS TEXT AS $$
DECLARE
    next_val BIGINT;
    ref_text TEXT;
BEGIN
    EXECUTE format('SELECT nextval(%L)', seq_name) INTO next_val;
    IF with_year THEN
        ref_text := prefix || '-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' || LPAD(next_val::TEXT, 6, '0');
    ELSE
        ref_text := prefix || '-' || LPAD(next_val::TEXT, 6, '0');
    END IF;
    RETURN ref_text;
END;
$$ LANGUAGE plpgsql;

-- ── Add ref columns ───────────────────────────────────────────────────────────

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS ref TEXT UNIQUE;

ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS ref TEXT UNIQUE;

ALTER TABLE exemptions
    ADD COLUMN IF NOT EXISTS ref TEXT UNIQUE;

ALTER TABLE registration_requests
    ADD COLUMN IF NOT EXISTS ref TEXT UNIQUE;

ALTER TABLE carbon_projects
    ADD COLUMN IF NOT EXISTS ref TEXT UNIQUE;

ALTER TABLE tax_configurations
    ADD COLUMN IF NOT EXISTS ref TEXT UNIQUE;

-- ── Backfill existing rows (ordered by created_at) ────────────────────────────

-- Transactions → INV-YYYY-NNNNNN
UPDATE transactions SET ref = 'INV-' || EXTRACT(YEAR FROM created_at)::TEXT || '-' || LPAD(ROW_NUMBER::TEXT, 6, '0')
FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS row_number
    FROM transactions WHERE ref IS NULL
) sub
WHERE transactions.id = sub.id;

-- Audit logs → AUD-NNNNNN
UPDATE audit_logs SET ref = 'AUD-' || LPAD(ROW_NUMBER::TEXT, 6, '0')
FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS row_number
    FROM audit_logs WHERE ref IS NULL
) sub
WHERE audit_logs.id = sub.id;

-- Exemptions → EXM-YYYY-NNNNNN
UPDATE exemptions SET ref = 'EXM-' || EXTRACT(YEAR FROM created_at)::TEXT || '-' || LPAD(ROW_NUMBER::TEXT, 6, '0')
FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS row_number
    FROM exemptions WHERE ref IS NULL
) sub
WHERE exemptions.id = sub.id;

-- Registration requests → REG-YYYY-NNNNNN
UPDATE registration_requests SET ref = 'REG-' || EXTRACT(YEAR FROM created_at)::TEXT || '-' || LPAD(ROW_NUMBER::TEXT, 6, '0')
FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS row_number
    FROM registration_requests WHERE ref IS NULL
) sub
WHERE registration_requests.id = sub.id;

-- Carbon projects → PRJ-YYYY-NNNNNN
UPDATE carbon_projects SET ref = 'PRJ-' || EXTRACT(YEAR FROM created_at)::TEXT || '-' || LPAD(ROW_NUMBER::TEXT, 6, '0')
FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS row_number
    FROM carbon_projects WHERE ref IS NULL
) sub
WHERE carbon_projects.id = sub.id;

-- Tax configurations → TAX-NNNNNN
UPDATE tax_configurations SET ref = 'TAX-' || LPAD(ROW_NUMBER::TEXT, 6, '0')
FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS row_number
    FROM tax_configurations WHERE ref IS NULL
) sub
WHERE tax_configurations.id = sub.id;

-- ── Set sequences to max current value ────────────────────────────────────────
-- Note: Postgres sequences start at 1, so setval(seq, 0) errors. Use a helper
-- that passes `is_called=false` when the table is empty so nextval() returns 1,
-- and `is_called=true` when the table has rows so nextval() returns N+1.
DO $$
DECLARE c bigint;
BEGIN
    SELECT COUNT(*) INTO c FROM transactions;
    PERFORM setval('seq_transaction_ref', GREATEST(c, 1), c > 0);

    SELECT COUNT(*) INTO c FROM audit_logs;
    PERFORM setval('seq_audit_ref', GREATEST(c, 1), c > 0);

    SELECT COUNT(*) INTO c FROM exemptions;
    PERFORM setval('seq_exemption_ref', GREATEST(c, 1), c > 0);

    SELECT COUNT(*) INTO c FROM registration_requests;
    PERFORM setval('seq_registration_ref', GREATEST(c, 1), c > 0);

    SELECT COUNT(*) INTO c FROM carbon_projects;
    PERFORM setval('seq_project_ref', GREATEST(c, 1), c > 0);

    SELECT COUNT(*) INTO c FROM tax_configurations;
    PERFORM setval('seq_tax_config_ref', GREATEST(c, 1), c > 0);
END $$;

-- ── Triggers for auto-generating ref on INSERT ────────────────────────────────

CREATE OR REPLACE FUNCTION trg_set_transaction_ref() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.ref IS NULL THEN
        NEW.ref := generate_ref('INV', 'seq_transaction_ref', TRUE);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_set_audit_ref() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.ref IS NULL THEN
        NEW.ref := generate_ref('AUD', 'seq_audit_ref', FALSE);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_set_exemption_ref() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.ref IS NULL THEN
        NEW.ref := generate_ref('EXM', 'seq_exemption_ref', TRUE);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_set_registration_ref() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.ref IS NULL THEN
        NEW.ref := generate_ref('REG', 'seq_registration_ref', TRUE);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_set_project_ref() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.ref IS NULL THEN
        NEW.ref := generate_ref('PRJ', 'seq_project_ref', TRUE);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_set_tax_config_ref() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.ref IS NULL THEN
        NEW.ref := generate_ref('TAX', 'seq_tax_config_ref', FALSE);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
DROP TRIGGER IF EXISTS set_transaction_ref ON transactions;
CREATE TRIGGER set_transaction_ref BEFORE INSERT ON transactions
    FOR EACH ROW EXECUTE FUNCTION trg_set_transaction_ref();

DROP TRIGGER IF EXISTS set_audit_ref ON audit_logs;
CREATE TRIGGER set_audit_ref BEFORE INSERT ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION trg_set_audit_ref();

DROP TRIGGER IF EXISTS set_exemption_ref ON exemptions;
CREATE TRIGGER set_exemption_ref BEFORE INSERT ON exemptions
    FOR EACH ROW EXECUTE FUNCTION trg_set_exemption_ref();

DROP TRIGGER IF EXISTS set_registration_ref ON registration_requests;
CREATE TRIGGER set_registration_ref BEFORE INSERT ON registration_requests
    FOR EACH ROW EXECUTE FUNCTION trg_set_registration_ref();

DROP TRIGGER IF EXISTS set_project_ref ON carbon_projects;
CREATE TRIGGER set_project_ref BEFORE INSERT ON carbon_projects
    FOR EACH ROW EXECUTE FUNCTION trg_set_project_ref();

DROP TRIGGER IF EXISTS set_tax_config_ref ON tax_configurations;
CREATE TRIGGER set_tax_config_ref BEFORE INSERT ON tax_configurations
    FOR EACH ROW EXECUTE FUNCTION trg_set_tax_config_ref();

-- ── Indexes on ref columns ────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_transactions_ref ON transactions(ref);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ref ON audit_logs(ref);
CREATE INDEX IF NOT EXISTS idx_exemptions_ref ON exemptions(ref);
CREATE INDEX IF NOT EXISTS idx_registration_requests_ref ON registration_requests(ref);
CREATE INDEX IF NOT EXISTS idx_carbon_projects_ref ON carbon_projects(ref);
CREATE INDEX IF NOT EXISTS idx_tax_configurations_ref ON tax_configurations(ref);
