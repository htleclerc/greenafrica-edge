# AfricGreen Comprehensive Requirements & Economic Model Document

## EXECUTIVE SUMMARY

**Platform Name:** AfricGreen (Sovereign Ecological Governance Platform - AIS Portal)
**Target:** African coastal governments (Somaliland, Djibouti, Gabon priority markets)
**Core Mission:** Automated carbon tax collection on maritime traffic + sovereign green credit registry
**Development Timeline:** MVP (6-8 weeks), V1 (3-6 months), Full Platform (24-36 months)
**Model:** Revenue-sharing partnership (No upfront public investment required)

---

## 1. EXACT FUNCTIONALITIES DESCRIBED

### 1.1 Current Version Scope (MVP - AfricGreen AIS Portal V2.2)

#### Module 1: Command Center Maritime (Surveillance Opérationnelle)
- **Real-time Maritime Tracking ("The Eye")**
  - Geospatial radar powered by satellite AIS data
  - Fleet tracking across multiple African EEZ zones
  - Live vessel positions updated continuously
  
- **Fleet Compliance Status Dashboard**
  - Real-time statuses: `PAYMENT_DUE`, `COMPLIANT`, `PROCESSING`, `OVERDUE`
  - Visual classification by payment status with color coding
  - Vessel entry/exit notifications
  
- **Immediate Actions System**
  - AI-based identification of "Dark Fleet" vessels (off-grid operations)
  - Pro-forma invoice execution system
  - Electronic port clearance blocking capability

**Target Users:** Port Authority Officers, Coast Guard, Customs Officers
**UI Design:** Dark theme, high-performance real-time focus

#### Module 2: Tax Management & Configuration
- **Configurable Fiscal Engine**
  - Parameterized carbon tariff ($/TCO2e) down to the finest detail
  - Segmentation by vessel category: Container vs Cargo vs Tanker vs Ferry
  - Jurisdiction zone segmentation: ZEE (Exclusive Economic Zone) vs Port Vicinity
  - Multiplier-based system (e.g., 1.2x for certain vessel types)

- **Exemption Management**
  - Waivers for military fleets
  - Scientific research exemptions
  - Humanitarian/UN operations exemptions
  - Form-based application and approval workflow

- **Auditable Transaction Logs**
  - Multiple sub-account tracking: Entry Tax, Transit Fee, Port Stay
  - Complete export capabilities (CSV, PDF)
  - Compliance audit trail

**Target Users:** Finance Ministry, Administrative Officials
**UI Design:** Analytical, structured, B2G configuration interface

#### Module 3: Green Projects & Carbon Registry (Green Ledger)
- **Sovereign Access & Audit Trail**
  - Government SSO authentication
  - Magic Link for secure access
  - Immutable audit logs for every document validation
  
- **Project Certification Workflow**
  - Pre-submission → Validation → Approval → Credit Transfer pipeline
  - Document upload capabilities (PDD, Land Tenure, EIA)
  - External auditor assignment (e.g., SGS, Verra, Gold Standard)

- **Universal Emissions Calculator**
  - Direct purchase portal for carbon offsets
  - For maritime actors and terrestrial operators
  - Scope 1 emissions tracking
  - Integration with international certification standards

**Target Users:** Government agencies, Scope 1 operators, Third-party auditors
**UI Design:** Institutional, clear, trust-focused, public-facing

### 1.2 Out of MVP Scope (Phase 2+ Features)
- Green Ledger / Carbon Registry (workflow certification)
- Carbon Credits Marketplace
- Real AI-based Dark Fleet detection (satellite model training)
- Real payment integration (Stripe, Flutterwave, SWIFT)
- Multi-country protocol implementation
- Real satellite AIS API integration
- Real-time WebSocket notifications
- Advanced government reporting modules (BI exports)

---

## 2. ECONOMIC MODEL DETAILS

### 2.1 Revenue Generation Mechanisms

**Two Complementary Levers:**

1. **Carbon Tax Lever (Primary - Phase 1)**
   - Direct contribution levied on maritime emissions
   - Forfeitable contribution allocated to National Climate Fund
   - Finances: green infrastructure, coastal resilience, port modernization
   
2. **Carbon Credit Lever (Secondary - Phase 2-3)**
   - Compensation mechanism for operators
   - Funds local emission reduction projects (reforestation, mangrove protection, renewable energy)
   - International marketable credits (Verra, Gold Standard compatible)

