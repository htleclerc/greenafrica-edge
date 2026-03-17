-- ─────────────────────────────────────────────────────────────────────────────
-- Africgreen — Seed Domain Data
-- Migration 005 : Insert vessels, transactions, tax configs, etc.
-- Uses the demo user UUIDs from seed.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Demo user UUIDs (from seed.sql):
-- Port Officer:    00000000-0000-0000-0000-000000000001
-- Finance Admin:   00000000-0000-0000-0000-000000000002
-- Shipping Agent:  00000000-0000-0000-0000-000000000003
-- Superadmin:      fc554074-e49a-4e01-9b2a-fa49596bddb4 (real UUID from Supabase Auth)

-- ── Vessels ─────────────────────────────────────────────────────────────────

INSERT INTO public.vessels (id, imo_number, mmsi, name, call_sign, flag_code, category, gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status, estimated_emissions_tco2, tax_liability_usd, port_call, pro_forma_generated, owner_id) VALUES
('10000000-0000-0000-0000-000000000001', '9348576', '356224000', 'MSC BERBERA', 'HCXA3', 'PA', 'CONTAINER', 42000, 48840, 24.0, 'PAYMENT_DUE', 215.40, 4250.00, 'BERBERA', false, '00000000-0000-0000-0000-000000000003'),
('10000000-0000-0000-0000-000000000002', '9284758', '219045000', 'MAERSK SEALAND', 'OXAG2', 'DK', 'CONTAINER', 65000, 68640, 25.0, 'COMPLIANT', 189.00, 0.00, 'BERBERA', true, '00000000-0000-0000-0000-000000000003'),
('10000000-0000-0000-0000-000000000003', '9451234', '228123456', 'CMA CGM AFRICA', 'FMJD5', 'FR', 'CARGO', 28000, 21600, 19.0, 'PROCESSING', 96.20, 1924.00, 'ZEILA', true, NULL),
('10000000-0000-0000-0000-000000000004', '9123456', '211234000', 'HAPAG-LLOYD JEDDAH', 'DBXK4', 'DE', 'CONTAINER', 52000, 57000, 23.0, 'COMPLIANT', 301.10, 0.00, 'BERBERA', true, NULL),
('10000000-0000-0000-0000-000000000005', '9876543', '477812300', 'COSCO SHANGHAI', 'BVJE1', 'CN', 'BULK_CARRIER', 85000, 14280, 14.0, 'COMPLIANT', 412.80, 0.00, 'BERBERA', true, NULL),
('10000000-0000-0000-0000-000000000006', '9554433', '241345000', 'OCEAN VOYAGER', 'SVFX2', 'GR', 'TANKER', 75000, 19620, 16.0, 'NON_COMPLIANT', 520.30, 6312.00, 'BERBERA', false, NULL);

-- ── Vessel Positions (latest snapshot) ──────────────────────────────────────

INSERT INTO public.vessel_positions (vessel_id, lat, lng, heading, speed_knots, zone, recorded_at) VALUES
('10000000-0000-0000-0000-000000000001', 11.500000, 45.100000, 245.0, 14.2, 'EEZ', '2025-03-09T10:42:00Z'),
('10000000-0000-0000-0000-000000000002', 11.220000, 44.800000, 110.0, 9.5, 'PORT_VICINITY', '2025-03-09T09:15:00Z'),
('10000000-0000-0000-0000-000000000003', 10.440000, 45.020000, 0.0, 0.5, 'PORT_VICINITY', '2025-03-09T08:30:00Z'),
('10000000-0000-0000-0000-000000000004', 12.100000, 46.500000, 320.0, 16.8, 'EEZ', '2025-03-08T22:00:00Z'),
('10000000-0000-0000-0000-000000000005', 11.800000, 43.900000, 80.0, 12.2, 'TRANSIT_LANE', '2025-03-08T21:00:00Z'),
('10000000-0000-0000-0000-000000000006', 12.800000, 47.100000, 200.0, 10.2, 'EEZ', '2025-03-09T07:00:00Z');

-- ── Transactions ────────────────────────────────────────────────────────────

