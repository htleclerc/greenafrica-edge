# 🌐 API Endpoints — Green-Gate Platform v1

**Base URL** : `https://api.greengate.so/v1`
**Auth** : Bearer JWT (SSO Google Workspace)
**Format** : JSON (application/json)

---

## 🔐 Auth & Users

```http
POST   /auth/login              # SSO callback
GET    /auth/me                 # Current user profile
POST   /auth/logout
```

## 🏢 Armateurs

```http
GET    /armateurs                       # Liste paginée + filtres (stage, pays, verif)
POST   /armateurs                       # Créer un armateur
GET    /armateurs/:id                   # Détail
PATCH  /armateurs/:id                   # Mise à jour
DELETE /armateurs/:id                   # Soft delete

POST   /armateurs/:id/verify            # Lancer verification Equasis+OFAC
POST   /armateurs/:id/invite            # Passer à INVITED + envoi email
POST   /armateurs/:id/kyc               # Soumettre formulaire KYC
POST   /armateurs/:id/activate          # Passer à ACTIVE
GET    /armateurs/:id/navires           # Navires de l'armateur
GET    /armateurs/:id/proformas         # Historique factures
GET    /armateurs/:id/balance           # Solde global (facturé/payé/dû)
```

### POST /armateurs
```json
{
  "nom_legal": "H&P Ship Management Ltd",
  "pays_hq": "CY",
  "email_principal": "operations@hpshipmanagement.com",
  "verification_status": "PENDING_VERIFICATION"
}
```

## ✈️ Compagnies Aériennes

```http
GET    /compagnies                       # Liste
POST   /compagnies                       # Créer
GET    /compagnies/:id                   # Détail
PATCH  /compagnies/:id                   # Update
GET    /compagnies/:id/proformas         # Historique factures
```

## 🚢 Navires

```http
GET    /navires                          # Liste + filtres
POST   /navires                          # Créer
GET    /navires/:id                      # Détail
PATCH  /navires/:id                      # Update
GET    /navires/:id/voyages              # Voyages du navire

# Recherche IMO
GET    /navires/by-imo/:imo              # Lookup direct par IMO
POST   /navires/detect                   # Bulk import from VesselFinder
```

## 🌊 Voyages

```http
GET    /voyages                          # Liste + filtres (wave, status, dates)
POST   /voyages                          # Créer voyage (auto-calc CO2)
GET    /voyages/:id                      # Détail
PATCH  /voyages/:id                      # Update (ex: date_depart quand navire quitte)
POST   /voyages/:id/close                # Marquer DEPARTED + trigger proforma
```

### POST /voyages
```json
{
  "navire_id": "nav-042",
  "port_origine": "Dubai",
  "date_arrivee": "2026-07-01",
  "distance_nm": 4500,
  "vitesse_kn": 13.0,
  "carburant_type": "HFO"
}
```

Réponse (calculs auto server-side) :
```json
{
  "id": "voy-042",
  "voyage_days": 14.42,
  "fuel_consumed_t": 720.5,
  "co2_voyage_tco2": 2243.5,
  "co2_facturable_tco2": 1121.75,
  "contribution_usd": 44870.00,
  "wave_tag": "W8",
  "status": "ARRIVED"
}
```

## 💰 Pro-formas

```http
GET    /proformas                        # Liste + filtres (status, armateur, dates)
POST   /proformas                        # Créer proforma
GET    /proformas/:id                    # Détail
PATCH  /proformas/:id                    # Update

POST   /proformas/:id/generate-pdf       # Générer PDF signé
POST   /proformas/:id/send               # Envoyer mail + tracker
POST   /proformas/:id/mark-erratum       # Marquer comme erratum + créer nouvelle
POST   /proformas/:id/write-off          # Passer en WRITE_OFF (autorisation ADMIN)

GET    /proformas/:id/relances           # Historique relances
GET    /proformas/:id/paiements          # Historique paiements

GET    /proformas/pending                # Toutes les PENDING/OVERDUE
GET    /proformas/aged?bucket=30-60      # Vieillissement des créances
```

### POST /proformas/:id/send
```json
{
  "method": "EMAIL",
  "attach_kit_onboarding": true,
  "cc_direction": true,
  "schedule_relances": true
}
```

## 🔔 Relances (Reminders)

```http
POST   /relances/tick                    # Cron J+15/J+30/J+45 (idempotent)
GET    /relances                         # Historique global
GET    /relances/:id                     # Détail
POST   /relances/:id/response            # Enregistrer réponse armateur
POST   /relances/:id/escalate            # Escalader à bailiff

# Endpoint cron
POST   /relances/tick
# Runs daily 08:00 UTC
# Scans proformas.date_emission + [15|30|45] days
# Sends via mail service
# Creates Relance records
# CC on J45 to eidle@eidle-advocats.so
```