### 2.2 Financial Partnership Model (Affiliation Structure)

**No Upfront Government Investment**

The AfricGreen model is designed to be budget-neutral for governments:

#### Component 1: Retainer Fee
- **Amount:** {XX} million USD (single payment at signature)
- **Coverage:** 
  - Technical team mobilization
  - Initial AIS portal deployment
  - First environmental audits
  - Technology transfer preparation

#### Component 2: Revenue Share (Royalty)
- **Rate:** {XX}% of net revenue collected by the State
- **Applies to:** 
  - Carbon tax revenue (maritime contribution)
  - Carbon credit pre-sales
  - Registered offset transactions

**Alignment Incentive:** More state revenue = More AfricGreen income = Mutual success

### 2.3 Revenue Projections & Timeline

#### Phase 1 (Months 0-6): Initial Capture
- **Model:** Forfait-based tariff (simple capacity-based)
- **Tariff Examples:**
  - 1-2 USD per container (for container vessels)
  - 0.20 USD per ton exported (for cargo)
- **Expected Timeline:** First revenues by Month 4
- **Expected Coverage:** Portal deployment costs recovered by end of M6
- **Estimated Revenue:** Initial pilot generation phase

#### Phase 2 (Months 6-18): Consolidation & Credit Launch
- **Additions:** Green credit issuance, international partnerships
- **Revenue Streams:** 
  - Continuing carbon tax
  - Carbon credit pre-sales to mining companies
  - Carbon credit pre-sales to shipowners
- **Estimated Revenue Range:** 30-50M USD (depending on traffic)
- **Ratio:** 60-70% tax revenue, 30-40% credit revenue

#### Phase 3 (Months 18-36): Industrialization & Hybrid Model
- **Model Shift:** 70% tax-based, 30% credits-based
- **Expansion:** Air traffic + petroleum terminal emissions included
- **Status:** Fully automated, internationally credible, sustainable

#### Phase 4 (Year 5+): Technology Transfer
- **Model:** Progressive transfer of competencies and royalties to State
- **End Goal:** Sovereign operation with AfricGreen as technology partner

### 2.4 Competitive Positioning Strategy

**Risk Management Principle:** Balance tax collection with port competitiveness

- **Essential Traffic** (mining exports, strategic terminals): Standard rate
- **Substitute Traffic** (transit, optional ports): Potentially discounted or flexible
- **Tier-based tariff:** Avoid vessel diversion to competitor ports

**Target Markets (Priority Order):**
1. Somaliland (Port of Berbera) - Strategic first deployment
2. Djibouti - Regional shipping hub
3. Gabon - Established green governance commitment

---

## 3. REVENUE PROJECTIONS & FORMULAS

### 3.1 Basic Calculation Formula

```
Total Revenue = Sum of (Vessel Contribution Rate × Vessel Category Multiplier)

Where:
- Vessel Contribution = (Estimated CO2 Emissions × Carbon Tax Rate USD/TCO2e)
  OR (Flat Rate × Vessel Capacity × Days in Zone)
- Carbon Tax Rate = Configurable per jurisdiction/category (e.g., $50/TCO2e)
- Multiplier = Category adjustment (Container = 1.0, Tanker = 1.2, Cargo = 0.9)
```

### 3.2 MVP (Forfait-based, Simplified)

**Daily Emission Estimates by Vessel Category:**
- Container Vessel (Medium): 150 tonnes CO2/day of navigation
- General Cargo (Small): 45 tonnes CO2/day of navigation
- Tanker (Large): 200+ tonnes CO2/day of navigation

**Example Calculation:**
```
Vessel: Medium Container Ship
Days in ZEE: 4 days
Carbon Tax Rate: $50/TCO2e
Emissions Estimate: 150 tonnes/day × 4 days = 600 tonnes CO2
Revenue: 600 tonnes × $50 = $30,000 USD
```

### 3.3 Phase 2+ (Algorithmic OMI Cubic Law)

See Section 5 for detailed emission calculation algorithm.

---

## 4. TAX RATE STRUCTURES

### 4.1 Configurable Parameters

**Base Structure:**
- **Jurisdiction Zone Segments:**
  - ZEE (Exclusive Economic Zone): Base rate
  - Port Vicinity (0-12 nautical miles): 1.5x multiplier
  - International Waters (outside): 0x (not applicable)

