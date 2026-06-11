# GreenGate v8 — Architecture multi-tenant · multi-mode · multi-pays

> **Statut** : Plan validé — CEO + Eng + Design review CLEARED le 2026-06-01.
> **Source de vérité d'implémentation.** Décisions consolidées des 3 revues.
> Remplace la décision D1 (« repo neuf green-gate ») : on **évolue africgreen in-place**.

---

## 1. Contexte & problème

AfricGreen v7 = plateforme fiscale-carbone B2G **mono-tenant (Somaliland), mono-mode (maritime), USD figé**. Vision GreenGate (cf. `docs/Decisions_Tranchees_GreenGate_v2026-04-19.md`, `docs/NOTE_CONCEPTUELLE_GREENGATE_PANAFRICAIN_2026-05-09.md`) : ouvrir à plusieurs pays de la sous-région + ajouter l'aviation. **2 pays signés pour maritime ET aviation ; aviation Somaliland prioritaire ; chaque juridiction active maritime / aérien / les deux selon son accord.**

**Concept clé : tenant = juridiction-concession (un pays). Mode (maritime/aérien) = axe orthogonal. Activation = matrice configurable.**

```
                 jurisdiction_mode_config (la matrice)
                          MARITIME    AIR
   Somaliland               ✅         ✅ (prioritaire)
   Pays #2                  ✅         ✅
   Pays #3                  ✅         ❌  (selon accord)

   PRIX = méthodologie[mode](émissions) × tarif[juridiction,mode,catégorie,date] → split[juridiction,date]
            └ IMO MEPC.364(79) / ICAO LTO     └ versionné, signé          └ concessionnaire%/souverain% (D3)
```

---

## 2. Décisions d'architecture

| Axe | Décision | Réversibilité |
|---|---|---|
| Build | Évolution in-place (strangler) ; D1 dépréciée | 4/5 |
| Tenant | Hybride promouvable : pool RLS par défaut, silo projet/pays si clause résidence (D7) | 4/5 |
| Mode | Cœur discriminé + adaptateurs ; `calculator[mode]` (IMO maritime / ICAO LTO aérien) dans le backend Go | 4/5 |
| Payeur | `shipowners` généralisé en entité `operator` (réutilise wallets/payments/refunds/KYC/notifications) | 4/5 |
| Identité actif | `vessels` (maritime, intact) + `aircraft` (nouveau) — identités IMO/ICAO disjointes | 4/5 |
| Ancrage | Polygon factures seules ; seam tarif/split réservé (signature_hash) | 5/5 |

### Isolation DUALE (correction clé de la revue)
```
   POOL : isolation par CLAIM RLS jurisdiction_id   (1 projet, N pays)
   SILO : isolation par FRONTIÈRE DE PROJET          (auth/GoTrue/JWT propres — un claim du pool n'est PAS valide)
   resolveTenant() route le bon contexte d'AUTH *et* le bon client.
   Le wrapper repository injecte jurisdiction_id dans LES DEUX cas (défense en profondeur).
   Promotion pool→silo = pipeline de migration automatisé (lignes + auth.users + storage), PAS un flag — mais zéro réécriture de schéma.
```

---

## 3. Architecture cible

```
        ┌────────────────────────── CONTROL-PLANE (léger) ──────────────────────────┐
        │  jurisdictions · jurisdiction_mode_config · methodologies                  │
        │  analytics pan-africain (agrégats) · ancrage Polygon (D2) · portail MoECC  │
        └───────────────┬───────────────────────────────────┬───────────────────────┘
                        │ resolveTenant() → {jurisdictionId, mode, dataPlane, authContext}
        ┌───────────────▼──────────────┐        ┌─────────────▼────────────────────┐
        │ DATA-PLANE POOL (région UE)  │        │ DATA-PLANE SILO pays sensible     │
        │ jurisdiction_id + RLS        │        │ (projet Supabase souverain, D7)   │
        │ COUCHE PARTAGÉE :            │        │ même schéma, même code            │
        │  alertes · paiements/wallets │        └───────────────────────────────────┘
        │  tariffs · revenue_split·RLS │
        │  vessels(SO,SN) aircraft(SO,SN)│    calc Go : calculator[MARITIME]=IMO  calculator[AIR]=ICAO LTO
        └──────────────────────────────┘
```

