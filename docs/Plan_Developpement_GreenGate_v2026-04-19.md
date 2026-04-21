# Plan de Développement Green-Gate — Révision Stratégique v1.0

**Date** : 2026-04-19
**Auteur** : Analyse CEO Review (mode analytique)
**Statut** : Document de re-cadrage post-décret ministériel
**Référence légale** : Décret MoECC Ref. MOE&CC/mi/36/2026 du 31 mars 2026

---

## 0. Résumé Exécutif (TL;DR)

Le projet **change de nature juridique** : il n'est plus un produit en recherche de traction, c'est désormais le **système officiel** mandaté par décret ministériel du Somaliland. Trois signaux majeurs :

1. **Le nom devient "Green-Gate"** (officiel, inscrit dans l'Article 1 du décret). `Africgreen` / `AIS Portal` = appellations historiques internes.
2. **Le tarif est fixé à $40 USD / tonne métrique de CO2** (Article 3). Ce n'est plus un paramètre de simulation libre — c'est un paramètre légal, versionné, auditable.
3. **La portée s'étend aux aéroports** (flight cycles) en plus des ports. Deux modalités de calcul totalement différentes (tonnage navires vs. cycles aéronautiques).

**Verdict** : Le plan v7 (Africgreen) doit être **refait, pas patché**. Ce n'est plus une refonte cosmétique — le modèle de données, l'architecture d'autorité (concession), les flux de revenu, et le domaine métier changent.

---

## 1. Lecture Stratégique du Décret

### 1.1 Ce qui change juridiquement

| Dimension | Avant (interprétation produit) | Après (décret 31/03/2026) |
|---|---|---|
| **Nature** | Startup / plateforme de simulation | Infrastructure d'État (concession) |
| **Opérateur** | "Africgreen" (projet) | **Solide Technology** (concessionnaire exclusif, 10 ans) |
| **Autorité** | Aucune officielle | Ministry of Environment and Climate Change (MoECC) |
| **Cadre légal** | Aucun | Law No. 79/2018 + NDP III + National Guideline Voluntary Carbon Market (07/2025) |
| **Principe** | Volontaire | **"Polluter Pays" (IMO + ICAO)** |
| **Tarif** | Variable / simulation | **$40 USD / tCO2 (Article 3.3) — figé par décret** |
| **Périmètre physique** | Ports maritimes | Ports + tous les aéroports internationaux |
| **Partage des revenus** | N/A | Part concessionnaire + part souveraine (Min. Finance) |
| **Obligations techniques** | Best effort | **Blockchain traçabilité + capteurs + rapport mensuel MoECC** |

### 1.2 Conséquence : c'est un système de **collecte fiscale régulée**, pas une app

Cela entraîne une responsabilité radicalement différente :
- Chaque facture émise est un **acte fiscal** → exigence d'auditabilité légale (pas juste "sympa de logger").
- La moindre erreur de calcul = contentieux avec un armateur ou une compagnie aérienne.
- Le rapport mensuel au MoECC est un **livrable contractuel** — pas un nice-to-have.
- La blockchain n'est plus un "gimmick marketing" : elle est **obligation contractuelle** (Article 4).

---

## 2. Analyse des Premisses (Premise Challenge)

### 2.1 Est-ce le bon problème ?

**Oui, mais plus le même problème.** Avant : "comment aider un gouvernement à simuler une taxe carbone ?". Après : "comment exécuter **légalement, fiablement et auditable** la collecte effective d'une taxe carbone sur 10 ans avec exclusivité ?".

### 2.2 Ce qui disparaît du scope initial

- ❌ **Simulation "ludique" pour le grand public** — peut rester en façade marketing, mais ce n'est plus le cœur. Le cœur est l'**opération de collecte réelle**.
- ❌ **Multi-pays africain générique** (ambition initiale) — à décoreller. Le décret ne couvre que le Somaliland. Tout discours "pan-africain" devient prématuré et doit être reporté à une phase 2 (après démonstration Somaliland).
- ❌ **Mode "information" libre** — il existe toujours, mais c'est le sous-produit, pas le produit.

### 2.3 Ce qui émerge comme priorité absolue

1. **Module "Shipping Carbon Assessment"** : calcul CO2 sur tonnage vessel × distance/durée escale.
2. **Module "Aviation Carbon Assessment"** : calcul CO2 sur cycles LTO (Landing/Take-Off) + cycle croisière.
3. **Facturation & encaissement** : génération d'une facture juridiquement opposable à l'armateur/compagnie aérienne.
4. **Répartition des revenus** : split automatique concessionnaire / souverain.
5. **Rapport mensuel MoECC** : format réglementaire, signé, horodaté.
6. **Registre blockchain** : ancrage immuable des transactions fiscales.
7. **Module capteurs IoT** : ingestion des données pollution aux sites concédés.

---

## 3. Ce qui existe déjà et qu'il faut préserver

D'après l'exploration du dépôt `africgreen/` :

| Actif existant | Réutilisable tel quel ? | Action |
|---|---|---|
| `backend/` (Go + Supabase) | Oui — stack correcte | **Conserver**, mais refactor domaine |
| `frontend/` (Next.js + TS + Tailwind) | Oui — PWA mobile-first | **Conserver**, rebrander UI vers Green-Gate |
| `docs/AFRICGREEN_COMPREHENSIVE_REQUIREMENTS.md` | Partiellement | À réviser, supprimer le périmètre "pan-africain" |
| `docs/AfricGreen_PRD_Complet_V7.docx` | Base de travail | Produire un **PRD v8 Green-Gate** qui le remplace |
| `docs/algo_calcul_simu/` | À valider | Vérifier la conformité au $40/tCO2 et à la méthodo IMO/ICAO |
| `i18n` (messages/) | Oui | Rebrand "Africgreen" → "Green-Gate" string-par-string |
| Supabase schema | À migrer | Ajouter tables concession, aviation, blockchain_anchor, revenue_split |

---

## 4. État cible à 12 mois (Dream State Mapping)

```
 ÉTAT ACTUEL (04/2026)      THIS PLAN                   CIBLE 12 MOIS (04/2027)
 ───────────────────        ─────────                   ──────────────────────
 • PRD v7 Africgreen        • Rebrand Green-Gate        • Système en production,
 • Backend Go/Supabase      • Refonte domaine métier      collecte active à Berbera
 • Frontend Next.js         • Ajout aviation              Port + aéroports intl
 • Scope simulation         • Module blockchain anchor  • Rapport MoECC mensuel
 • Mono-scope ports         • Module capteurs IoT         automatisé, signé
 • Sans cadre légal         • Module facturation        • Blockchain publique
 • Multi-pays en vision        juridique opposable        auditable par tiers
                            • Module rapport MoECC      • SLA 99.9% ingestion
                            • Split revenu auto           capteurs IoT
                                                        • Preuve de concept
                                                          réplicable → phase 2
                                                          pan-africaine
```

---

## 5. Alternatives d'Implémentation (Implementation Alternatives)

### Approche A — **Refactor Progressif** (recommandé par défaut)
- **Résumé** : Conserver le codebase `africgreen`, introduire Green-Gate comme couche nommée + nouveaux modules domaine (aviation, concession, blockchain anchor).
- **Effort** : M (équipe humaine : 3-4 mois) → avec CC/IA : ~3 semaines de travail dense
- **Risque** : Moyen — legacy sémantique persiste, risque de dette de branding
- **Pros** : Pas de rupture, réutilise i18n, Supabase, Next.js déjà en place
- **Cons** : Mémoire résiduelle "Africgreen" dans le code, confusion équipe
- **Réutilise** : tout le backend/frontend, refonte ciblée sur domaines fiscaux

### Approche B — **Green-Gate en nouveau module, Africgreen déprécié**
- **Résumé** : Créer un namespace `/green-gate/` frais (nouveau domaine Go + nouvelles pages Next.js), Africgreen reste mais est mis en mode "legacy read-only" / archivé.
- **Effort** : L (6 mois humain) → avec CC/IA : ~6-8 semaines
- **Risque** : Élevé (deux bases à maintenir pendant transition)
- **Pros** : Clean slate, pas de dette legacy, naming cohérent dès jour 1
- **Cons** : Duplication, double effort, retard pour la collecte effective
- **Réutilise** : Supabase instance, infra Fly.io/Vercel, patterns architecturaux

### Approche C — **Refonte totale "Green-Gate v1"**
- **Résumé** : Nouveau repo, nouveau nom, conserver uniquement les apprentissages conceptuels, stack identique.
- **Effort** : XL (9+ mois humain) → avec CC/IA : ~3 mois
- **Risque** : Élevé — on perd l'inertie acquise
- **Pros** : Aucune compromission sur le design, idéal pour une concession de 10 ans
- **Cons** : Temps perdu énorme, retard face aux attentes du MoECC
- **Réutilise** : Stack technique (Go, Supabase, Next.js), conventions

**RECOMMANDATION : Approche A** — Le décret entre en vigueur, la pression temporelle est réelle (rapport mensuel attendu au MoECC). La dette de branding interne est un problème résoluble par renommage progressif, alors que perdre 3-6 mois en refonte est un risque contractuel direct vis-à-vis du MoECC.

---

## 6. Architecture Cible (Section 1 — Architecture Review)

### 6.1 Diagramme de Système (nouveau périmètre)

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                          GREEN-GATE SYSTEM                                │
 │                      (concédé à Solide Technology)                        │
 └──────────────────────────────────────────────────────────────────────────┘
                                    │
      ┌─────────────────────────────┼─────────────────────────────┐
      ▼                             ▼                             ▼
 ┌──────────┐                 ┌──────────┐                 ┌──────────┐
 │ PORTS    │                 │ AÉROPORTS │                 │ ADMIN   │
 │ (Berbera │                 │ (intl)   │                 │ MoECC   │
 │ & autres)│                 │          │                 │         │
 └──────────┘                 └──────────┘                 └──────────┘
      │ AIS + tonnage              │ flight cycles LTO           │ Supervision
      │ + capteurs IoT             │ + ICAO emissions db         │ Rapports
      ▼                             ▼                             ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │                 INGESTION LAYER (event-driven)                        │
 │   • AIS feed (navires)    • Flight cycle feed    • Sensor MQTT/HTTP  │
 └─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │                 CARBON ASSESSMENT ENGINE                              │
 │   • Shipping module (tonnage × facteur IMO)                          │
 │   • Aviation module (LTO × facteur ICAO)                             │
 │   • Waste management module (Article 3.2)                            │
 │   → Output : tonnes CO2 certifiées × $40                             │
 └─────────────────────────────────────────────────────────────────────┘
                                    │
           ┌────────────────────────┼────────────────────────┐
           ▼                        ▼                        ▼
  ┌──────────────┐        ┌─────────────────┐       ┌──────────────┐
  │ INVOICING    │        │ BLOCKCHAIN      │       │ REVENUE       │
  │ Génère       │        │ ANCHOR          │       │ SPLIT         │
  │ facture      │───────▶│ Hash + ancrage  │◀──────│ Concess / État│
  │ juridique    │        │ chain publique  │       │               │
  └──────────────┘        └─────────────────┘       └──────────────┘
           │                                                │
           ▼                                                ▼
  ┌──────────────┐                              ┌──────────────────┐
  │ PAYMENT      │                              │ MoECC MONTHLY    │
  │ GATEWAY      │                              │ REPORT           │
  │ (armateur /  │                              │ (signé, horodaté)│
  │ compagnie)   │                              │                  │
  └──────────────┘                              └──────────────────┘
```

### 6.2 Couplage Préoccupant

- **Nouveau couplage** : Paiement ↔ Blockchain ↔ Rapport MoECC. Une panne de l'un bloque la chaîne légale. → Nécessité d'un **outbox pattern** pour garantir la livraison ancrée même en cas de panne blockchain temporaire.
- **Couplage IoT ↔ Calcul** : Si un capteur tombe en panne, faut-il bloquer la facturation ou utiliser une donnée fallback AIS/ICAO ? **Décision métier à prendre** — recommandation : fallback documenté + flag "données indirectes" sur la facture.

### 6.3 Points de défaillance unique à mitiger

1. **Blockchain indisponible** → outbox + retry exponentiel, sinon le concessionnaire est en défaut contractuel.
2. **Feed AIS coupé** → fallback manifeste portuaire (déclaratif armateur), avec audit MoECC obligatoire.
3. **Base Supabase** → read replica + backup quotidien + plan DR testé (exigence concession 10 ans).
4. **Certificat de signature des rapports MoECC** → rotation documentée, HSM si possible.

---

## 7. Modélisation de Données — Deltas Critiques

### 7.1 Nouvelles tables / entités

| Entité | Raison d'être | Champs critiques |
|---|---|---|
| `concession` | Tracer la concession 10 ans | `id`, `contractor (Solide Technology)`, `start_date`, `end_date`, `scope (ports/airports)`, `decree_ref` |
| `carbon_rate` | Versioning du tarif ($40 aujourd'hui) | `rate_usd_per_ton`, `effective_from`, `effective_to`, `legal_ref` (décret) |
| `vessel_assessment` | Calcul CO2 navire | `vessel_imo`, `gross_tonnage`, `port_call_id`, `co2_tons`, `amount_usd`, `method (AIS/declared/sensor)` |
| `flight_assessment` | Calcul CO2 vol | `flight_id`, `aircraft_type`, `lto_cycles`, `fuel_burn_kg`, `co2_tons`, `amount_usd` |
| `invoice` | Acte de taxation | `id`, `debtor (armateur/compagnie)`, `amount_usd`, `rate_applied`, `issued_at`, `blockchain_anchor_txid`, `legal_status` |
| `revenue_split` | Répartition | `invoice_id`, `concessionaire_amount`, `sovereign_amount`, `ratio_applied`, `settled_at` |
| `moecc_monthly_report` | Livrable contractuel | `period_yyyy_mm`, `total_collected_usd`, `signature_digest`, `submitted_at`, `blockchain_anchor` |
| `blockchain_anchor` | Preuve immuable | `payload_hash`, `chain (ex: Polygon)`, `tx_id`, `block_number`, `anchored_at` |
| `sensor_reading` | Capteurs IoT Article 4 | `site_id`, `pollutant`, `value`, `unit`, `observed_at`, `signature` |

### 7.2 Impact sur le schéma existant

Le dump `schema_dump.sql` présent dans la racine du projet doit être **diffé** contre ce modèle cible. Action concrète : produire des migrations Supabase versionnées (`supabase/migrations/`) pour chaque delta.

---

## 8. Error & Rescue Map (Section 2)

Ce tableau est **critique pour la responsabilité fiscale**. Chaque défaillance silencieuse = contentieux potentiel.

| Codepath | Défaillance possible | Classe d'exception | Rescue ? | Action de rescue | User/MoECC voit |
|---|---|---|---|---|---|
| `ShippingAssessmentService.compute()` | AIS data manquante | `AisDataMissingError` | Oui | Fallback manifeste + flag | "Calcul basé sur déclaration — non AIS" |
| idem | Tonnage hors plage plausible | `ImplausibleTonnageError` | Oui | Blocage facture + review humaine | Facture en attente |
| `AviationAssessmentService.compute()` | Type avion inconnu ICAO db | `UnknownAircraftTypeError` | Oui | Fallback catégorie générique | Flag "estimation approximée" |
| `BlockchainAnchor.anchor()` | Chaîne timeout | `BlockchainUnavailableError` | **Oui (outbox retry)** | Retry exponentiel, alerte si >1h | Aucun (transparent) |
| idem | Chaîne down >24h | `BlockchainExtendedOutageError` | Oui | Escalade ops + mode dégradé signé localement | MoECC informé dans rapport |
| `InvoiceService.issue()` | Débiteur introuvable | `DebtorNotFoundError` | Oui | Queue "review" | Invoice bloquée |
| idem | Montant = 0 anormal | `ZeroAmountAnomalyError` | Oui | Review + log | Anomalie tracée |
| `RevenueSplit.apply()` | Ratio concess/état non configuré | `SplitRatioMissingError` | Oui | Bloquer transfert + alerter | Fonds en suspens |
| `MoeccReportBuilder.generate()` | Période incomplète | `IncompletePeriodError` | Oui | Ne pas soumettre, alerter | Rapport retardé, MoECC prévenu |
| `SensorIngestion.consume()` | Payload non signé | `UnsignedSensorPayloadError` | Oui | Drop + audit log | Donnée non-admissible |
| `PaymentGateway.charge()` | Refus carte/virement | `PaymentDeclinedError` | Oui | Rappel armateur + délai légal | Facture reste due |

**Règle non négociable** : **aucun `catch (Exception e)` générique** dans le code métier fiscal. Chaque exception nommée = chaque cas légal distinct.

---

## 9. Sécurité & Threat Model (Section 3)

Parce que le système collecte de l'argent public pour le compte de l'État :

| Menace | Vecteur | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Manipulation du tonnage déclaré | Armateur corrompt la déclaration | Med | High | Double source AIS + sensor + blockchain anchor |
| Fraude au tarif | Altération du $40 en base | Low | Critical | Tarif en table versionnée + signée + référence décret |
| Accès non autorisé rapports MoECC | Compromission compte admin | Med | High | MFA obligatoire + audit trail + principe moindre privilège |
| Prompt injection sur LLM assistant (si présent) | Input utilisateur | Med | Med | Pas de LLM dans le chemin de calcul fiscal — isoler |
| Détournement du split revenu | Modif du ratio en base | Low | Critical | Ratio signé contractuellement + changement = approval multi-partie |
| Repudiation armateur ("je n'ai jamais reçu la facture") | Absence de preuve | Med | High | Blockchain anchor + signature à la remise |
| DoS ingestion IoT | Flood de paquets capteur | Med | Med | Rate limit + signature obligatoire |
| Supply chain (dep npm/go) | CVE dépendance | High | Med | SBOM + scan automatique CI + Dependabot |

---

## 10. Flux de Données & Edge Cases (Section 4)

Chaque nouveau flux de donnée doit tracer : happy / nil / empty / error.

**Exemple — Calcul CO2 navire** :

```
 INPUT (AIS + manifest)  ──▶ VALIDATION ──▶ COMPUTE ──▶ PERSIST ──▶ INVOICE
         │                     │              │           │           │
         ▼                     ▼              ▼           ▼           ▼
 [IMO inconnu?]        [tonnage hors      [facteur   [conflit     [débiteur
 [pas d'AIS?]           plage IMO?]        émission  port_call?]   introuvable?]
 [plusieurs             [date invalide?]   manquant?] [dup IMO?]   [devise?]
  escales concurrentes?]                              [DB down?]   [décret
                                                                    mis à jour?]
```

**Edge cases interactifs** :

| Interaction | Edge case | Traitement recommandé |
|---|---|---|
| Soumission facture | Double-soumission réseau | Idempotency key obligatoire |
| Paiement | Retour banque tardif | État "paid_pending_confirmation" |
| Rapport mensuel | Jour J fin de mois + décalage horaire Somaliland (UTC+3) | Timezone explicite + cutoff à 23:59 Africa/Mogadishu |
| Panne capteur en pleine escale | Fallback AIS | Flag "sensor_missing", documenté dans facture |
| Multi-devises (armateur étranger) | Conversion USD | Taux BCE du jour d'émission facture figé |

---

## 11. Observabilité & Debuggabilité (Section 8)

Exigences minimales (pas optionnelles sur un système de concession 10 ans) :

- **Logs structurés** (JSON) avec `request_id`, `vessel_imo`/`flight_id`, `invoice_id`, `user_id` admin, `chain_txid`.
- **Métriques** :
  - `invoices_issued_total` (counter, labels : site, type)
  - `co2_tons_assessed_total` (counter)
  - `revenue_collected_usd` (gauge + histogram)
  - `blockchain_anchor_latency_seconds` (histogram)
  - `sensor_reading_lag_seconds` (gauge par site)
  - `moecc_report_submission_status` (gauge)
- **Traces** cross-service : ingestion → calcul → invoice → anchor → report.
- **Alertes critiques** :
  - Report mensuel non soumis à J-2 de la deadline
  - Anchor blockchain failed >1h
  - Taux d'erreur invoice >2% sur 1h
  - Écart revenue_split vs contrat concession

---

## 12. Déploiement & Rollout (Section 9)

Le décret est déjà en vigueur depuis le **31 mars 2026**. Implication : on ne peut pas attendre un « Big Bang ». Approche recommandée — **rollout en 3 phases** :

### Phase 1 — Compliance Core (M+0 → M+2, urgent)
- Rebrand UI Africgreen → Green-Gate
- Table `carbon_rate` initialisée à $40/tCO2
- Module `ShippingAssessment` (Berbera Port en priorité)
- Génération facture juridique + PDF signé
- Rapport MoECC manuel mensuel (MVP) — premier livrable attendu : **fin avril 2026**

### Phase 2 — Automation & Aviation (M+2 → M+5)
- Module `AviationAssessment` (cycles LTO ICAO)
- Blockchain anchor automatique
- Split revenu automatisé (après signature accord concession finalisé)
- Ingestion capteurs IoT (sites prioritaires)

### Phase 3 — Industrialisation (M+5 → M+10)
- Dashboard MoECC self-service
- API publique consultation (transparence)
- Dégivrage rapports → 100% automatisés signés
- Plan DR testé, SLA publié

### Rollback
- Chaque phase sous feature flag (`feature_aviation`, `feature_blockchain_anchor`, `feature_auto_split`).
- Procédure documentée de rollback par flag.
- Migration Supabase : toutes **backward compatible** (add-only, pas de drop en phase 1).

---

## 13. Tests & Couverture (Section 6)

| Nouveau flux | Type de test | Priorité |
|---|---|---|
| Calcul CO2 shipping (happy + edge) | Unit + property-based | P0 |
| Calcul CO2 aviation | Unit + reference fixtures ICAO | P0 |
| Tarif versionné ($40 → futur changement) | Unit + regression | P0 |
| Génération facture + hash | Integration | P0 |
| Anchor blockchain (mock + testnet) | Integration | P0 |
| Rapport mensuel MoECC signature | Integration + e2e | P0 |
| Split revenu | Unit + accounting test | P0 |
| Ingestion capteurs signées | Integration + fuzzing | P1 |
| UI rebranding visuel | Visual regression (Playwright) | P1 |
| Load test port pic (1000 escales/jour) | Perf | P1 |

**Test de confiance** : peut-on soumettre un rapport mensuel signé à MoECC le vendredi à 17h depuis la production ? Si la réponse n'est pas "oui, sans stress", la phase 1 n'est pas prête.

---

## 14. Impact sur les Livrables Existants

### 14.1 Documents à retirer / archiver

- `docs/AfricGreen_PRD_Complet_V7.docx` → remplacé par le PRD v8 Green-Gate (à produire)
- `docs/AFRICGREEN_COMPREHENSIVE_REQUIREMENTS.md` → dépose les sections "pan-Africain" en `docs/olds/`
- `Rapport_Activite_Africgreen_2026-04-17.docx` → à renommer en rapport de transition vers Green-Gate

### 14.2 Documents à produire

1. **PRD v8 Green-Gate** (Product Requirements Document post-décret)
2. **Plan de migration nommage** (Africgreen → Green-Gate) : UI, docs, domaines DNS, email
3. **Contract Ops Runbook** (comment opérer la concession au quotidien)
4. **MoECC Report Template** (format contractuel du rapport mensuel)
5. **ADR-001 : Choix blockchain** (Polygon ? Cardano ? Chaîne privée ?)
6. **ADR-002 : Fallback capteurs défaillants**
7. **Guide de calcul CO2** (méthodologie IMO pour navires, ICAO pour avions)

---

## 15. Décisions à Prendre Maintenant (Temporal Interrogation)

Ces décisions ne peuvent pas attendre la phase d'implémentation — elles doivent être tranchées en amont :

| # | Décision | Options | Recommandation |
|---|---|---|---|
| D1 | Rebrand : refactor global ou alias progressif ? | A) Renommer tout // B) Alias UI + code legacy | **B** (approche A de la section 5) |
| D2 | Chaîne blockchain à utiliser | Public (Polygon/Eth) vs. privée | **Polygon** (coût faible, audit public, écosystème mature) |
| D3 | Split revenue : ratio concessionnaire/état | À négocier avec Min. Finance | Négocier + capter dans `concession` table versionnée |
| D4 | Méthodologie CO2 shipping | IMO MEPC.364(79) vs. EU ETS | **IMO MEPC** (aligné décret Article "IMO") |
| D5 | Méthodologie CO2 aviation | ICAO LTO cycle vs. CORSIA | **ICAO LTO** pour la base + CORSIA en phase 2 |
| D6 | Qui signe les rapports MoECC ? | Clé Solide Technology vs. co-signature | **Co-signature** : Solide + MoECC (qualified signature) |
| D7 | Stockage PII armateurs | Somaliland vs. UE | **Somaliland** (souveraineté des données État — cohérent concession) |
| D8 | Langue officielle UI/facture | EN, FR, SO | **EN + SO** minimum en Phase 1, FR en Phase 2 |

---

## 16. NOT in scope (hors périmètre)

Explicitement reportés :

- ❌ **Extension multi-pays africains** (phase 2, après démonstration Somaliland, 12+ mois)
- ❌ **Marketplace volontaire de crédits carbone** (distinct du mandat régulatoire)
- ❌ **App mobile native** (PWA suffit, aligné contrainte mobile-first existante)
- ❌ **Module waste management détaillé** (Article 3.2 — prévu mais en phase 3)
- ❌ **Interface publique grand public de simulation** (peut rester, mais non-prioritaire — l'essentiel est la collecte)

---

## 17. Scope Expansion Opportunities (à arbitrer)

Idées que le décret autorise mais qui ne sont pas mandataires :

| # | Opportunité | Effort | Pourquoi ça vaut la peine |
|---|---|---|---|
| E1 | API publique de transparence (stats agrégées CO2 collecté) | S | Renforce la légitimité du concessionnaire + pression régulatoire positive |
| E2 | Dashboard armateur self-service (historique + prévisions) | M | Fidélise les débiteurs, réduit le support |
| E3 | Preuve de réduction carbone (certificat délivré) | M | Valorise la contribution ; facteur différenciant |
| E4 | Simulation prédictive (ce qu'un navire paiera avant escale) | S | Évite les litiges, améliore l'UX armateur |
| E5 | Intégration directe avec capitaineries (port community system) | L | Réduit friction ingestion données manuelles |

Ces expansions ne doivent **pas** être décidées en lot — chacune mérite un arbitrage individuel avec le métier.

---

## 18. Dette Technique & Trajectoire Long Terme (Section 10)

- **Path dependency** : une fois la blockchain choisie, changer de chaîne = migration douloureuse → choisir avec soin.
- **Reversibility** :
  - Rebrand UI : 5/5 (trivial)
  - Modèle de données : 2/5 (migrations complexes une fois données en prod)
  - Blockchain choice : 1/5 (one-way door)
- **Question à 1 an** : un nouveau développeur qui arrive, peut-il lire ce plan et comprendre pourquoi on a un `rate_usd_per_ton = 40` versionné ? → **Oui, si on capte la référence décret dans la table**.
- **Knowledge concentration** : le savoir "IMO methodology" et "ICAO LTO" doit être documenté (guide de calcul CO2 — Livrable §14.2.7).

---

## 19. Matrice de Synthèse — Vision vs. Plan

```
 +========================================================================+
 |          GREEN-GATE — REVIEW STRATÉGIQUE — SYNTHÈSE                    |
 +========================================================================+
 | Mode sélectionné       | SCOPE REDUCTION (sur multi-pays)              |
 |                        | + HOLD SCOPE (sur Somaliland)                 |
 | Section 1 (Arch)       | 3 nouveaux modules (ship/avia/anchor)         |
 | Section 2 (Errors)     | 11 chemins de défaillance mappés              |
 | Section 3 (Sécurité)   | 8 menaces identifiées, 2 critiques            |
 | Section 4 (Data/UX)    | 4 nouveaux flux diagrammés                    |
 | Section 6 (Tests)      | 10 familles de tests P0/P1                    |
 | Section 8 (Observ)     | Stack logs+metrics+traces requis              |
 | Section 9 (Deploy)     | Rollout 3 phases sur 10 mois                  |
 | Section 10 (Trajec.)   | Reversibilité : 2/5 (blockchain = verrou)     |
 +------------------------------------------------------------------------+
 | NOT in scope           | Multi-pays, marketplace, app native           |
 | Décisions en attente   | 8 (D1–D8)                                     |
 | Nouveaux livrables doc | 7                                             |
 +========================================================================+
```

---

## 20. Prochaines Étapes Concrètes (Next 14 Days)

1. **Valider cette analyse** avec Solide Technology + MoECC focal point.
2. **Trancher D1–D8** (décisions bloquantes).
3. **Produire le PRD v8 Green-Gate** (remplace v7 Africgreen).
4. **Produire les 2 ADR critiques** (blockchain + fallback capteur).
5. **Planifier la migration nommage** UI + DNS + emails.
6. **Établir le template de rapport mensuel** MoECC (premier rapport attendu fin avril).
7. **Rebrand string-par-string** de `messages/` (i18n) en priorité.
8. **Créer les migrations Supabase** pour les nouvelles tables critiques (`carbon_rate`, `concession`, `invoice`, `blockchain_anchor`).

---

**Fin du document — v1.0 — 2026-04-19**

*Ce document est une analyse stratégique pure. Conformément aux instructions du projet, aucune modification de code n'a été effectuée. Il sert de base au PRD v8 à produire.*