- **Vessel Category Segments:**
  - Container Vessels: 1.0x multiplier (baseline)
  - General Cargo: 0.9x (lower emissions)
  - Bulk Carriers: 1.1x
  - Tankers: 1.2x (highest emissions)
  - Ferries: 0.8x (passenger vessels)
  - Fishing Vessels: 0.5x (lower capacity)

### 4.2 Exemption Categories

1. **Military Fleets:** Full exemption via government authorization
2. **Humanitarian Operations:** UN, ICRC, NGO operations - typically full/partial exemption
3. **Scientific Research:** Oceanographic, environmental survey vessels - conditional exemption
4. **Domestic Fishing Vessels:** National flag vessels under certain tonnage threshold

### 4.3 Tariff Examples (Illustrative)

**Scenario A: Standard Commercial Vessel**
- Base Rate: $50 per TCO2e
- Vessel Category: Container (1.0x)
- Zone: ZEE (1.0x)
- **Effective Rate: $50/TCO2e**

**Scenario B: Large Tanker in Port Vicinity**
- Base Rate: $50 per TCO2e
- Vessel Category: Tanker (1.2x)
- Zone: Port Vicinity (1.5x)
- **Effective Rate: $50 × 1.2 × 1.5 = $90/TCO2e**

---

## 5. VESSEL CATEGORIES & EMISSION DATA

### 5.1 Vessel Classification System

| Category | Examples | Tonnage Range | Annual CO2/day (Approx) | Annual CO2 (estimated) |
|---|---|---|---|---|
| Container Vessel | Maersk, MSC | 10,000-20,000 TEU | 100-150 TCO2 | 36,500-54,750 TCO2 |
| General Cargo | Various multipurpose | 5,000-15,000 tonnes | 40-60 TCO2 | 14,600-21,900 TCO2 |
| Bulk Carrier | Iron ore, grain | 50,000-180,000 tonnes | 40-100 TCO2 | 14,600-36,500 TCO2 |
| Tanker | Crude/product | 30,000-300,000 tonnes | 100-250+ TCO2 | 36,500-91,250+ TCO2 |
| RoRo/Car Carrier | Vehicle transport | 5,000-15,000 tonnes | 60-80 TCO2 | 21,900-29,200 TCO2 |
| Ferry | Passenger | 2,000-50,000 tonnes | 20-80 TCO2 | 7,300-29,200 TCO2 |
| Fishing Vessel | Commercial fishing | 100-5,000 tonnes | 5-15 TCO2 | 1,825-5,475 TCO2 |

### 5.2 Emission Calculation Methodologies

#### MVP Approach (Forfait/Capacity-based)

Simple daily rate based on vessel category, regardless of actual route complexity.

**Implementation:**
- Create lookup table of vessel categories
- Assign daily emission rate to each category
- Multiply by number of days in ZEE
- Apply jurisdiction × category multiplier

#### Phase 3 Approach (OMI Cubic Law - See Section 5)

Detailed algorithmic calculation using:
- Main engine power (kW)
- Design speed (knots)
- Current actual speed (from AIS)
- Time delta between AIS pings
- SFOC (Specific Fuel Oil Consumption)
- Fuel type carbon factor

---

## 6. EMISSION CALCULATION ALGORITHM (OMI CUBIC LAW)

### 6.1 Mathematical Model

**Formula for CO2 emissions per segment:**

```
E_CO2 = P_utilisée × SFOC × Δt × C_F

Where:
- E_CO2: CO2 emissions (tonnes) for this segment
- P_utilisée: Actual power used (kW) - calculated via cubic law
- SFOC: Specific Fuel Oil Consumption (g/kWh) 
- Δt: Time elapsed between AIS pings (hours)
- C_F: Carbon conversion factor (tonnes CO2 per tonne fuel)
```

### 6.2 Cubic Law Power Calculation

**Non-linear power requirement based on vessel speed:**

```
P_utilisée = P_max × (V_actuelle / V_design)³

Where:
- P_max: Maximum engine power (kW) - from vessel specifications
- V_actuelle: Current actual speed (knots) - from AIS data
- V_design: Design speed at full power (knots) - from vessel specifications
```

**Special Case - Vessel at Anchor/Very Low Speed:**
- If V_actuelle < 1 knot: P_utilisée = P_max × 0.05 (only auxiliary generators running)