### Seam de résolution
- `getTenantContext(request) → { jurisdictionId, mode, dataPlane, authContext }`. Source : claim JWT (authentifié) ; flux anonymes (signup, payment-availability) → sous-domaine/path.
- `dataPlaneClientFactory(jurisdictionId)` : client pool partagé OU client projet silo (secrets per-silo en Vault/KMS).

---

## 4. Modèle de données (deltas)

**Control-plane :**
```sql
CREATE TABLE jurisdictions ( id UUID PK, code TEXT UNIQUE, name TEXT, default_currency CHAR(3),
  data_plane TEXT CHECK (data_plane IN ('POOL','SILO')) DEFAULT 'POOL', data_plane_ref TEXT,
  sovereign_region TEXT, regulator_name TEXT, locales TEXT[],  -- locales par juridiction
  status TEXT CHECK (status IN ('DRAFT','ACTIVE','SUSPENDED')) );

CREATE TABLE jurisdiction_mode_config ( jurisdiction_id UUID REFERENCES jurisdictions, mode transport_mode,
  enabled BOOLEAN DEFAULT FALSE, methodology_id UUID, geofence_ref TEXT, activated_at TIMESTAMPTZ,
  PRIMARY KEY (jurisdiction_id, mode) );
```

**Data-plane :**
```sql
CREATE TYPE transport_mode AS ENUM ('MARITIME','AIR');   -- extensible RAIL/ROAD

-- discriminateurs (défaut rétro-compatible) — voir §5 pour la migration PHASÉE
ALTER TABLE transactions   ADD jurisdiction_id UUID, ADD mode transport_mode DEFAULT 'MARITIME';
ALTER TABLE arrival_alerts ADD jurisdiction_id UUID, ADD mode transport_mode DEFAULT 'MARITIME', ADD distance_m NUMERIC;
ALTER TABLE vessels        ADD jurisdiction_id UUID;   -- mode implicite MARITIME
ALTER TABLE shipowners     ADD applicable_modes transport_mode[];  -- généralisation operator (5A)

CREATE TABLE tariffs ( id UUID PK, jurisdiction_id UUID, mode transport_mode, asset_category TEXT,
  jurisdiction_zone TEXT, base_rate_per_tco2 NUMERIC, currency CHAR(3), multiplier NUMERIC,
  effective_from DATE, effective_to DATE, status TEXT, decree_ref TEXT, signature_hash TEXT,
  EXCLUDE USING gist (...)  -- pas de chevauchement de dates par clé
  );

CREATE TABLE revenue_split_rule ( jurisdiction_id UUID, effective_from TIMESTAMPTZ, effective_to TIMESTAMPTZ,
  concessionaire_pct NUMERIC, sovereign_pct NUMERIC, currency CHAR(3), contract_ref TEXT, signature_hash TEXT,
  CHECK (concessionaire_pct + sovereign_pct = 100) );

CREATE TABLE methodologies ( id UUID PK, mode transport_mode, code TEXT, version TEXT, params JSONB );
CREATE TABLE aircraft ( id UUID PK, icao_type TEXT, registration TEXT, operator_id UUID, mtow_kg INT,
  engine_type TEXT, jurisdiction_id UUID );
CREATE TABLE air_emission_factors ( icao_type TEXT, engine_type TEXT, co2_kg_per_lto_cycle NUMERIC,
  source TEXT, effective_from DATE );
CREATE TABLE user_jurisdictions ( user_id UUID, jurisdiction_id UUID, PRIMARY KEY (user_id, jurisdiction_id) );
```

La transaction **snapshot `tariff_version_id` + l'unité d'origine** (correction billing : les factures émises ne changent jamais).

### RLS
```sql
-- helper SECURITY DEFINER STABLE (perf — évalué 1x/requête)
CREATE FUNCTION current_jurisdiction_ids() RETURNS uuid[] STABLE SECURITY DEFINER ...;
-- politique par table tenant-scopée
USING ( jurisdiction_id = ANY(current_jurisdiction_ids()) AND <règles rôle/relation existantes> )
```
Index chauds existants recréés préfixés `jurisdiction_id` (`CREATE INDEX CONCURRENTLY`).

