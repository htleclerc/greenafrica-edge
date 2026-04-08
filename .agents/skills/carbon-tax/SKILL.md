# Carbon Tax Domain Expert

## Trigger
When working on tax calculations, carbon emission factors, tax tiers, exemptions, revenue dashboards, or TCO (Total Cost of Ownership).

## Context
- Tax configuration: `SecureTaxConfig` interface in `frontend/src/types/secure/index.ts`
- TCO hook: `frontend/src/hooks/useTco.ts`
- TCO dashboard: `frontend/src/components/dashboard/tco/TcoDashboard.tsx`
- Mock data: `frontend/src/mock/datas/secureMock.ts` (mockTaxConfigs, mockTransactions)

## Core Formulas
- **Emissions** = fuel_consumed_tonnes * emission_factor (per VesselCategory)
- **Tax** = emissions_tonnes * rate_per_tonne (from tier matching in TaxConfig)
- **Revenue** = sum of all tax transactions in period
- **TCO** = operating_costs + tax_liability + compliance_costs

## Exemption Types
MILITARY, HUMANITARIAN, SCIENTIFIC, GOVERNMENT — must be validated before applying zero-rate.

## Rules
1. All tax rates MUST come from TaxConfig, never hardcoded numbers
2. Emission factors vary by VesselCategory enum — do not use a single factor
3. Exemptions must be validated before applying zero-rate
4. All monetary displays use `Intl.NumberFormat` with USD currency
5. Tax period calculations must handle partial periods correctly
6. Always show both gross and net (after exemptions) amounts