INSERT INTO public.transactions (id, vessel_id, vessel_name, vessel_imo, transaction_type, emissions_tco2, tax_amount_usd, status, invoice_pdf_url, port_call, created_at, paid_at) VALUES
('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'MAERSK SEALAND', '9284758', 'ENTRY_TAX', 189.00, 3780.00, 'PAID', '/invoices/txn-001.pdf', 'BERBERA', '2025-03-09T08:00:00Z', '2025-03-09T08:15:00Z'),
('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', 'CMA CGM AFRICA', '9451234', 'PORT_STAY', 96.20, 1924.00, 'PENDING', NULL, 'ZEILA', '2025-03-09T08:30:00Z', NULL),
('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004', 'HAPAG-LLOYD JEDDAH', '9123456', 'TRANSIT_FEE', 301.10, 6022.00, 'PAID', '/invoices/txn-003.pdf', 'BERBERA', '2025-03-08T20:00:00Z', '2025-03-08T20:30:00Z'),
('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000005', 'COSCO SHANGHAI', '9876543', 'ENTRY_TAX', 412.80, 8256.00, 'PAID', '/invoices/txn-004.pdf', 'BERBERA', '2025-03-08T18:00:00Z', '2025-03-08T18:45:00Z'),
('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000006', 'OCEAN VOYAGER', '9554433', 'ENTRY_TAX', 520.30, 6312.00, 'OVERDUE', NULL, 'BERBERA', '2025-03-08T12:00:00Z', NULL);

-- Update vessels with last_transaction_id
UPDATE public.vessels SET last_transaction_id = '20000000-0000-0000-0000-000000000001' WHERE id = '10000000-0000-0000-0000-000000000002';
UPDATE public.vessels SET last_transaction_id = '20000000-0000-0000-0000-000000000002' WHERE id = '10000000-0000-0000-0000-000000000003';
UPDATE public.vessels SET last_transaction_id = '20000000-0000-0000-0000-000000000003' WHERE id = '10000000-0000-0000-0000-000000000004';
UPDATE public.vessels SET last_transaction_id = '20000000-0000-0000-0000-000000000004' WHERE id = '10000000-0000-0000-0000-000000000005';
UPDATE public.vessels SET last_transaction_id = '20000000-0000-0000-0000-000000000005' WHERE id = '10000000-0000-0000-0000-000000000006';

-- ── Tax Configurations ──────────────────────────────────────────────────────

INSERT INTO public.tax_configurations (id, jurisdiction_zone, vessel_category, base_rate_usd_per_tco2, multiplier, effective_date, status, created_by) VALUES
('30000000-0000-0000-0000-000000000001', 'EEZ', 'CONTAINER', 20.00, 1.20, '2025-01-01', 'ACTIVE', '00000000-0000-0000-0000-000000000002'),
('30000000-0000-0000-0000-000000000002', 'EEZ', 'CARGO', 18.00, 1.00, '2025-01-01', 'ACTIVE', '00000000-0000-0000-0000-000000000002'),
('30000000-0000-0000-0000-000000000003', 'EEZ', 'TANKER', 22.00, 1.30, '2025-01-01', 'ACTIVE', '00000000-0000-0000-0000-000000000002'),
('30000000-0000-0000-0000-000000000004', 'PORT_VICINITY', 'BULK_CARRIER', 15.00, 1.00, '2025-01-01', 'ACTIVE', '00000000-0000-0000-0000-000000000002'),
('30000000-0000-0000-0000-000000000005', 'PORT_VICINITY', 'FERRY', 12.00, 0.80, '2025-01-01', 'DRAFT', '00000000-0000-0000-0000-000000000002');

-- ── Exemptions ──────────────────────────────────────────────────────────────
-- Using external vessel references (not in vessels table — military/humanitarian)

-- We need placeholder vessels for exemptions, or we store them differently.
-- For now, insert placeholder vessels for exempted ships.

INSERT INTO public.vessels (id, imo_number, mmsi, name, call_sign, flag_code, category, gross_tonnage_dwt, engine_power_kw, design_speed_knots, compliance_status) VALUES
('10000000-0000-0000-0000-000000000101', '0000001', '000000001', 'USS Missouri', 'NAVY1', 'US', 'NAVAL', 45000, 75000, 30.0, 'EXEMPT'),
('10000000-0000-0000-0000-000000000102', '0000002', '000000002', 'WFP Coral Vessel', 'WFP01', 'UN', 'CARGO', 12000, 8000, 14.0, 'EXEMPT');

INSERT INTO public.exemptions (vessel_id, vessel_name, reason, valid_until, approved_by, notes, created_at) VALUES
('10000000-0000-0000-0000-000000000101', 'USS Missouri', 'MILITARY', '2025-12-31', '00000000-0000-0000-0000-000000000002', 'US Navy transit — bilateral agreement.', '2025-01-15T10:00:00Z'),
('10000000-0000-0000-0000-000000000102', 'WFP Coral Vessel', 'HUMANITARIAN', '2025-06-30', '00000000-0000-0000-0000-000000000001', 'World Food Programme — food aid delivery.', '2025-02-01T08:30:00Z');

-- ── Audit Logs ──────────────────────────────────────────────────────────────

INSERT INTO public.audit_logs (user_id, user_full_name, action, severity, entity_type, entity_id, details_json, ip_address, created_at) VALUES
('00000000-0000-0000-0000-000000000001', 'Officer Hassan', 'LOGIN', 'INFO', 'Session', 'sess-001', '{"method":"password","mfa":false,"userAgent":"Chrome/122 Linux"}', '197.231.44.12', '2025-03-09T06:42:11Z'),
('00000000-0000-0000-0000-000000000001', 'Officer Hassan', 'INVOICE_GENERATED', 'INFO', 'Transaction', 'txn-002', '{"vesselName":"CMA CGM AFRICA","amount":1924,"portCall":"ZEILA"}', '197.231.44.12', '2025-03-09T08:31:00Z'),
('fc554074-e49a-4e01-9b2a-fa49596bddb4', 'Min. Al-Farid Ibrahim', 'TAX_RATE_UPDATED', 'WARNING', 'TaxConfiguration', 'tax-001', '{"vesselCategory":"CONTAINER","oldRate":18,"newRate":20,"zone":"EEZ"}', '41.223.10.5', '2025-03-09T07:15:00Z'),
('00000000-0000-0000-0000-000000000001', 'Officer Hassan', 'VESSEL_VIEWED', 'INFO', 'Vessel', 'vsec-006', '{"vesselName":"OCEAN VOYAGER","imoNumber":"9554433","flagCode":"GR"}', '197.231.44.12', '2025-03-09T09:05:00Z'),
('fc554074-e49a-4e01-9b2a-fa49596bddb4', 'Min. Al-Farid Ibrahim', 'EXEMPTION_GRANTED', 'CRITICAL', 'Exemption', 'exc-001', '{"vesselName":"USS Missouri","reason":"MILITARY","validUntil":"2025-12-31"}', '41.223.10.5', '2025-03-09T07:45:00Z'),
('00000000-0000-0000-0000-000000000001', 'Officer Hassan', 'REPORT_EXPORTED', 'WARNING', 'Report', 'rpt-mar-2025', '{"reportType":"Monthly Revenue","period":"March 2025","format":"PDF","recordCount":842}', '197.231.44.12', '2025-03-09T10:12:00Z'),
('00000000-0000-0000-0000-000000000002', 'Adm. Fadumo Yusuf', 'USER_CREATED', 'CRITICAL', 'User', 'usr-004', '{"newUserEmail":"agent.ibrahim@berbera.port","role":"PORT_OFFICER","site":"BERBERA_PORT"}', '41.223.10.9', '2025-03-08T14:20:00Z'),
('00000000-0000-0000-0000-000000000001', 'Officer Hassan', 'TRANSACTION_UPDATED', 'WARNING', 'Transaction', 'txn-005', '{"vesselName":"OCEAN VOYAGER","oldStatus":"PENDING","newStatus":"OVERDUE","daysOverdue":1}', '197.231.44.12', '2025-03-09T09:55:00Z'),
('fc554074-e49a-4e01-9b2a-fa49596bddb4', 'Min. Al-Farid Ibrahim', 'LOGIN', 'INFO', 'Session', 'sess-002', '{"method":"password","mfa":true,"userAgent":"Firefox/124 Windows"}', '41.223.10.5', '2025-03-09T07:00:00Z'),
('00000000-0000-0000-0000-000000000001', 'Officer Hassan', 'INVOICE_GENERATED', 'INFO', 'Transaction', 'txn-001', '{"vesselName":"MAERSK SEALAND","amount":3780,"portCall":"BERBERA"}', '197.231.44.12', '2025-03-09T08:05:00Z'),
('00000000-0000-0000-0000-000000000002', 'Adm. Fadumo Yusuf', 'LOGOUT', 'INFO', 'Session', 'sess-003', '{"sessionDurationMin":45}', '41.223.10.9', '2025-03-08T15:05:00Z'),
('fc554074-e49a-4e01-9b2a-fa49596bddb4', 'Min. Al-Farid Ibrahim', 'TAX_RATE_UPDATED', 'CRITICAL', 'TaxConfiguration', 'tax-003', '{"vesselCategory":"TANKER","oldRate":20,"newRate":22,"zone":"EEZ","requiresMinisterialApproval":true}', '41.223.10.5', '2025-03-08T16:30:00Z');

-- ── Carbon Projects ─────────────────────────────────────────────────────────

INSERT INTO public.carbon_projects (id, name, description, type, status, operator_name, operator_id, location_name, location_lat, location_lng, area_hectares, start_date, end_date, verification_standard, estimated_tco2_per_year, credits_issued_total, credits_retired_total, credits_available, price_per_credit_usd, total_value_usd, last_verified_at, next_verification_at, funding_usd, sdg_goals) VALUES
('40000000-0000-0000-0000-000000000001', 'Berbera Coastal Mangrove Restoration', 'Large-scale restoration of degraded mangrove ecosystems along the Gulf of Aden coastline, sequestering blue carbon and protecting marine biodiversity.', 'BLUE_CARBON', 'ACTIVE', 'Somaliland Environmental Authority', 'org-001', 'Berbera Coast, Somaliland', 10.420000, 45.010000, 4200.0, '2023-06-01', NULL, 'VERRA_VCS', 18500.00, 32400.00, 21200.00, 11200.00, 28.00, 907200.00, '2024-11-15', '2025-11-15', 2400000.00, '{13,14,15}'),
('40000000-0000-0000-0000-000000000002', 'Sahel Reforestation Initiative — Phase 2', 'Community-led reforestation of 6,000 ha of degraded savannah in eastern Somaliland, combining native acacia and fruit tree species.', 'REFORESTATION', 'ACTIVE', 'GreenSahel NGO', 'org-002', 'Sanaag Region, Somaliland', 10.950000, 47.630000, 6000.0, '2022-03-15', NULL, 'GOLD_STANDARD', 12000.00, 28000.00, 18800.00, 9200.00, 22.00, 616000.00, '2024-09-20', '2025-09-20', 1800000.00, '{1,13,15}'),
('40000000-0000-0000-0000-000000000003', 'Gulf of Aden Blue Carbon Seagrass', 'Conservation and rewilding of seagrass meadows in the Gulf of Aden, acting as critical blue carbon sinks and fish nurseries.', 'BLUE_CARBON', 'UNDER_REVIEW', 'Ocean Conservation Fund', 'org-003', 'Gulf of Aden — Zeila EEZ', 11.350000, 43.480000, 2800.0, '2024-01-01', NULL, 'PENDING_VERIFICATION', 9800.00, 0.00, 0.00, 0.00, 32.00, 0.00, NULL, '2025-06-01', 950000.00, '{14,13}'),
('40000000-0000-0000-0000-000000000004', 'Berbera Port Solar Micro-Grid', 'Installation of 2.4 MW rooftop solar panels across Berbera Port facilities, displacing diesel generators and cutting port emissions by 40%.', 'SOLAR', 'ACTIVE', 'AfricGreen Energy Solutions', 'org-004', 'Berbera Port Industrial Zone', 10.430000, 45.020000, 18.0, '2024-04-01', NULL, 'IMO_DCS', 4200.00, 3800.00, 3800.00, 0.00, 18.00, 68400.00, '2025-01-10', '2026-01-10', 3100000.00, '{7,13,9}'),
('40000000-0000-0000-0000-000000000005', 'Livestock Methane Capture — Togdheer', 'Biodigester deployment across 120 pastoral communities in Togdheer to capture methane from livestock waste and produce clean cooking fuel.', 'METHANE_CAPTURE', 'PENDING', 'Rural Climate Initiative', 'org-005', 'Togdheer Region', 9.950000, 45.300000, 0.0, '2025-07-01', NULL, 'GOLD_STANDARD', 6500.00, 0.00, 0.00, 0.00, 25.00, 0.00, NULL, NULL, 720000.00, '{2,7,13}'),
('40000000-0000-0000-0000-000000000006', 'Hargeisa Wind Farm — Phase 1', '12 MW wind farm on the Ogo plateau supplying clean energy to Hargeisa grid and generating verified carbon credits under Verra VCS.', 'WIND', 'COMPLETED', 'Horn of Africa Wind Power Ltd.', 'org-006', 'Ogo Plateau, Somaliland', 9.570000, 44.070000, 340.0, '2020-01-01', '2024-12-31', 'VERRA_VCS', 15200.00, 68400.00, 68400.00, 0.00, 20.00, 1368000.00, '2025-01-05', NULL, 8500000.00, '{7,8,13}');