---

## 5. Séquence d'exécution (phasée)

```
0a. SCHÉMA ADDITIF (sûr) : colonnes NULLABLE + DEFAULT → backfill par lots → ADD CONSTRAINT NOT VALID
    → VALIDATE CONSTRAINT → index CONCURRENTLY. Expand/contract. Ship + bake en prod.
0b. RE-CLÉ COMPORTEMENTALE (migration séparée, feature-flag) : tarifs/calc sur (juri,mode), matrice,
    registre calculator, methodologies.
0c. SÉCURITÉ (1er rang) : wrapper TenantScopedClient (injecte jurisdiction_id, lint anti service-role nu),
    crons itèrent les juridictions (pas de JWT), tests d'isolation pg par table. ← pendant qu'il n'y a que Somaliland
        ▼
1. WEDGE 1 ⭐ AVIATION SOMALILAND : calculator['AIR'] ICAO LTO (Go), aircraft + air_emission_factors (ICAO EDB),
   géofence FIR, onboarding transitaire aérien (réutilise /owner).
        ▼
2. WEDGE 2 MULTI-PAYS : onboarder pays #2 (maritime + aviation), control-plane registry, RLS durcie cross-tenant,
   revenue_split_rule, hybride promouvable, analytics pan-africain.
        ▼
3. FUTUR : rail/route via calculator[mode] additionnel.
```

**GATE sécurité :** la suite de tests d'isolation pg (juridiction A ne lit jamais B, par table) doit être verte **avant tout onboarding du pays #2**.

---

## 6. Calcul & moteur

