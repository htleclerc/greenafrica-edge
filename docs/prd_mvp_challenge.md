# AfricGreen — PRD Challenge & Recommandations MVP
**Auteur :** Analyse stratégique Claude
**Date :** Mars 2026
**Statut :** DOCUMENT DE TRAVAIL — À valider avant démarrage du développement

---

## TL;DR — Le Verdict en 3 Points

> **Ce qui est excellent :** La vision panafricaine est puissante, les maquettes UI sont magnifiques, et la tech stack (Next.js + Go + Supabase/PostGIS) est pertinente.
> **Ce qui est dangereux :** Le PRD V2.2 est une vision à 3 ans présentée comme un MVP à 2 mois. Le risque d'échec est élevé si le périmètre n'est pas drastiquement réduit.
> **La recommandation :** Un MVP focalisé sur 1 pays, 3 modules, 0 IA réelle — livrable en 6-8 semaines avec Claude Code.

---

## 1. Analyse Critique du PRD Existant (Les Challenges)

### 1.1 ❌ Problème de Scope : Vision 3 ans = MVP ?

Le PRD V2.2 liste simultanément :
- Radar géospatial alimenté par satellite (Spire)
- Identification IA de "Dark Fleet" en temps réel
- Moteur fiscal configurable multi-pays
- Pipeline de certification de projets carbone (PDD, Land Tenure, EIA)
- Registre carbone souverain interopérable (Verra/Gold Standard)
- Protocole panafricain multi-États signataires

**Challenge :** Aucune startup ou équipe tech ne livre tout ça en "1 à 2 mois" (Phase V1.5). C'est une roadmap 24 à 36 mois. Sans priorisation dure, vous allez tout commencer et rien finir.

### 1.2 ❌ Deux PRDs Contradictoires Coexistent

- **PRD V1.1** : Cible le Somaliland (Port de Berbera), stack "Low-code/FastAPI", timeline réaliste.
- **PRD V2.2** : Cible panafricaine, Go backend, architecture RBAC multi-pays, IA profonde.

**Challenge :** L'équipe n'a pas de décision architecturale claire. Le `instructions.md` dit "Go backend + Supabase" mais V1.1 dit "Python FastAPI". Le backend actuel ne contient qu'un `README.md`. Il faut trancher maintenant, avant d'écrire la première ligne de code fonctionnel.

### 1.3 ❌ L'IA est Présentée comme un Socle — Pas comme une Feature

Le PRD V2.2 décrit l'IA (estimation OMI, détection Dark Fleet) comme "socle profond". Or l'algo de la Loi Cubique (documenté dans `simu1.md`) est un calcul mathématique déterministe — pas du Machine Learning. La détection Dark Fleet (navires hors AIS) necessite des données satellite réelles, un modèle entraîné, et une infrastructure ML-ops.

**Challenge :** Pour le MVP, "l'IA" = l'algorithme cubique OMI + forfaits par catégorie. C'est du code Python/Go classique. Appeler ça "IA" dans le PRD crée des attentes mal calibrées chez les clients gouvernementaux.

### 1.4 ❌ La Source de Données AIS n'est Pas Définie pour le MVP

Le radar temps réel est la fonctionnalité phare — mais quel flux AIS pour le MVP ?
- **Spire / exactEarth** : coût ~15-50K USD/an, intégration complexe, délais contractuels.
- **MarineTraffic API** : accessible mais throttled, pas de ZEE filtering natif.
- **Mock Data JSON** : disponible immédiatement, idéal pour la démo politique.

**Challenge :** Nulle part dans les docs il n'est précisé QUEL fournisseur AIS, QUAND, et avec QUEL budget. Développer le radar sans décider de la source de données revient à construire un tableau de bord sans base de données.

### 1.5 ❌ RBAC et Authentification : Lacune Critique

