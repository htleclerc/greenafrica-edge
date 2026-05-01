# Plan Phase 2 — Green-Gate (post-MVP carbone)

| | |
|---|---|
| **Date** | 2026-04-24 |
| **Statut** | DRAFT — à valider avec Solide Technology + MoECC focal point |
| **Auteur** | Autoplan T3 (faisait suite au review du plan v1.0 du 2026-04-19) |
| **Supersedes** | Phase 2/3 du `Plan_Developpement_GreenGate_v2026-04-19.md` (SUPERSEDED) — sections §11, §12, §17 |
| **Pre-requis** | Plans 1-5 stables en production (P0 backlog ROADMAP : B0 CORS, B1 worker secret, B2 auth approve role bug) |
| **Référence légale** | Décret MoECC Ref. MOE&CC/mi/36/2026 du 31 mars 2026 |
| **ADR liés** | [ADR-001 — Hash-chain vs Polygon](adr/ADR-001-immutable-anchor-hash-chain-vs-polygon.md) |

---

## 0. TL;DR

Phase 2 finit ce que la Phase 1 (MVP carbone) n'a délibérément pas fait, dans cet ordre de priorité :

1. **MoECC monthly report** (livrable contractuel — à industrialiser avant qu'un humain n'ait à composer un PDF chaque fin de mois)
2. **Rebrand i18n Africgreen → Green-Gate** (string-by-string, 5 locales) + bascule DNS/email progressive
3. **Concession + revenue_split** (split automatique souverain/concessionnaire après finalisation accord Min. Finance)
4. **Aviation module** (cycles LTO ICAO — selon échéancier décret pour les aéroports)
5. **Sensor IoT ingestion** (Article 4, dernier livrable opérationnel)
6. **Public verify endpoint + root hash publication** (cf. ADR-001 — fonde la vérifiabilité tierce du hash-chain)

