# Décisions Tranchées — Green-Gate

**Date** : 2026-04-19
**Document parent** : `Plan_Developpement_GreenGate_v2026-04-19.md`
**Statut** : Décisions arrêtées par le Product Owner après revue stratégique CEO

---

## Synthèse des 8 décisions bloquantes

| # | Décision | Choix retenu | Réversibilité |
|---|---|---|---|
| **D1** | Stratégie de rebrand | **Nouveau repo `green-gate`, Africgreen archivé** | 4/5 |
| **D2** | Chaîne blockchain (one-way door) | **Polygon PoS** | 1/5 ⚠️ |
| **D3** | Modèle de partage des revenus | **Table versionnée + signature contractuelle** | 5/5 |
| **D4** | Méthodologie CO2 maritime | **IMO MEPC.364(79) / 4th IMO GHG Study** | 3/5 |
| **D5** | Méthodologie CO2 aviation | **ICAO LTO Cycle seul** | 4/5 |
| **D6** | Signature des rapports MoECC | **Co-signature Solide Tech + MoECC** | 4/5 |
| **D7** | Localisation des données | **Hybride : opérationnel UE + réplique souveraine Somaliland** | 2/5 |
| **D8** | Langues UI et factures | **4 langues dès le début (EN + SO + AR + FR)** | 4/5 |

---

## D1 — Nouveau repo `green-gate`, Africgreen archivé

**Décision** : Création d'un nouveau dépôt Git `green-gate` avec stack identique (Go + Supabase + Next.js + TypeScript + Tailwind). Africgreen passe en mode **read-only / archive** dès que Green-Gate est opérationnel.