Le PRD cite 4 profils (Officier Portuaire, Armateur, Ministère, Admin) mais ne définit pas :
- Qui peut créer des comptes ?
- Le flow d'onboarding gouvernemental (les maquettes montrent un "Sign Step 1/2" mais sans workflow complet)
- La gestion des accès multi-pays (un admin Gabon peut-il voir les données Djibouti ?)
- La gestion des sessions et des droits granulaires par module

**Challenge :** Sans matrice RBAC documentée, chaque développeur inventera ses propres règles d'accès. Résultat : des failles de sécurité dans une plateforme gouvernementale.

### 1.6 ⚠️ Le Frontend Existant : Bon Départ, Mauvais Périmètre

L'analyse du code frontend révèle que les pages suivantes sont déjà scaffoldées :
- `/` (Landing + Simulateur)
- `/radar` (Carte AIS)
- `/carbon-tax` (Gestion fiscale)
- `/carbon-credits` (Registre carbone)
- `/projects` (Green Projects)
- `/reports` (Rapports)

**Observation :** Ces pages sont des pages publiques (informatives) — elles ne constituent PAS le portail gouvernemental protégé (Dashboard, Tax Settings, Audit Logs). Il y a une confusion entre le site vitrine public et l'application B2G sécurisée. Ce sont deux produits différents.

---

## 2. Décisions Architecturales Obligatoires (À Trancher Maintenant)

Avant de coder avec Claude Code, ces décisions doivent être prises :

| Décision | Option A | Option B | **Recommandation** |
|---|---|---|---|
| Backend MVP | Go (robuste, complexe) | Python FastAPI (rapide, familier) | **Go si l'équipe maîtrise, sinon FastAPI pour le MVP** |
| AIS MVP | Mock JSON enrichi | API MarineTraffic Basic | **Mock JSON — livrable en J+0** |
| Auth | Supabase Auth natif | NextAuth + Supabase | **Supabase Auth (magic link + email/password)** |
| Map | Mapbox GL JS | React Simple Maps | **Mapbox GL JS (déjà dans le code)** |
| Scope géo MVP | Somaliland uniquement | Multi-pays | **Somaliland — 1 pays, 1 ZEE, 1 port** |
| Green Ledger MVP | Inclus | Exclu | **Exclu du MVP** |
| Paiement MVP | Intégré (Stripe/Flutterwave) | Manuel / pro-forma PDF | **Pro-forma PDF — intégration paiement en V2** |

---

## 3. PRD MVP — AfricGreen AIS Portal (Version Recommandée)

### 3.1 Vision du MVP

> Livrer en 6-8 semaines une démo interactive et crédible du portail AfricGreen permettant à un représentant gouvernemental du Somaliland de visualiser le trafic maritime dans sa ZEE, de configurer un taux de taxe carbone, de générer une facture PDF pour un navire, et de consulter les revenus estimés — le tout avec des données simulées réalistes.

**L'objectif du MVP n'est pas la production. C'est la signature du MoU.**

---

### 3.2 Les 3 Modules du MVP (et ce qu'on exclut)

#### ✅ MODULE A — Public Portal (Site Vitrine + Simulateur)
*Pour qui :* Gouvernements potentiels, investisseurs, presse
*Accès :* Public, sans authentification

**Écrans :**
1. **Landing Page** — Hero, pitch AfricGreen, KPIs de démonstration, appel à l'action "Demander l'accès"
2. **Simulateur Interactif** — Formulaire (type navire, tonnage, durée transit, taux carbone) → résultat en USD avec estimation CO2. Basé sur l'algo OMI forfaitaire (simu1.md).

**Données :** 100% calculées côté client (Next.js), aucun appel API.

---

#### ✅ MODULE B — AIS Command Center (Portail Gouvernemental — Accès Protégé)
*Pour qui :* Officier Portuaire, Garde-côtes
*Accès :* Authentifié — rôle `PORT_OFFICER` ou `ADMIN`