### 6.3 Standard Consumption & Conversion Factors

**SFOC (Specific Fuel Oil Consumption):**
- Standard range: 175-195 g/kWh
- Typical value for large slow-speed engines: 185 g/kWh
- Can be adjusted by vessel age/engine type

**Carbon Conversion Factors (C_F):**
| Fuel Type | Tonnes CO2 per Tonne Fuel | Usage |
|---|---|---|
| HFO (Heavy Fuel Oil) | 3.114 | Majority of cargo vessels |
| MDO/MGO (Marine Diesel/Gas Oil) | 3.206 | Smaller vessels, regulated waters |
| LNG (Liquified Natural Gas) | 2.750 | Modern, eco-friendly vessels |

### 6.4 Implementation Algorithm (Python Pseudocode)

```python
CF_HFO = 3.114  # tonnes CO2 / tonne fuel
SFOC = 185      # g/kWh (typical)

def calculate_emissions_trajectory(ais_history, vessel_profile):
    """
    Calculate total CO2 emissions for vessel passage through ZEE
    
    Args:
        ais_history: List of AIS position reports with timestamps and speeds
        vessel_profile: Dict with engine_power_kw, design_speed_knots, gross_tonnage
    
    Returns:
        total_emissions_co2: Tonnes CO2 for entire transit
    """
    total_emissions = 0.0
    
    P_max = vessel_profile['engine_power_kw']
    V_design = vessel_profile['design_speed_knots']
    
    for i in range(1, len(ais_history)):
        point_A = ais_history[i-1]
        point_B = ais_history[i]
        
        # Calculate time delta in hours
        delta_t = (point_B.timestamp - point_A.timestamp).total_seconds() / 3600.0
        
        # Get current speed from AIS
        V_current = point_B.speed_knots
        
        # Calculate power requirement using cubic law
        if V_current < 1.0:
            P_used = P_max * 0.05  # Auxiliary only
        else:
            ratio = min(V_current / V_design, 1.0)  # Cap at 100%
            P_used = P_max * (ratio ** 3)
        
        # Calculate fuel consumed (tonnes)
        fuel_consumed = (P_used * SFOC * delta_t) / 1_000_000  # Convert g to tonnes
        
        # Convert to CO2
        co2_segment = fuel_consumed * CF_HFO
        
        total_emissions += co2_segment
    
    return total_emissions

# Example usage:
# emissions = calculate_emissions_trajectory(vessel_ais_points, 
#     {'engine_power_kw': 42000, 'design_speed_knots': 20, 'gross_tonnage': 195000})
# tax_amount = emissions * CARBON_TAX_RATE_USD
```

### 6.5 MVP Fallback Recommendation

**Do NOT block Phase 1 launch if exact engine specs unavailable.**

Use forfait table until Phase 3:
- Medium Container Ship = 150 tonnes CO2/day
- Small Bulk Carrier = 45 tonnes CO2/day
- Tanker = 200+ tonnes CO2/day

Transition to OMI algorithm in Phase 3 when:
- Vessel registry database complete
- IMO ship specifications available
- Accuracy requirements mandate it

---

## 7. LEGAL & REGULATORY REFERENCES

### 7.1 International Legal Framework

**References Cited in Governance:**

1. **IMO (International Maritime Organization) Standards**
   - Cubic Law methodology for emission calculation
   - SFOC (Specific Fuel Oil Consumption) standards
   - Carbon factor specifications per fuel type

2. **International Certification Standards**
   - **Verra (VCS):** Voluntary Carbon Standard for carbon credits
   - **Gold Standard:** For high-impact climate projects
   - **SGS/Bureau Veritas/DNV:** Third-party auditor networks

3. **National Legal Instruments (Examples)**
   - **Gabon:** Decree #0054/PR/MECCHF (16 January 2025) - Maritime carbon contribution
   - **Djibouti:** Maritime and air traffic carbon levy effective 2025

### 7.2 Regulatory Governance Model

**Jurisdiction Hierarchy:**

1. **National Sovereign Level**
   - Government owns all tariff decisions
   - Ministry of Finance controls tax rate parameterization
   - Ministry of Environment validates green credit standards

2. **International Interoperability**
   - Credits must meet international standards (Verra/Gold Standard)
   - Multi-country protocol layer for vessel tracking across borders
   - Dispute resolution via signed MoU protocols