**Conséquences immédiates** :
- Création du repo `green-gate` avec scaffolding complet (CI, lint, tests, Docker, fly.toml, vercel.json).
- Définir un **plan de cutover** : période parallèle (Africgreen continue à servir), bascule progressive feature-par-feature, freeze d'Africgreen à la date T.
- Migration de données Supabase : nouvelle instance ou même instance avec namespace `green_gate.*`.
- Communiquer la transition aux utilisateurs (s'il y en a) avec date de bascule.
- DNS : nouveau domaine principal `green-gate.so` (à acquérir si dispo), Africgreen redirige.
- Risque calendaire : la 1ʳᵉ livraison MoECC (rapport mensuel d'avril) devra probablement se faire **depuis Africgreen** en mode transition, puis basculer vers Green-Gate.

**Livrables** :
- ADR-000 « Migration Africgreen → Green-Gate »
- Plan de cutover détaillé
- Conventions de nommage : packages Go `github.com/solide-tech/green-gate/...`, namespace UI `@green-gate/...`

---

## D2 — Polygon PoS (chaîne blockchain)

**Décision** : Ancrage des hashs sur **Polygon PoS** (chaîne publique EVM-compatible).

**Conséquences immédiates** :
- Création d'un wallet de service `green-gate-anchor` géré via KMS (HSM si possible).
- Smart contract minimal `AnchorRegistry` à déployer : `function anchor(bytes32 invoiceId, bytes32 payloadHash, uint256 timestamp)`.
- Pattern **outbox** obligatoire : la facture est émise et persistée d'abord, l'ancrage Polygon est déclenché en async avec retry exponentiel. Jamais bloquant.
- Provisionnement MATIC : budget gas auto-rechargeable estimé < $500/an pour 1000 tx/jour.
- Monitoring : alerte si `blockchain_anchor_latency_seconds` p95 > 60s, ou si retry > 5 fois.
- Vérification publique : exposer un endpoint `/verify/{invoiceId}` qui donne le txid Polygon → tout tiers peut auditer.

**Livrables** :
- ADR-001 « Choix Polygon PoS pour l'ancrage immuable »
- Smart contract `AnchorRegistry.sol` + tests Hardhat/Foundry
- Module Go `internal/anchor/polygon_anchor.go`

⚠️ **Décision quasi-irréversible** — réversibilité 1/5. Une fois en production, changer de chaîne implique de re-ancrer rétroactivement (impossible) ou de gérer une dualité de chaînes.

---

## D3 — Table versionnée pour le partage des revenus

**Décision** : Table `revenue_split_rule` versionnée, signée contractuellement.

**Schéma cible** :
```sql
CREATE TABLE revenue_split_rule (
  id              UUID PRIMARY KEY,
  effective_from  TIMESTAMPTZ NOT NULL,
  effective_to    TIMESTAMPTZ,                -- NULL = règle courante
  concessionaire_pct  NUMERIC(5,2) NOT NULL CHECK (concessionaire_pct BETWEEN 0 AND 100),
  sovereign_pct       NUMERIC(5,2) NOT NULL CHECK (sovereign_pct BETWEEN 0 AND 100),
  contract_ref    TEXT NOT NULL,              -- référence contrat de concession
  signature_hash  TEXT NOT NULL,              -- hash du contrat signé
  signed_by       TEXT NOT NULL,              -- "solide+moecc+minfin"
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CHECK (concessionaire_pct + sovereign_pct = 100)
);
```

**Règles d'usage** :
- Aucun UPDATE autorisé. Un changement = INSERT d'une nouvelle ligne + UPDATE `effective_to` de la précédente.
- Chaque facture référence la règle applicable à sa **date d'émission** (pas la règle courante).
- Valeur initiale provisoire : 100% en séquestre tant que l'accord Min. Finance n'est pas formalisé → empêche tout settlement prématuré.

**Livrables** :
- Migration Supabase `001_revenue_split_rule.sql`
- Module Go `internal/revenue/split.go`
- Test : un changement de règle au milieu d'une période n'affecte pas les factures antérieures.

---

## D4 — IMO MEPC.364(79) / 4th IMO GHG Study (maritime)

**Décision** : Méthodologie **IMO MEPC.364(79)** alignée 4th IMO GHG Study pour le calcul CO2 des navires.

**Données d'entrée requises** :
- IMO number du navire (clé d'identification unique)
- Gross Tonnage (GT) — depuis registre IHS Markit ou AIS
- Type de propulsion + puissance moteur (kW)
- Fuel spec utilisé (HFO, MGO, LNG, méthanol…)
- Durée d'escale réelle (timestamps `arrival` / `departure`)
- Manœuvres port (entrée/sortie pilotées vs. autonomes)

**Référentiel à embarquer** :
- Tables de **specific fuel consumption (SFC)** par type de moteur
- Facteurs d'émission CO2 par type de fuel (3.114 g CO2 / g HFO, etc.)
- Ces tables doivent être versionnées dans la base (`emission_factor` table avec `effective_from`).

**Livrables** :
- Guide méthodologique : `docs/methodology/CO2_Shipping_IMO.md`
- Module Go `internal/assessment/shipping/imo_calculator.go`
- Suite de tests fixtures réels (10 navires types + cas limites)
- ADR-003 « Méthodologie IMO MEPC.364(79) »

---

## D5 — ICAO LTO Cycle seul (aviation)

**Décision** : Méthodologie **ICAO LTO Cycle** (Landing/Take-Off : approach + taxi-in + taxi-out + take-off + climb <3000ft).

**Données d'entrée requises** :
- ICAO aircraft type designator (ex: B738, A320)
- Nombre de cycles LTO dans la période de facturation
- Assignation moteur (type + nombre)
- Données depuis ICAO Engine Emissions Databank (EDB)

**Référentiel** :
- Sync de l'ICAO EDB (mise à jour annuelle)
- Versioning : `aircraft_emission_profile` table

**Cas limites** :
- Type d'avion non listé EDB → catégorie générique par MTOW + flag « estimation approximée » sur la facture
- Vols cargo vs. passagers : même méthodologie LTO, pas de distinction

**Livrables** :
- Guide méthodologique : `docs/methodology/CO2_Aviation_ICAO.md`
- Module Go `internal/assessment/aviation/icao_lto_calculator.go`
- ADR-004 « Méthodologie ICAO LTO »
- Données de référence EDB importées en seed

---

## D6 — Co-signature Solide Tech + MoECC (rapports mensuels)

**Décision** : Workflow à **double signature** pour les rapports mensuels.

**Workflow** :
```
1. report_generated      (J+1 du mois : 1ᵉʳ jour suivant la période)
2. solide_signed         (signature crypto Solide via clé HSM)
3. submitted_to_moecc    (notification + portail MoECC)
4. moecc_acknowledged    (accusé réception)
5. moecc_signed          (validation + signature MoECC)
6. anchored_on_polygon   (ancrage hash final co-signé)
```

**Cas dégradé — MoECC ne signe pas dans X jours** (X à formaliser, recommandation : 10 jours ouvrés) :
- Le rapport est ancré « unilatéralement » avec mention `awaiting_moecc_signature`
- Alerte ops + relance automatique
- N'invalide pas le rapport (preuve d'émission constituée)

**Composants à construire** :
- **Portail MoECC minimaliste** : interface web pour consultation rapports + bouton de signature. Auth MFA. Historique. Ajout au scope phase 1.
- **Module signature** : Solide via KMS, MoECC via clé dédiée + procédure d'export/rotation documentée.

**Livrables** :
- Module Go `internal/report/moecc_signer.go`
- Frontend `apps/moecc-portal/` (Next.js, simple, mobile-friendly)
- ADR-005 « Workflow co-signature rapports MoECC »
- Procédure de gestion de clés MoECC (document opérationnel)

---

## D7 — Hybride : opérationnel UE + réplique souveraine Somaliland

**Décision** : Architecture **hybride à deux régions**.

**Architecture** :
```
   ┌──────────────────────────┐         ┌──────────────────────────┐
   │  PRIMARY (UE)            │         │  SOVEREIGN REPLICA       │
   │  Supabase Frankfurt/Paris│ ──pull──▶  Somaliland / East Africa│
   │  Workload op + lecture   │  daily  │  Read-only, archivage    │
   └──────────────────────────┘         └──────────────────────────┘
              │                                       │
              ▼                                       ▼
       ┌──────────────────────────────────────────────────────┐
       │  Hash de chaque snapshot quotidien → ancré Polygon   │
       │  → preuve cryptographique de l'identité des copies   │
       └──────────────────────────────────────────────────────┘
```

**Paramètres opérationnels** :
- **RPO** : ≤ 24h (réplication quotidienne)
- **RTO** : ≤ 72h (bascule si UE indisponible)
- **Coût** : +30 à 50% vs single-region. Budget à valider.

**Conformité requise** :
- DPIA (Data Protection Impact Assessment) co-signée par Solide + MoECC documentant les flux transfrontaliers
- Clauses contractuelles types pour le transfert hors Somaliland
- Engagement de bascule **primaire** vers Somaliland dès qu'une infra cloud locale fiable est disponible

**Fournisseurs candidats pour la réplique** :
- Djibouti Data Center (DDC)
- Liquid Intelligent Technologies (Kenya)
- Stockage notarié hash-only si pas de full replica faisable

**Livrables** :
- ADR-002 « Stratégie hybride stockage »
- Document DPIA co-signé
- Procédure de bascule UE → Somaliland (runbook DR)
- Job cron de réplication quotidienne avec ancrage hash Polygon

---

## D8 — 4 langues dès le début (EN + SO + AR + FR)

**Décision** : Internationalisation **multilingue complète** dès la phase 1.

**Périmètre** :
- **Frontend** (Next.js) : 4 fichiers de traduction `messages/{en,so,ar,fr}.json`
- **Backend** : templates de factures juridiques en 4 langues, choisis selon la préférence du débiteur (à défaut : EN)
- **Portail MoECC** : 2 langues minimum (SO + EN), AR/FR optionnel
- **Documents légaux générés** (rapports, attestations) : 4 langues

**Contraintes techniques majeures** :
- **Support RTL** (arabe) : Tailwind `dir="rtl"`, miroir des layouts, vérification de tous les composants tiers (date pickers, modales, tables). Suite de tests visuels RTL automatisée (Playwright).
- **Polices** : Noto Sans Arabic (RTL) + Noto Sans (latin/somali) + une police FR de qualité.
- **Validation linguistique** : aucune traduction publiée sans relecture par natif. Pour les actes juridiques (factures, rapports) : double validation juridique-linguistique.

**Process de traduction** :
- Première passe : traduction professionnelle ou LLM-assistée (selon budget)
- Deuxième passe (obligatoire) : relecture native + juridique
- Versioning des traductions : table `i18n_string` avec historique

**Risques** :
- Dette de traduction si nouveau contenu pas synchronisé entre 4 langues
- Qualité des traductions arabes pour la terminologie maritime/fiscale

**Livrables** :
- 4 fichiers `messages/{en,so,ar,fr}.json`
- 4 templates de factures (`invoice_template_{en,so,ar,fr}.html`)
- Test suite Playwright RTL
- Process de relecture documenté
- ADR-006 « Stratégie i18n 4 langues »

---

## Impacts cumulés sur le Plan de Développement

### Phase 1 (M+0 → M+2) — Compliance Core ⚠️ scope alourdi

Initialement prévue pour rebrand léger + module shipping + facturation. Avec les décisions D1, D6, D7, D8 retenues, la phase 1 absorbe désormais :

| Item | Source | Effort additionnel |
|---|---|---|
| Création repo Green-Gate complet | D1 | M (~2 sem) |
| Plan cutover Africgreen → Green-Gate | D1 | S (~3 jours) |
| Portail MoECC pour co-signature | D6 | M (~2 sem) |
| Architecture hybride UE + réplique | D7 | M (~2 sem) |
| i18n 4 langues + RTL | D8 | M (~3 sem) |
| Smart contract Polygon + outbox | D2 | S (~1 sem) |

**Verdict** : la phase 1 telle que pré-décidée est **dense**. Avec accélération CC/IA (~10x), elle reste atteignable en 2 mois mais sans marge. Recommandation : produire le PRD v8 immédiatement et entamer le scaffolding `green-gate` en parallèle de la finalisation de D3 (négociation Min. Finance).

### Phase 2 (M+2 → M+5) — Aviation & Automation

Inchangée fondamentalement. Méthodes IMO + ICAO LTO confirmées.

### Phase 3 (M+5 → M+10) — Industrialisation

Inchangée. Bascule progressive de la primaire UE vers Somaliland si infra disponible.

---

## Prochaines actions concrètes (next 7 days)

1. **D1** — Créer le repo `green-gate` (scaffolding minimal avec stack figée).
2. **D1** — Écrire le plan de cutover détaillé.
3. **D2** — Acquérir/mettre à disposition un wallet Polygon de test + estimer les coûts gas réels.
4. **D3** — Lancer la négociation officielle du ratio avec Min. Finance.
5. **D4 / D5** — Récupérer les bases de référence IMO + ICAO EDB.
6. **D6** — Cadrer le wireframe du portail MoECC (interface minimaliste).
7. **D7** — Identifier le fournisseur de réplique souveraine (DDC ? Liquid ?) + obtenir devis.
8. **D8** — Identifier les ressources de relecture native (SO, AR, FR).

Et en parallèle :
- Produire le **PRD v8 Green-Gate** (remplace v7 Africgreen)
- Produire les **ADR 000 → 006** (un par décision structurante)
- Définir le **template de rapport mensuel MoECC** (premier livrable contractuel attendu fin avril)

---

**Fin du document — v1.0 — 2026-04-19**

*Ces décisions consolident les arbitrages CEO sur les 8 questions bloquantes du plan stratégique. Elles serviront de base au PRD v8 et aux ADR à produire. Conformément aux instructions du projet, aucune modification de code n'a été effectuée — uniquement de l'analyse et de la structuration documentaire.*
