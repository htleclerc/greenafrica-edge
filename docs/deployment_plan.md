# AfricGreen Scope Analysis & Production Deployment Plan

This document provides a comprehensive analysis of the current project scope and a detailed roadmap for production deployment.

## Scope Analysis (Current State)

### 1. Functional Coverage
The platform is currently in an **Advanced Sandbox phase (V2.2)**. Most core modules are architected and visually implemented with functional services mapping to Supabase:

- **Command Center ("The Eye")**: Real-time maritime tracking interface. Infrastructure is ready for AIS ingestion (Vessel and Position tables).
- **Tax Engine**: Fully configurable carbon tariff system. Parameters for boat categories and jurisdiction zones are implemented in the DB.
- **Reporting & KPI**: Integrated dashboard for operational and ministerial oversight.
- **Green Ledger**: Registry for sovereign ecological projects and carbon credits.
- **Compliance Workflow**: Services for Pro-forma invoices, exemptions, and audit trails are functional.
- **Internationalization**: Full support for 5 languages (EN, FR, AR, PT, SW) with RTL support for Arabic.

### 2. Technical Stack & Maturity
- **Frontend**: Next.js 14+ (App Router), TypeScript, Vanilla CSS/ThemeProvider.
- **Backend**: Supabase (PostgreSQL/PostGIS, Auth, Storage).
- **Mobile Connectivity**: PWA with offline fallback.
- **Architecture**: Domain-Driven Design (DDD) ensuring scalability.

---

## Production Deployment Plan

### Phase 1: Hardening & Integration (Weeks 1-3)
"Moving from simulation to reality."

#### 1. Real-time AIS Stream
- **Target**: Integrate Spire or MarineTraffic Satellite API.
- **Action**: Setup a Supabase Edge Function or Go service to process high-frequency AIS pings.

#### 2. Payment Gateway
- **Action**: Integrate a global/regional payment gateway (e.g., Stripe, Flutterwave) to automate the `PAID` status of transactions.

#### 3. Administrative Console
- **Action**: Finalize the "Tax Parameters" UI for Ministry of Finance officials.

### Phase 2: Environment Readiness (Week 4)

#### 1. Infrastructure Setup
- Provision a Production Supabase instance.
- Setup Vercel (or custom K8s) for Frontend hosting.
- Configure custom Government domain (e.g., `*.gov.so`).

#### 2. Security Audit
- Review all Row Level Security (RLS) policies.
- Conduct a security penetration test on the login/session flow.

### Phase 3: Launch & Onboarding (Week 5+)

#### 1. Data Seeding
- Import official vessel databases (IMO Registry).
- Launch with initial Tax Rates validated by state legal counsel.

#### 2. Training & Support
- Onboard Port Officers and Ministry Administrators.
- Setup 24/7 monitoring (Sentry, UptimeRobot).

---

## Recommendations & Decisions Required

1. **AIS Provider**: Select between Spire (Best satellite coverage) and MarineTraffic (standard).
2. **Billing Currency**: Standardize on USD (International Maritime standard) with local currency display options.
3. **Go Backend**: Decide if the Go microservice is required for V1 or if Supabase logic suffices.