3. **Data Sovereignty**
   - All vessel and emission data remains under government control
   - AfricGreen operates as technology service provider only
   - Government retains right to audit and override all calculations

### 7.3 MoU (Memorandum of Understanding) Components

**Standard MoU Definition Points:**

- Revenue share allocation and payment terms
- Scope of technology transfer timeline
- Tax rate setting authority and procedures
- Multi-country protocol participation terms
- Technology audit and upgrade schedules
- Exit clause and transition procedures

---

## 8. ROLES & RESPONSIBILITIES MATRIX

### 8.1 User Role Definitions

| Role | Description | Primary Modules | Capabilities |
|---|---|---|---|
| **PUBLIC** | External visitor, no authentication | Public Portal, Simulator | View public info, run simulation calculator |
| **PORT_OFFICER** | Port/Coast Guard officer | Command Center, Vessel Details | View vessel list, see compliance status, print pro-forma invoices |
| **FINANCE_ADMIN** | Ministry of Finance official | Tax Management, Transaction Logs | Configure tax rates, view revenue dashboards, manage exemptions |
| **SUPERADMIN** | AfricGreen platform administrator | All modules | Full system configuration, user management, audit logs |
| **VESSEL_AGENT** | Shipping agent/shipowner | Payment Portal (future) | View vessel status, download invoices, submit payment (Phase 2) |

### 8.2 RBAC (Role-Based Access Control) Matrix - MVP

| Feature | PUBLIC | PORT_OFFICER | FINANCE_ADMIN | SUPERADMIN |
|---|---|---|---|---|
| Landing Page | ✅ | ✅ | ✅ | ✅ |
| Simulator | ✅ | ✅ | ✅ | ✅ |
| AIS Command Center | ❌ | ✅ (read) | ✅ (read) | ✅ |
| Vessel Details | ❌ | ✅ (read) | ✅ (read) | ✅ |
| Invoice Generation | ❌ | ✅ | ✅ | ✅ |
| Tax Rate Configuration | ❌ | ❌ | ✅ | ✅ |
| Transaction Logs | ❌ | ✅ (read) | ✅ | ✅ |
| Exemption Management | ❌ | ❌ | ✅ | ✅ |
| Audit Logs | ❌ | ❌ | ✅ | ✅ |
| User Management | ❌ | ❌ | ❌ | ✅ |
| System Configuration | ❌ | ❌ | ❌ | ✅ |

### 8.3 Responsibilities by Role

**PORT_OFFICER Responsibilities:**
- Monitor vessel movements in real-time
- Verify payment compliance before granting port clearance
- Generate and distribute pro-forma invoices to vessel agents
- Maintain audit trail of all port transactions
- Alert SUPERADMIN to suspicious/dark fleet activity

**FINANCE_ADMIN Responsibilities:**
- Set and maintain carbon tax rates
- Configure vessel category multipliers
- Approve exemption requests
- Monitor revenue collection dashboards
- Generate financial reports for government
- Manage exemption criteria and exceptions

**SUPERADMIN Responsibilities:**
- User account creation and lifecycle management
- System configuration and feature flags
- Technology updates and maintenance
- Audit log oversight and compliance verification
- Multi-country data segregation management
- Integration with external AIS providers

---

## 9. ARCHITECTURE & TECHNOLOGY STACK

### 9.1 Unified Platform Architecture (V2.2)

**Single Codebase, Multi-Tenant by Government**

- **Frontend:** Next.js 14+ / React 19
  - TailwindCSS for flexible styling
  - Mapbox GL JS for geospatial visualization
  - Dynamic layout per user role/context
  - Dark/Light theme support

- **Backend:** Go (or Python FastAPI for MVP)
  - High-throughput event processing (thousands of AIS pings)
  - Stateless architecture for horizontal scaling
  - gRPC for backend service communication

- **Database:** PostgreSQL + PostGIS
  - Spatial calculations (EEZ boundary checking)
  - Ship movement history tracking
  - Transaction and audit log storage

- **Authentication:** Supabase Auth or custom SSO
  - Magic link for government onboarding
  - Role-based access control at database level

### 9.2 Data Model (MVP Simplified)

