# AfricGreen Project Recap

## [2026-03-02 15:30] Initial Project Request
- **Platform Name**: AfricGreen
- **Objective**: Carbon tax calculation for the government (simulation, information, real fee payment).
- **Frontend Stack**: React (Next.js)
- **Backend Stack**: Go, Supabase (PostgreSQL)
- **Key Features**:
  - Information portal
  - Simulation tool for fees
  - User login & payment of real fees
- **Core Requirements**:
  - DDD Architecture
  - Internationalization (i18n)
  - Mobile-first & PWA (offline)
  - ThemeProvider for unified styling
  - Enums/Constants for statuses and actions
  - No hardcoded data in views


## [2026-04-08 12:40] Scope Analysis & Production Roadmap
- **Request**: Comprehensive analysis of the current project state and creation of a production deployment plan.
- **Outcome**:
  - Detailed scope audit (Advanced Sandbox V2.2 status).
  - Production Deployment Plan created in `docs/deployment_plan.md`.
  - Roadmap covering 3 phases: Hardening/Integration, Environment Readiness, and Launch.
  - Identification of critical bottlenecks (Select AIS Provider, Verify Legal Notices).

## [2026-04-08 15:00] Restauration Branche Démo
- **Requête**: Restaurer les fonctionnalités de démo qui avaient été perdues.
- **Actions**:
  - Activation du bypass auth dans `middleware.ts` basé sur le cookie `isDemo`.
  - Restauration de la section "Quick Demo Access" dans `LoginPage.tsx`.
  - Création et intégration du composant `DemoBanner.tsx` pour indiquer l'état de démo.
  - Mise à jour de la logique RBAC dans `layout.tsx` pour les sessions démo.
  - Fix de l'internationalisation (`Auth.quick_demo_access`) dans les 5 langues.
  - Vérification complète via browser subagent et build de production.
- **Outcome**: Environnement de démo 100% opérationnel et isolé sur la branche `demo`.