**Out of scope explicite** : extension multi-pays africains, marketplace volontaire de crédits, app mobile native, refonte du domaine `africgreen` → `green-gate` côté code (le code reste, seul l'i18n et le DNS public migrent).

---

## 1. Pré-requis bloquants (à clore avant de démarrer Phase 2)

Issus de [`docs/superpowers/ROADMAP.md`](superpowers/ROADMAP.md) §P0 :

| ID | Sujet | État | Action |
|---|---|---|---|
| B0 | CORS credentials mismatch local Supabase | identifié | rester sur hosted Supabase pour dev, ou patch Kong |
| B1 | `QUEUE_WORKER_SECRET` env injection | identifié | injecter au démarrage du dev server, sécuriser CI |
| B2 | `auth/approve` role bug | identifié + 10 régression tests | déjà fixé sur `develop` |
| B3 | Migration NET-30 mig 022 (uncommitted) | en attente commit | committer + intégrer aux tests d'intégration |
| B4 | Live smoke test signup → validations → approve sur hosted | non fait | 30 min — doit passer avant Phase 2 |
| B5 | E2E pgmq round-trip (proforma + reconciliation) | DONE_WITH_CONCERNS | re-run avec env secret en place |

**Règle** : aucun module Phase 2 ne démarre tant que B0-B5 ne sont pas verts. Sinon on empile de la dette sur de la dette.

---

## 2. Module M1 — MoECC monthly report (P0 contractuel)

### Pourquoi en premier
Premier rapport mensuel attendu fin avril. Si on ne l'industrialise pas, on est dépendant d'un humain composant un PDF à la main, ce qui :
- introduit un risque d'erreur fiscale
- consomme un dev senior chaque fin de mois
- n'est pas signé/horodaté de manière reproductible

### Scope
1. Table `moecc_monthly_report` :
   ```
   id, period_yyyy_mm UNIQUE, total_collected_usd, total_co2_tons,
   transactions_included_count, payload_hash, signature_digest,
   submitted_at, submitted_by, root_hash_at_submission,
   status (DRAFT | SIGNED_SOLIDE | CO_SIGNED_MOECC | SUBMITTED | DISPUTED),
   created_at
   ```
2. Cron mensuel (J+1 du mois suivant à 02:00 Africa/Mogadishu) qui :
   - agrège `transactions` du mois précédent (FINAL/COMPLEMENT/REFUND seulement, pas PROFORMA)
   - compose le payload (JSON normalisé)
   - signe avec la clé Solide via KMS (cf. D6 du `Decisions_Tranchees`)
   - persiste en `moecc_monthly_report`
   - notifie un Port Officer pour relecture humaine
   - génère un PDF + envoie par email à un point focal MoECC (avec lien vers `/admin/reports/{id}` pour co-signature)
3. UI `/admin/reports` :
   - liste paginée des rapports
   - vue détail avec breakdown par catégorie de navire, par armateur top-N, écart vs mois précédent
   - bouton co-signature (MoECC seulement, MFA requise) qui transitionne `SIGNED_SOLIDE → CO_SIGNED_MOECC`
   - bouton de soumission finale (transitionne vers `SUBMITTED`)
4. Endpoint public `/verify/report/{period_yyyy_mm}` exposant le payload + signatures + chaîne jusqu'au root hash de la période.

### Décisions à trancher avant code
- **D6-A** : MoECC signe via portail web Green-Gate (auth dédiée) ou via export PDF + signature externe ? Recommandation : portail web (cohérent §D6 du Decisions_Tranchees).
- **D6-B** : que faire si MoECC ne signe pas dans X jours ? Recommandation : 10 jours ouvrés → escalation par email à un seuil supérieur ; statut `SUBMITTED` quand même au J+30 (Solide a satisfait son obligation), MoECC reste en charge de signer.
- **M1-C** : comment représenter une dispute *post-soumission* d'un armateur sur un mois déjà clos ? Recommandation : ne pas modifier le rapport ; émettre un addendum signé en mois N+k référençant le rapport originel (pattern `supersedes_event_id` étendu aux rapports).

### Tests
- Unit : agrégation déterministe sur fixtures (FINAL only, exclusions REFUND négatif, devises figées)
- Integration : cron simulé sur snapshot DB + génération PDF + signature
- E2E : workflow Port Officer review → MoECC co-signature → submission

### Effort
Boilable lake — humain ~3 sem / CC+ostack ~1 sem.

---

## 3. Module M2 — Rebrand i18n Africgreen → Green-Gate

### Scope
1. **String-by-string** sur les 5 locales (`en`, `fr`, `ar`, `pt`, `sw`) dans `frontend/messages/`. Comptes actuels : `en.json:71` matches "africgreen", `fr.json:71`, `ar.json:49`, `pt.json:62`, `sw.json:61`.
2. Conserver le code domain `africgreen` (slug projet, noms de tables, packages Go) — uniquement le branding utilisateur change.
3. **Logo + favicon** — assets à produire (hors scope dev, requiert designer). TODO marker.
4. **DNS / email** — bascule progressive : maintenir `*.africgreen.*` redirigeant vers `*.green-gate.*` pendant 6 mois. Templates email Resend mis à jour.
5. **Métadonnées SEO** + balises Open Graph (`frontend/src/app/layout.tsx`).
6. PDF templates (factures, cover letters) → entête « Green-Gate » + bandeau « Concession officielle, décret MOE&CC/mi/36/2026 » (cf. ADR-001 §publication root hash).

### Décisions à trancher
- **M2-A** : faut-il un *cutover* unique (jour J tout passe en Green-Gate) ou un *opt-in* progressif via feature flag par utilisateur ? Recommandation : cutover unique sur l'i18n (les strings ne se mélangent pas), mais opt-in progressif sur DNS (pour éviter de casser des bookmarks armateur).
- **M2-B** : Solide Technology mentionné où ? Recommandation : pied de page de chaque PDF + section "À propos" du portail.

### Tests
- Visual regression Playwright sur 5 locales × 4 pages clés
- Test grep `assert frontend/messages/*.json contient 0 occurrence "africgreen"` post-bascule
- E2E : envoi d'une facture par email → vérifier subject + corps + PDF tous brandés

### Effort
Tactique — humain ~1 sem / CC+ostack ~1-2 jours.

---

## 4. Module M3 — Concession + revenue_split

### Pré-requis externe
**Bloqué tant que la négociation Min. Finance (D3) n'est pas conclue**. Le ratio concessionnaire/souverain doit être fixé contractuellement avant tout code.

### Scope
1. Table `concession` :
   ```
   id, contractor (Solide Technology), start_date, end_date, scope (ports, airports),
   decree_ref, signed_at, signed_by_solide, signed_by_moecc,
   ratio_concessionnaire NUMERIC(5,4), ratio_sovereign NUMERIC(5,4)
       CHECK (ratio_concessionnaire + ratio_sovereign = 1.0)
   ```
   Versionnée : changer le ratio = nouvelle ligne avec date d'effet, pas UPDATE.
2. Table `revenue_split` :
   ```
   id, transaction_id FK, concession_id FK,
   concessionaire_amount_usd, sovereign_amount_usd,
   ratio_applied (snapshot du ratio au moment de l'application),
   computed_at, settled_at, settlement_ref
   ```
3. Cron quotidien : pour chaque transaction `RECONCILED` non encore split → créer `revenue_split`, transférer fonds via PSP (mécanisme à définir avec banque).
4. UI `/admin/revenue` : vue des splits, montants en attente de settlement, historique signé.

### Décisions à trancher
- **M3-A** : settlement réel (vraie virement via API banque) ou ledger comptable seulement avec virement manuel mensuel ? Recommandation : ledger seulement en V1, virement manuel mensuel sur signature humaine — cohérent avec MoECC monthly report.
- **M3-B** : que faire si une transaction est REFUND après settlement ? Recommandation : compensation par split négatif sur transaction suivante, jamais de claw-back rétroactif côté souverain.

### Tests
- Property-based : pour tout `transaction.amount_usd`, `concessionaire + sovereign = amount` à 1 cent près
- Integration : workflow complet RECONCILED → split → settlement → audit

### Effort
Humain ~2 sem / CC+ostack ~3-5 jours, **après** signature ratio.

---

## 5. Module M4 — Aviation (cycles LTO ICAO)

### Pré-requis externe
- Liste officielle des aéroports concernés (probable : tous les aéroports internationaux du Somaliland)
- Source de données vols : équivalent AIS pour aviation. Options :
  - ADS-B Exchange / OpenSky Network (public, free tier)
  - Données de capitainerie aéroportuaire (déclaratif, fiable mais latent)
  - FlightAware / Cirium (paid, premium)

### Scope
1. Table `flight_assessment` :
   ```
   id, flight_id (callsign + date), aircraft_type (ICAO designator),
   origin_airport, destination_airport, lto_cycles NUMERIC,
   fuel_burn_kg, co2_tons, amount_usd,
   method (ADS-B | DECLARED | SENSOR),
   created_at, transaction_id FK NULL
   ```
2. Table `emission_factors_aviation` (analogue à `emission_factors` maritime) seedée depuis ICAO Aircraft Engine Emissions Databank.
3. Service Go `internal/aviation/` : ingestion flux + calcul LTO + pousser dans pipeline tax.
4. UI `/dashboard/incoming-flights` (pendant aviation de `/dashboard/incoming-vessels`).
5. Réutiliser le pipeline pro-forma → reconciliation existant (génération facture, escalation, etc.) — le différenciateur est uniquement la source de l'événement et la méthode de calcul.

### Décisions à trancher
- **M4-A** : on calcule les émissions LTO seulement (cycle aéroport ≈ 0.07 t CO2 / cycle pour A320) ou aussi le cruise (départ/arrivée long-courrier au pro-rata d'espace aérien somalien) ? Recommandation : LTO seulement V1 (aligné §D5 Decisions_Tranchees), CORSIA/cruise en V2.
- **M4-B** : qui est le débiteur ? Compagnie aérienne ou opérateur du vol ? Recommandation : opérateur (équivalent shipowner), avec règle de cascade similaire pour les vols affrétés.

### Tests
- Reference fixtures ICAO sur ~10 types d'avion courants
- Property-based : LTO × facteur ICAO × $40 = facture, à 1 cent
- E2E : vol simulé → facture → email opérateur

### Effort
Humain ~2 mois / CC+ostack ~2-3 sem.

---

## 6. Module M5 — Sensor IoT ingestion (Article 4)

### Scope
Article 4 du décret cite la traçabilité des capteurs sur les sites concédés.

1. Table `sensor_reading` :
   ```
   id, site_id, sensor_id, pollutant_type (CO2 | SO2 | NOx | PM2.5),
   value NUMERIC, unit, observed_at, ingested_at,
   payload_signature (signed by sensor's HSM), payload_hash
   ```
2. Endpoint `/api/v1/sensor/ingest` (Go), authentification par signature payload (clé publique enregistrée par site_id).
3. Validation à l'ingestion : drop si signature invalide → audit log de la tentative.
4. UI `/admin/sensors` : statut de chaque site, alerte si `sensor_reading_lag_seconds > 600s` (5 min sans signal).
5. **Intégration tax** : pour les transactions où une donnée capteur est disponible et significativement divergente du calcul AIS-based, déclencher un workflow review (cf. `ImplausibleTonnageError` du plan v1).

### Décisions à trancher
- **M5-A** : capteur en panne → bloquer la facturation ou utiliser AIS fallback ? Recommandation : AIS fallback **avec flag explicite sur la facture** (`method=AIS_FALLBACK_SENSOR_DOWN`), audit log, alerte ops. ADR-002 à produire.
- **M5-B** : qui fournit les capteurs et leur calibration ? Solide ou sous-traitant tiers ? — décision opérationnelle hors dev.

### Tests
- Fuzzing sur payloads capteur (signatures invalides, valeurs hors plage, replay attacks)
- Integration : ingestion + persistence + lag detection

### Effort
Humain ~2 mois (incl. déploiement physique capteurs) / dev pur CC+ostack ~1-2 sem.

---

## 7. Module M6 — Public verify endpoint + root hash publication

### Pourquoi
Fonde la vérifiabilité tierce du hash-chain (cf. [ADR-001](adr/ADR-001-immutable-anchor-hash-chain-vs-polygon.md)). Sans ce module, l'argument « hash-chain satisfait Article 4 » est faible : les tiers ne peuvent vérifier que par confiance dans Solide.

### Scope
1. Endpoint public `/verify/{type}/{id}` (sans auth) :
   - `type=invoice|report|event`
   - retourne payload normalisé + chaîne de hashs jusqu'au root hash le plus récent + signature root
2. Cron mensuel : à J+5 chaque mois, calcule le root hash de la période close, le signe (Solide + MoECC quand co-signature en place), publie un PDF signé sur le portail MoECC public.
3. Documentation publique de la procédure de vérification (markdown public + cli simple `green-gate-verify`).

### Tests
- Unit : déterminisme du root hash sur fixtures
- Integration : altération volontaire d'une ligne historique → `/verify` doit détecter et reporter `TAMPER_DETECTED`

### Effort
Humain ~2 sem / CC+ostack ~3-5 jours.

---

## 8. Décisions encore en attente (registre Phase 2)

| # | Décision | Source | Bloqueur |
|---|---|---|---|
| D6-A | MoECC signe via portail web ou export externe | M1 | Préférence MoECC |
| D6-B | Délai max signature MoECC avant escalation | M1 | Counsel |
| M1-C | Pattern dispute post-soumission rapport | M1 | Counsel |
| M2-A | Cutover i18n vs progressive | M2 | Product |
| M3-A | Settlement réel vs ledger | M3 | Banque + counsel |
| M3-B | REFUND post-settlement | M3 | Counsel |
| M4-A | LTO only vs LTO + cruise | M4 | MoECC |
| M4-B | Débiteur aviation = opérateur ou compagnie | M4 | Counsel |
| M5-A | Capteur down → bloquer ou fallback (ADR-002 à produire) | M5 | MoECC + Solide ops |
| M5-B | Fournisseur capteurs | M5 | Solide ops |
| Article 4 | Hash-chain suffit ou blockchain mandatée | ADR-001 | Counsel — bloque tout déploiement de M1 si jamais réversion |

---

## 9. Ordonnancement et sequencing

```
B0-B5 (P0 backlog stabilisation)
   │
   ▼
M2 (rebrand i18n) ─── peut tourner en // de tout
   │
   ▼
M1 (MoECC report) ─── livrable contractuel mensuel, P0
   │
   ▼
M6 (public verify + root hash) ─── arme la défense ADR-001
   │
   ▼
M3 (concession + revenue_split) ─── attend signature Min. Finance
   │
   ▼
M4 (aviation) ─── attend liste aéroports + source données vols
   │
   ▼
M5 (sensor IoT) ─── attend déploiement physique des capteurs
```

M2 peut démarrer en parallèle de M1 (équipes différentes). M3-M6 ne sont pas bloquants entre eux mais consomment chacun ~1-2 sem de bande passante.

---

## 10. Métriques de succès Phase 2

- **M1** : 0 rapport mensuel composé manuellement après J+M+1. 100 % des rapports signés Solide dans les 24 h. ≥ 80 % co-signés MoECC dans les 10 jours ouvrés.
- **M2** : 0 occurrence "africgreen" dans `frontend/messages/*.json` post-cutover. 0 régression visuelle critique.
- **M3** : 100 % des transactions RECONCILED ont un `revenue_split` dans les 24 h. Écart accumulé sur 1 mois < $1.
- **M4** : ≥ 90 % des cycles LTO sur aéroports concédés détectés et facturés à J+1.
- **M5** : `sensor_reading_lag_seconds p95 < 60s` sur sites en production. 100 % des payloads non signés rejetés et logués.
- **M6** : `/verify` répond en < 200ms p99. Root hash mensuel publié dans les 5 jours du mois suivant.

---

## 11. NOT in scope (Phase 2)

- ❌ **Polygon / chaîne publique** — voir ADR-001 (peut être révisé selon conditions énumérées)
- ❌ **Multi-pays africains** — Phase 3 minimum, après démonstration Somaliland sur 12 mois
- ❌ **Marketplace volontaire crédits carbone** — produit distinct, non mandaté par décret
- ❌ **App mobile native** — PWA suffit
- ❌ **Refonte du domaine code `africgreen` → `green-gate`** — uniquement i18n + assets publics changent, le code reste
- ❌ **Module waste management** (Article 3.2 du décret) — Phase 3
- ❌ **Refactor backend Go en microservices** — monolithe modulaire suffit pour 10× le volume actuel

---

## 12. Open items / TODOs avant kickoff

- [ ] Avis counsel sur Article 4 (bloque M1 si jamais réversion ADR-001)
- [ ] Confirmer ratio concession/souverain D3 (bloque M3)
- [ ] Choisir source données vol M4 (bloque M4)
- [ ] Identifier fournisseur capteurs M5 (bloque M5)
- [ ] Designer pour logo + favicon M2
- [ ] Wireframe portail MoECC pour co-signature D6 (M1)
- [ ] Native-speaker review SO + AR i18n (cf. TODOS.md item 3 — peut se faire pendant M2)
- [ ] Playwright en CI (cf. TODOS.md item 2 — Phase 2 multipliera la surface E2E)

---

**Fin du Plan Phase 2 v1.0 — DRAFT**

*À soumettre à `/plan-ceo-review` + `/plan-eng-review` avant exécution.*