**Écrans :**
1. **Login / Onboarding** (2 steps comme dans les maquettes)
2. **Dashboard Overview** — KPIs (navires actifs, revenus du jour, CO2 estimé), liste des événements récents, statut des navires
3. **Carte AIS Live** — Mapbox GL JS, dark mode, navires simulés avec code couleur : `COMPLIANT` (vert), `PAYMENT_DUE` (orange), `OVERDUE` (rouge)
4. **Fiche Navire** — Détail d'un navire (IMO, catégorie, émissions calculées, statut paiement), bouton "Générer Facture Pro-Forma" → export PDF
5. **Audit Log** — Tableau des actions (connexions, factures générées, statuts modifiés) avec export CSV

**Données :** Mock data enrichi (15-20 navires simulés dans la ZEE de Berbera), rechargeable via interval JS pour simuler le "temps réel".

---

#### ✅ MODULE C — Tax Management (Portail Admin)
*Pour qui :* Ministère des Finances, Administrateur AfricGreen
*Accès :* Authentifié — rôle `FINANCE_ADMIN` ou `SUPERADMIN`

**Écrans :**
1. **Carbon Tax Settings** — Configuration du taux (USD/TCO2e), segmentation par catégorie navire (Container, Cargo, Tanker, Ferry), bouton "Sauvegarder & Publier"
2. **Transaction Log** — Tableau des transactions (Entry Tax, Transit Fee, Port Stay) avec filtres et export
3. **Revenue Dashboard** — Graphiques (recharts) : revenus par semaine, par catégorie navire, comparatif mois N vs N-1
4. **Gestion des Exemptions** — Formulaire de dérogation (flotte militaire, ONU, scientifique)

**Données :** Mock data avec 30 transactions simulées, paramètres fiscaux en localStorage pour la démo.

---

#### ❌ HORS MVP (V2 et au-delà)
- Green Ledger / Registre Carbone (workflow de certification PDD, EIA)
- Carbon Credits Marketplace
- Détection IA Dark Fleet (navires hors AIS)
- Intégration paiement réel (Stripe, Flutterwave, SWIFT)
- Multi-pays / protocole panafricain
- API AIS satellite réelle
- Notifications temps réel (WebSocket)
- Module rapports gouvernementaux avancés (export BI)

---

### 3.3 Matrice RBAC du MVP

| Rôle | Module A (Public) | Dashboard AIS | Carte + Fiches | Tax Settings | Transactions | Admin Panel |
|---|---|---|---|---|---|---|
| `PUBLIC` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `PORT_OFFICER` | ✅ | ✅ (lecture) | ✅ | ❌ | ✅ (lecture) | ❌ |
| `FINANCE_ADMIN` | ✅ | ✅ (lecture) | ✅ | ✅ | ✅ | ❌ |
| `SUPERADMIN` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

### 3.4 Modèle de Données MVP (Simplifié)

```
Vessel {
  id, imo_number, name, flag, vessel_category (ENUM),
  engine_power_kw, design_speed_knots, gross_tonnage,
  status (ENUM: COMPLIANT | PAYMENT_DUE | PROCESSING | OVERDUE),
  current_lat, current_lng, current_speed_knots, current_heading
}

TaxConfiguration {
  id, jurisdiction_zone (ENUM: ZEE | PORT_VICINITY),
  vessel_category, base_rate_usd_per_tco2, multiplier,
  effective_date, created_by
}

Transaction {
  id, vessel_id, transaction_type (ENUM: ENTRY_TAX | TRANSIT_FEE | PORT_STAY),
  emissions_tco2, tax_amount_usd, status (ENUM: PAID | PENDING | OVERDUE | EXEMPT),
  invoice_pdf_url, created_at
}

Exemption {
  id, vessel_id, reason (ENUM: MILITARY | HUMANITARIAN | SCIENTIFIC | OTHER),
  valid_until, approved_by, notes
}

AuditLog {
  id, user_id, action (ENUM), entity_type, entity_id,
  details_json, ip_address, created_at
}

User {
  id, email, role (ENUM), country_code, full_name,
  last_login, is_active
}
```