## 💵 Paiements

```http
POST   /paiements                        # Enregistrer paiement (upload preuve)
GET    /paiements                        # Liste
GET    /paiements/:id                    # Détail
PATCH  /paiements/:id                    # Correction
DELETE /paiements/:id                    # Suppression (ADMIN only)

POST   /paiements/reconcile-bank         # Import CSV banque + auto-match
```

### POST /paiements
```json
{
  "proforma_id": "pf-mar-064037",
  "montant_usd": 3985.12,
  "date_recu": "2026-07-15",
  "methode": "SWIFT",
  "reference_bancaire": "SWIFT-20260715-STL-042",
  "banque_emettrice": "Bank of Cyprus",
  "confirmation_pdf_upload": "<base64_pdf>"
}
```

## 📊 Dashboard KPI

```http
GET    /dashboard/kpi                    # Métriques temps réel
GET    /dashboard/waves                  # Répartition par wave
GET    /dashboard/aging                  # Vieillissement créances
GET    /dashboard/aviation               # Détail par compagnie
GET    /dashboard/projections            # Projections 2026-2030
GET    /dashboard/trajectory             # Trajectoire annualisée
```

### GET /dashboard/kpi (exemple réponse au 12 juillet)
```json
{
  "date_snapshot": "2026-07-12T00:00:00Z",
  "days_since_launch": 77,
  "totals": {
    "facture_usd": 2604886.34,
    "encaisse_usd": 12055.57,
    "outstanding_usd": 2592830.77,
    "taux_recouvrement_pct": 0.46
  },
  "maritime": {
    "navires_total": 100,
    "navires_realises": 90,
    "navires_anticipes": 10,
    "usd_realises": 1680051,
    "usd_anticipes": 209603
  },
  "aviation": {
    "vols_total": 358,
    "vols_realises": 299,
    "vols_anticipes": 59,
    "usd_realises": 674141,
    "usd_anticipes": 41092
  },
  "trajectoire": {
    "usd_par_jour": 33631,
    "usd_annualise": 12275427,
    "vs_realiste_2026": 2.42
  },
  "pipeline_semaine_prochaine": {
    "navires_attendus": 10,
    "usd_attendu": 209603
  }
}
```

## 🔍 Search & Discovery

```http
GET    /search?q=BERBERA+STAR            # Recherche full-text
GET    /search/imo/:imo                  # Lookup IMO croisé
POST   /search/bulk-lookup               # Batch Equasis/IMO
```

## 📝 Audit & Compliance

```http
GET    /audit-log                        # Historique complet (ADMIN)
GET    /audit-log/entity/:type/:id       # Historique par entité
GET    /compliance/ofac-check            # État screening OFAC
POST   /compliance/ofac-refresh          # Re-scan tous armateurs vs SDN
GET    /compliance/blocked               # Liste armateurs BLOCKED
```

## 🌱 Seeds & Bulk Operations

```http
POST   /admin/seeds/import               # Import bulk JSON (ADMIN)
POST   /admin/vessels/bulk-detect        # Import VesselFinder
GET    /admin/export/proformas.csv       # Export comptable
GET    /admin/export/full-backup.json    # Backup complet
```

---

## 🚨 Codes d'erreur

| Code | Signification |
|---|---|
| 400 | Bad request (validation Zod échouée) |
| 401 | Non authentifié |
| 403 | Rôle insuffisant |
| 404 | Entité introuvable |
| 409 | Conflit (ex: IMO déjà existant) |
| 422 | Business rule violation (ex: armateur OFAC blocked) |
| 429 | Rate limit |
| 500 | Server error |

## 🔄 Webhooks disponibles

```http
POST /webhooks/subscribe { url, events[] }
```

Events :
- `proforma.created`
- `proforma.sent`
- `proforma.paid`
- `armateur.stage_changed`
- `voyage.arrived`
- `relance.escalated`
- `payment.received`

## 🕐 Cron jobs

| Job | Fréquence | Endpoint |
|---|---|---|
| VesselFinder sync | 6h | `POST /cron/vessels-sync` |
| Aviation flights sync | 6h | `POST /cron/aviation-sync` |
| Relances tick | Daily 08:00 | `POST /relances/tick` |
| KPI recompute | Daily 09:00 | `POST /cron/kpi-recompute` |
| Weekly report | Lundi 07:00 | `POST /cron/weekly-report` |
| OFAC screening refresh | Weekly | `POST /cron/ofac-refresh` |