`calculator[mode]` vit dans le **backend Go** (étend l'autorité IMO existante). Contrat Next.js→Go : `{mode, methodology_version, jurisdiction}`. MARITIME = IMO MEPC.364(79) (existant) ; AIR = ICAO LTO (cycles LTO × facteur EDB ; fallback MTOW + flag « estimation approximée » si type hors EDB). **Règle fiscale : tarif/split manquant → fail-closed + alerte, JAMAIS un montant 0 silencieux.**

---

## 7. Sécurité (threat model — extrait)

| Menace | Vrais. | Impact | Mitigation |
|---|---|---|---|
| Fuite cross-tenant via service-role sans filtre | Haute | **Critique** (inter-États) | Wrapper tenant-scopé + lint + tests pg + RLS défense profonde |
| Spoof claim jurisdiction_id | Moyenne | Critique | Claim posé serveur au login (app_metadata) |
| RLS manquante sur nouvelle table | Moyenne | Critique | `.test.sql` d'isolation par table (pattern existant) |
| Altération tarif/décret/split | Faible | Critique | signature_hash (D6) + ancrage Polygon (D2) + RLS write SUPERADMIN/FINANCE |
| Pays A voit analytics de B | Moyenne | Élevé (politique) | Analytics sur agrégats anonymisés, pas de drill-down cross-pays |

---

## 8. Décisions design (App UI emerald « lux », réutilise Os*)

- **IA** : portail `/owner` UNIFIÉ, mode = contexte (pas de `/air` séparé). Switcher de juridiction en header (dropdown si multi-pays, label statique si mono). Filtre de mode + badges navire/avion. Flotte unifiée vessels+aircraft.
- **États** : table empty/loading/erreur/partiel par surface. Tarif non publié = banner alert (jamais 0$). Flag « estimation approximée » (jaune, transparence) si aéronef hors EDB.
- **Parcours** : onboarding transitaire aérien miroir du maritime (mêmes composants).
- **Matrice `jurisdiction_mode_config`** : ligne par juridiction + 2 pills de mode (`OsBadge`) + date d'activation. Pas de grille de toggles générique.
- **Locales PAR JURIDICTION** (langue = attribut de juridiction) ; Somaliland = so/ar/en (+`so` à ajouter).
- **Multi-devise** : **USD principal + référence devise locale + taux figé horodaté** ; code ISO devise (XOF≠XAF) ; RTL via `Intl.NumberFormat`.
- Réutilise les primitives `Os*` ; pas de nouveau primitive avant 3+ appelants.

---

## Wedge 2 — LIVRÉ (2026-06-11)

### Ce qui a été livré

| Composant | Description |
|---|---|
| **Mig 080** | Table `tariffs` versionnée — tarifs par juridiction/mode/catégorie avec `effective_from/to`, `signature_hash`, exclusion de chevauchement de dates. Seed Somaliland maritime + air. Colonne `tariff_id` snapshottée sur `transactions` UNIQUEMENT. |
| **RPC mig 084** | `create_tariff_version(jurisdiction_id, mode, ...)` — atomique, dates strictement futures, vérifie l'unicité avant insertion. |
| **Mig 081** | Table `revenue_split_rule` — split concessionnaire%/souverain% versionné par juridiction, `signature_hash`, contrainte `concessionaire_pct + sovereign_pct = 100`. |
| **Mig 082** | Table `geofences` avec FIR Djibouti polygonale + onboarding juridiction DJ `'00000000-0000-4000-8000-00000000444a'` maritime+air. |
| **Mig 083** | Colonne `vessels.last_zone_jurisdiction_id` (suivi (zone, juridiction) par le tracker — hops EEZ→EEZ inter-juridictions). |
| **Go `internal/geofence`** | Store geofence DB-backed avec cache 60s TTL ; détection multi-juridiction via ray-cast point-in-polygon (abutting FIRs SO\|DJ désambiguisés par le demi-ouvert partagé — identique au Go `internal/fir`). |
| **ADS-B ingest multi-juridiction** | Route `/api/adsb/ingest` charge les FIR depuis `public.geofences` (mig 082), résout `jurisdiction_id` du matched ring plutôt que hardcodé SO. |
| **Pipelines jurisdiction + tariff_id** | `proformaPipelineService` + `reconcilePipelineService` passent `jurisdiction_id` + `as_of` (= date d'émission de la proforma, pas aujourd'hui) au calculateur Go ; snapshotent `tariff_id` sur la transaction ; fail-closed si tarif absent. |
| **Go calculateurs tariff-aware** | `internal/tariff` charge le tarif actif depuis la DB (par `jurisdiction_id` + `mode` + `as_of`) ; les calculateurs MARITIME + AIR utilisent ce tarif ; fail-closed si absent. |
| **Switcher de juridiction staff** | Cookie httpOnly `gg-active-jurisdiction` ; action `setActiveJurisdiction` (valide l'appartenance RLS avant d'écrire) ; `JurisdictionSwitcher` composant client dans la sidebar (0 membership = caché, 1 = label statique, >1 = dropdown). `ACTIVE_JURISDICTION_COOKIE` exporté de `tenantContext.ts`. |
| **`getServerJurisdictionId` multi-pays** | Lit le cookie `gg-active-jurisdiction` pour les staff multi-juridiction ; résolution validée contre les memberships, FAIL-CLOSED sans cookie valide (l'UI auto-sélectionne via l'action validée `setActiveJurisdiction`). |
| **Admin `/admin/jurisdictions`** | Registry des juridictions : mode matrix (maritime/air pills), tarifs versionnés par mode, RPC `create_tariff_version`. |

### Limitations connues / fast-follows

1. ✅ **LIVRÉ W3** ~~`jurisdiction_mode_config.enabled` non consulté par la détection/billing~~ — enforcement complet : `disabled = stop nouvelles détections/alertes ; voyages en cours complètent ; API calc ouverte ; ligne matrice absente = désactivé`. Test pg 085 valide « mode désactivé → zéro alertes ». **Note ops** : les alertes DETECTED/PROFORMA_SENT créées avant un disable restent actives jusqu'au prochain voyage — comportement attendu.
2. **Simulateur staff lit `tax_configurations` (table legacy)** — bannière posée dans l'UI ; convergence vers la table `tariffs` = follow-up.
3. **Visibilité multi-juridiction des vessels** — `vessels.jurisdiction_id` est scopé SO par défaut ; les opérateurs DJ sont onboardés en pattern admin AOC (pas de self-service public cross-pays).
4. **Corridor stamping PROVISOIRE** — nearest-port ≤ 500nm ; ré-résolution par destination matching à prévoir (follow-up).
5. **Signup public multi-pays différé** — opérateurs Djibouti = onboarding admin pattern AOC (même chemin que l'aérien Somaliland).
6. **Analytics pan-africain différé** — agrégats cross-juridiction non implémentés (§9 NOT in scope v8 initial).
7. ✅ **FONDATIONS LIVRÉES W3** ~~Settlement du revenue split différé~~ — snapshot `split_rule_id` à l'émission (mig 085 + trigger backfill) ; vue `v_revenue_split_settlement` avec buckets gross/attributed/unattributed/mismatched exposée sur `/admin/jurisdictions`. Décaissement TOUJOURS différé — escrow Min. Finance hors scope v8.
8. **/admin/jurisdictions lit le control-plane via client plateforme : les % de partage de toutes les juridictions sont visibles par tout staff ayant accès à la page — à re-scoper quand du staff local mono-juridiction existera.**

### Note de déploiement

**Migs 080-084 AVANT le déploiement du backend Go.** Le calculateur est fail-closed (`tariff not found → error`) ; lancer le Go avant les migs produirait des erreurs de calcul immédiates. Même release : `supabase db push` → deploy Go.

---

## Wedge 3 — LIVRÉ (2026-06-11)

| Composant | Description |
|---|---|
| **Mig 085** | Colonne `transactions.split_rule_id` (FK → `revenue_split_rule`) snapshottée à l'émission via trigger `trg_stamp_split_rule_id` + backfill des transactions existantes. |
| **Mig 086** | Vue `v_revenue_split_settlement` — buckets gross/attributed/unattributed/mismatched par juridiction + mode + mois ; `GRANT SELECT` service_role uniquement. |
| **Go `internal/modeconfig`** | Package DB-backed qui lit `jurisdiction_mode_config` et expose `IsModeEnabled(jurisdictionID, mode)` avec cache 30s. |
| **Gating corridor + tracker** | `proformaPipelineService` et `trackVesselEntryExit` vérifient `modeconfig.IsModeEnabled` avant de créer des alertes ; incrémentent le compteur `alerts_skipped_disabled`. |
| **Gating ADS-B ingest** | `/api/adsb/ingest` appelle `IsModeEnabled(jurisdiction, AIR)` ; saute silencieusement les positions si l'air est désactivé pour la juridiction matchée. |
| **UI settlement** | Onglet « Settlement » sur `/admin/jurisdictions` : totaux gross/attribués/non-attribués + badge « mismatched » ; disclosure « Décaissement via escrow Min. Finance — hors scope v8 ». |
| **CI healthcheck** | `healthcheck` ne dépend plus du job Vercel opt-in (`needs: [deploy, backend]` → `needs: [backend]`) — le check PRODUCTION_URL reste valide via l'intégration Vercel native. |

### Note de déploiement

**Migs 085-086 AVANT ou avec le déploiement du backend Go.** Le package `internal/modeconfig` lit `jurisdiction_mode_config`, table existante depuis la mig 071 — pas de hard-fail si le Go est livré légèrement avant les migs (la matrice sera simplement vide = fail-open par défaut). Même release recommandée : `supabase db push` → deploy Go.

---

## 9. NOT in scope (v8 initial)

Rail/route ; bascule primaire UE→Somaliland (D7, infra locale) ; portail MoECC complet (D6) ; ancrage on-chain tarifs/splits (seam réservé) ; analytics pan-africain riche.

## 10. Points ouverts

- **Résidence des données du pays #2** → pool ou silo (cadrage Wedge 2).
- Rebranding nominal « GreenGate » (UI/domaine) : maintenant ou plus tard.
- Topologie de calcul AIR confirmée dans Go (1A) ; relecture native locales (so/ar/sw) — cf. `TODOS.md`.

---

*Issu de /plan-ceo-review + /plan-eng-review + /plan-design-review, 2026-06-01. Plan local : `~/.ostack/projects/africgreen/ceo-plans/2026-06-01-greengate-multitenant.md`.*