---

## 4. Plan de Développement MVP avec Claude Code

### 4.1 Approche Recommandée

Pour maximiser la productivité avec Claude Code, respecter ces principes :

1. **Un fichier CLAUDE.md à la racine** — Contient les règles du projet (DDD, i18n, no hardcoded data). Claude Code le lira automatiquement.
2. **Découpage par feature, pas par couche** — Créer une feature à la fois (ex: "Vessel Card + Mock data + API route") plutôt que "tous les modèles de données d'abord".
3. **Mock data en premier** — Définir `mockVessels`, `mockTransactions`, `mockTaxConfigs` avant tout développement UI. Claude Code doit toujours avoir des données à afficher.
4. **Types TypeScript en premier** — Définir toutes les interfaces avant les composants. Évite les `any` et les refactors coûteux.
5. **Commencer par les pages statiques** — Valider le design/layout avant d'ajouter la logique.

### 4.2 Ordre de Développement (Sprints)

#### Sprint 1 — Fondations (Jours 1-5)
```
1. Setup CLAUDE.md avec règles projet
2. Définir tous les types TypeScript dans /src/types/
3. Enrichir les mock data (20 navires réalistes Berbera ZEE)
4. Configurer Supabase Auth (magic link + email/pwd)
5. Layout protégé avec RBAC (middleware Next.js)
6. Composants UI de base (Button, Card, Badge, Table, Modal)
```

#### Sprint 2 — Module Public (Jours 6-10)
```
1. Landing Page (Hero + Features + CTA)
2. Simulateur interactif (formulaire → calcul OMI forfaitaire → résultat)
3. Page Login + Onboarding 2 steps
4. Responsive mobile-first
```

#### Sprint 3 — Command Center (Jours 11-18)
```
1. Dashboard Overview (KPIs + Recent Activity)
2. Carte Mapbox GL JS avec navires simulés (mock data animé)
3. Fiche Navire (détail + calcul émissions)
4. Génération PDF facture pro-forma (react-pdf ou jsPDF)
5. Audit Log (tableau filtrable)
```

#### Sprint 4 — Tax Management (Jours 19-26)
```
1. Carbon Tax Settings (formulaire de configuration)
2. Transaction Log (tableau + filtres + export CSV)
3. Revenue Dashboard (graphiques recharts)
4. Gestion des Exemptions
```

#### Sprint 5 — Polish & Demo Prep (Jours 27-35)
```
1. Animations (Framer Motion) sur les KPIs et transitions
2. Dark/Light mode (déjà supporté via next-themes)
3. i18n (FR + EN minimum)
4. PWA config (manifest + service worker)
5. Seed de données démo réaliste (Port de Berbera, navires réels anonymisés)
6. Tests E2E sur les flux critiques
```

### 4.3 Prompts Stratégiques pour Claude Code

Pour chaque feature, structurer les prompts ainsi :

```
[CONTEXTE] Je développe AfricGreen, un portail GovTech de taxe carbone maritime.
[RÈGLES] DDD, i18n (next-intl), Tailwind, no hardcoded strings, TypeScript strict.
[TÂCHE] Crée le composant VesselCard qui affiche les données d'un navire...
[DONNÉES] Voici le type Vessel et le mock data correspondant : [...]
[DESIGN] Voici la maquette de référence : [screenshot assets/V1/...]
[CONTRAINTES] Pas de dépendances supplémentaires. Utilise les composants UI existants.
```

### 4.4 Fichier CLAUDE.md Recommandé (à créer à la racine)