```
Vessel {
  id: UUID
  imo_number: String
  name: String
  flag: String (country code)
  vessel_category: ENUM (CONTAINER|CARGO|TANKER|FERRY|etc)
  engine_power_kw: Integer
  design_speed_knots: Float
  gross_tonnage: Integer
  current_lat: Float
  current_lng: Float
  current_speed_knots: Float
  current_heading: Integer (0-360)
  status: ENUM (COMPLIANT|PAYMENT_DUE|PROCESSING|OVERDUE)
  last_ais_ping: Timestamp
}

TaxConfiguration {
  id: UUID
  country_code: String
  jurisdiction_zone: ENUM (ZEE|PORT_VICINITY)
  vessel_category: ENUM
  base_rate_usd_per_tco2: Decimal
  multiplier: Decimal (e.g., 1.2)
  effective_date: Date
  created_by: UUID (User)
  updated_at: Timestamp
}

Transaction {
  id: UUID
  vessel_id: UUID
  transaction_type: ENUM (ENTRY_TAX|TRANSIT_FEE|PORT_STAY)
  estimated_emissions_tco2: Decimal
  tax_amount_usd: Decimal
  status: ENUM (PAID|PENDING|OVERDUE|EXEMPT)
  invoice_pdf_url: String
  created_at: Timestamp
  due_date: Date
}

Exemption {
  id: UUID
  vessel_id: UUID
  reason: ENUM (MILITARY|HUMANITARIAN|SCIENTIFIC|OTHER)
  valid_until: Date
  approved_by: UUID (User)
  notes: String
  created_at: Timestamp
}

AuditLog {
  id: UUID
  user_id: UUID
  action: ENUM
  entity_type: String
  entity_id: UUID
  details: JSONB
  ip_address: String
  created_at: Timestamp
}

User {
  id: UUID
  email: String (unique)
  role: ENUM (PUBLIC|PORT_OFFICER|FINANCE_ADMIN|SUPERADMIN)
  country_code: String
  full_name: String
  is_active: Boolean
  last_login: Timestamp
  created_at: Timestamp
}
```

---

## 10. MVP SCOPE & DELIVERABLES (6-8 Weeks)

### 10.1 What's Included

**Module A: Public Portal**
- Landing page with hero section and KPIs
- Interactive simulator (vessel type → tax estimation)
- Public information about AfricGreen program

**Module B: AIS Command Center (Protected)**
- Login/onboarding flow
- Real-time vessel tracking map (Mapbox)
- Vessel detail view with emission estimation
- Pro-forma invoice generation (PDF)
- Audit log viewer
- KPI dashboard

**Module C: Tax Management (Protected)**
- Carbon tax rate configuration
- Transaction log with filtering/export
- Revenue dashboards (Recharts)
- Exemption management form

### 10.2 What's Excluded (Phase 2+)

- Real AIS satellite API (using mock data instead)
- Real payment processing
- Green Ledger / Carbon registry
- Real AI Dark Fleet detection
- Multi-country protocol
- Notifications/WebSocket
- Advanced reporting

### 10.3 Success Metrics

1. Demo completable in <10 minutes
2. Data appears credible and realistic
3. PDF invoice exportable as official document
4. Mobile responsive (tablet support)
5. Zero visible errors in demo environment

---

## 11. DECISION POINTS REQUIRING STAKEHOLDER INPUT

**These decisions must be made before development starts:**

1. **Target Country:** Somaliland only vs multi-country MVP?
2. **Backend:** Go (more robust, complex) vs Python FastAPI (faster development)?
3. **AIS Data Source:** Mock JSON vs MarineTraffic API vs Spire satellite?
4. **Auth Method:** Supabase Magic Link vs Gov SSO vs Email/Password?
5. **Mapbox Budget:** Restricted demo token vs production account?
6. **Mock Data Ethics:** Use real vessel names (authentic) vs fictional (privacy)?
7. **Demo Date:** Critical for sprint planning

---

## APPENDIX: KEY CONTACTS & REFERENCES

**Project Instructions:** Located in CLAUDE.md at project root
**Stack Documentation:** Next.js 14+, Go, PostgreSQL, PostGIS, Mapbox GL JS
**Financial Models:** Available in /docs/olds/ (Excel spreadsheets)
**Historical PRDs:** Multiple versions available for context

---

**Document Generated:** March 2026
**Based on:** prd_afrigreen_v2.md, prd_mvp_challenge.md, simu1.md, reference_doc.txt, recap.md