```markdown
# AfricGreen — Rules for Claude Code

## Stack
- Frontend: Next.js 16, React 19, TypeScript, TailwindCSS v4
- Backend: Go (API) + Supabase (Auth, DB, Storage)
- DB: PostgreSQL + PostGIS (Supabase)
- Maps: Mapbox GL JS
- Charts: Recharts
- i18n: next-intl (FR + EN)
- Animations: Framer Motion

## Coding Rules
1. ALL user-facing strings in /messages/[locale].json — never hardcode text in JSX
2. Use /src/types/ interfaces for all data shapes
3. Mock data lives in /src/mock/datas/ — use it everywhere during MVP
4. Colors via ThemeProvider only — no arbitrary Tailwind colors
5. Enums for statuses: VESSEL_STATUS, TRANSACTION_TYPE, USER_ROLE
6. DDD structure: /domain/ for business logic, /components/ for UI only
7. File naming: PascalCase for components, camelCase for utils/hooks
8. English for all code (variables, functions, comments)

## Current MVP Scope
- Module A: Public Portal + Simulator (no auth)
- Module B: AIS Command Center (PORT_OFFICER, ADMIN)
- Module C: Tax Management (FINANCE_ADMIN, SUPERADMIN)
- OUT OF SCOPE: Green Ledger, Carbon Credits, Real AIS API, Payments

## Port: 3300 (frontend dev server)
```

---

## 5. Risques et Mitigations

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Scope creep — ajouter le Green Ledger "vite fait" | Haute | Critique | PRD figé, backlog séparé V2 |
| Mapbox quota dépassé en démo | Moyenne | Moyen | Token restreint domaine démo + fallback React Simple Maps |
| PDF génération côté client lente | Moyenne | Faible | Générer le PDF côté serveur (API route Go/Next.js) |
| Supabase Auth SSO gouvernemental complexe | Haute | Moyen | Magic Link pour le MVP, SSO Gov en V2 |
| Mock data trop peu réaliste pour convaincre | Haute | Critique | Investir J+2 à J+3 dans des données AIS réalistes (vraies routes Golfe d'Aden) |
| i18n oubliée en fin de sprint | Très haute | Moyen | Règle Claude Code : refus de merger si strings hardcodées |

---

## 6. Métriques de Succès du MVP

Le MVP est réussi si, lors de la démo :

1. **Démo en moins de 10 min** — Un officier gouvernemental peut voir sa ZEE, cliquer sur un navire, voir la facture, et ajuster le taux de taxe sans formation préalable.
2. **Données crédibles** — Les navires affichés ont des noms réels (MSC, CMA CGM, Maersk), des routes cohérentes avec le Golfe d'Aden, et des émissions calculées selon la méthode OMI.
3. **PDF exportable** — La facture pro-forma générée peut être imprimée et présentée comme document officiel.
4. **Responsive** — La carte fonctionne sur tablette (usage terrain garde-côtes).
5. **Zéro erreur visible** — Aucun `console.error`, aucune page blanche, aucun timeout en démo.

---

## 7. Ce Qui Doit Être Décidé par le Porteur du Projet (Avant J+1)

- [ ] **Quel pays cible pour le MVP ?** Somaliland uniquement ou inclure Djibouti/Gabon dès le début ?
- [ ] **Backend Go ou Python FastAPI ?** Pour le MVP, le backend sert uniquement l'auth et le seed de données — Go est overkill si l'équipe est junior.
- [ ] **Quel token Mapbox ?** Créer un compte Mapbox, générer un token restreint au domaine de démo.
- [ ] **Noms des navires dans le mock data ?** Utiliser de vrais noms AIS pour la crédibilité ou des noms fictifs pour éviter tout problème légal ?
- [ ] **Format de la facture PDF ?** Qui valide le template du "Maritime Environmental Levy Notice" ?
- [ ] **Quand est la démo gouvernementale ?** La date fixe le rétro-planning des sprints.

---

*Document généré le Mars 2026 — Basé sur l'analyse de : `prd_afrigreen.md`, `prd_afrigreen_v2.md`, `simu1.md`, `reference doc.txt`, `recap.md`, `instructions.md`, `frontend/src/**`, `assets/V1/*.png`*
