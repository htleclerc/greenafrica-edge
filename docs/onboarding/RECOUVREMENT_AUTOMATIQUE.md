# 💰 Module Recouvrement Automatique — Green-Gate Platform

**Objectif** : Automatiser à 100 % le suivi des paiements armateurs pour ne plus jamais refaire de bilan manuellement.

**Auteur** : Noël KPATCHAVI · Green-Gate Programme
**Date** : 13 juillet 2026
**Version** : v2 (extension du dossier `ONBOARDING_ARMATEURS.md`)

---

## 🎯 Le problème résolu

Depuis 78 jours d'activité, chaque bilan hebdomadaire est produit manuellement (Excel, JSON, PowerPoint, PDF pro-formas). Cela prend actuellement **4 à 6 heures par semaine** et consomme un temps précieux de la Direction.

Ce module rend cette production **entièrement automatique** dès que les premiers paiements arriveront.

---

## 🔄 Vue d'ensemble du workflow automatique

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  1. PAIEMENT SWIFT                                                    │
│     ↓  Armateur envoie USD sur compte Premier Bank                    │
│     ↓  Message MT103 avec référence "PRO-2026-064XXX"                 │
│                                                                       │
│  2. DÉTECTION AUTOMATIQUE                                             │
│     ↓  Import quotidien CSV Premier Bank (ou webhook si disponible)   │
│     ↓  Extraction champ "remittance information"                      │
│                                                                       │
│  3. AUTO-MATCHING                                                     │
│     ↓  Regex sur référence pro-forma                                  │
│     ↓  Mise à jour statut : PENDING → PARTIAL / PAID                  │
│                                                                       │
│  4. NOTIFICATIONS AUTOMATIQUES                                        │
│     ↓  Email/WhatsApp direction : "Paiement reçu 12,345 USD ARM-002"  │
│     ↓  Mail confirmation à l'armateur (reçu PDF joint)                │
│     ↓  Alerte cabinet d'avocats (mandat en cours)                     │
│                                                                       │
│  5. BILAN AUTO-RÉGÉNÉRÉ                                               │
│     ↓  Dashboard KPI mis à jour temps réel                            │
│     ↓  Excel bilan hebdo régénéré chaque lundi 07:00                  │
│     ↓  PDF rapport mensuel envoyé Comité SOLIDE le 1er du mois        │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 📥 Étape 1 — Ingestion des paiements

### Option A — Import CSV Premier Bank (MVP)

**Fréquence** : quotidien, 08:00 UTC via cron

**Format CSV attendu** (à confirmer avec Premier Bank) :

```csv
date,montant,devise,contrepartie,swift_ref,remittance_info,libelle
2026-08-15,3985.12,USD,H&P SHIP MANAGEMENT CY,SWIFT-20260815-001,PRO-2026-064001,Payment PRO-2026-064001
```

**Endpoint** : `POST /api/paiements/reconcile-bank`

```typescript
// prisma/lib/reconciliation.ts
export async function importBankStatement(csvContent: string) {
  const rows = parseCsv(csvContent);
  const results = { matched: 0, unmatched: 0, errors: 0 };

  for (const row of rows) {
    // 1. Extraction de la référence pro-forma
    const refMatch = row.remittance_info.match(/PRO-2026-\d{6}/);
    if (!refMatch) {
      await createUnmatchedPayment(row);
      results.unmatched++;
      continue;
    }

    // 2. Recherche de la pro-forma
    const proforma = await prisma.proforma.findUnique({
      where: { reference: refMatch[0] },
      include: { armateur: true },
    });

    if (!proforma) {
      results.errors++;
      await notifyOps(`Référence inconnue : ${refMatch[0]}`);
      continue;
    }

    // 3. Création du paiement + mise à jour statut
    const payment = await prisma.paiement.create({
      data: {
        proforma_id: proforma.id,
        montant_usd: row.montant,
        date_recu: new Date(row.date),
        methode: 'SWIFT',
        reference_bancaire: row.swift_ref,
        banque_emettrice: row.contrepartie,
      },
    });

    // 4. Update statut pro-forma
    const totalPaye = await prisma.paiement.aggregate({
      where: { proforma_id: proforma.id },
      _sum: { montant_usd: true },
    });

    const nouveauStatut =
      totalPaye._sum.montant_usd >= proforma.total_usd ? 'PAID' :
      totalPaye._sum.montant_usd > 0 ? 'PARTIAL' : 'PENDING';

    await prisma.proforma.update({
      where: { id: proforma.id },
      data: {
        total_paye_usd: totalPaye._sum.montant_usd,
        outstanding_usd: proforma.total_usd - totalPaye._sum.montant_usd,
        payment_status: nouveauStatut,
      },
    });

    // 5. Notifications automatiques
    await triggerNotifications(proforma, payment, nouveauStatut);
    results.matched++;
  }

  return results;
}
```

### Option B — Webhook SWIFT (idéal à moyen terme)

Configuration côté Premier Bank pour push automatique des MT103 vers :
```
POST https://api.greengate.so/v1/webhooks/swift/mt103
```

Payload attendu (JSON) :
```json
{
  "swift_ref": "SWIFT-20260815-001",
  "value_date": "2026-08-15",
  "amount": 3985.12,
  "currency": "USD",
  "ordering_party": "H&P SHIP MANAGEMENT",
  "beneficiary": "SOLIDE TECHNOLOGY",
  "remittance_info": "PRO-2026-064001 MV EUROPA IMO 9412356",
  "raw_mt103": "..."
}
```

---

## 🔗 Étape 2 — Auto-matching des paiements

### Règles de matching

| Priorité | Règle | Action si match |
|---|---|---|
| 1 | Référence exacte `PRO-2026-XXXXXX` dans remittance_info | Match direct |
| 2 | Nom navire + IMO | Match probable — validation manuelle |
| 3 | Nom armateur + montant | Match probable — validation manuelle |
| 4 | Aucun | Créé en `UNMATCHED_PAYMENTS` — alerte Direction |

### Gestion des cas particuliers

- **Paiement consolidé** (couvre plusieurs pro-formas) : mention "CONSOLIDATED PRO-2026-064001,064002,064003" — répartition auto au prorata
- **Paiement partiel** : proforma passe en `PARTIAL` — relance ajustée
- **Trop-perçu** : crédité sur pro-forma suivante du même armateur (avec log audit)
- **Devise autre que USD** : conversion au taux du jour via API BCE — commission bancaire déduite

---

## 🔔 Étape 3 — Notifications automatiques

### Déclencheurs

| Événement | Destinataire | Canal | Template |
|---|---|---|---|
| Paiement matché (partiel) | Direction | Email + WhatsApp | `PAYMENT_PARTIAL.txt` |
| Paiement matché (complet) | Direction + Armateur | Email + WhatsApp | `PAYMENT_PAID.txt` |
| Paiement non matché | Direction (ops@) | Email urgent | `PAYMENT_UNMATCHED.txt` |
| Statut = PAID | Cabinet d'avocats | Email | `MANDATE_CLOSED.txt` |
| Trop-perçu | Direction | Email | `OVERPAYMENT.txt` |

### Exemple `PAYMENT_PAID.txt`

```
Objet : ✅ Paiement complet reçu — {armateur.nom} — USD {montant}

Bonjour Noël,

Un paiement complet a été reçu pour la pro-forma {reference}.

Détails :
• Armateur    : {armateur.nom}
• Navire      : {vessel.nom} (IMO {vessel.imo})
• Montant reçu: USD {montant}
• Date        : {date}
• SWIFT ref   : {swift_ref}
• Statut      : ✅ PAID

Cette pro-forma est maintenant clôturée. Une confirmation a été envoyée à
l'armateur et le cabinet d'avocats {cabinet.nom} en charge du dossier a
été notifié.

Restant dû portfolio : USD {portfolio_outstanding}
Total encaissé LTD  : USD {portfolio_paid}
Taux de recouvrement: {tx_recouvrement}%

— Green-Gate OS (message automatique)
```

---

## 📊 Étape 4 — Bilans auto-générés

### Bilan hebdomadaire (chaque lundi 07:00)

Cron : `0 7 * * 1`
Endpoint : `POST /api/cron/weekly-report`

**Ce qui est régénéré automatiquement** :
1. `Dashboard_GreenGate_vXX.xlsx` — 4 onglets (KPI · Maritime · Aviation · Actions)
2. `Bilan_hebdo_YYYY-WW.pdf` — 2 pages A4 signé Noël KPATCHAVI
3. `Recouvrement_Tracker.json` — état complet pour l'app
4. Email récap Direction avec les 3 fichiers en pièce jointe

### Bilan mensuel (1er du mois 07:00)

Cron : `0 7 1 * *`
Endpoint : `POST /api/cron/monthly-report`

**Régénéré et envoyé au Comité SOLIDE** :
1. `Rapport_Mensuel_{MOIS}_2026.docx` (format v3 classique validé)
2. `Dashboard_v14+{MOIS}.xlsx` avec nouvelle wave incorporée
3. `Presentation_Comite_{MOIS}.pptx` (15 slides)
4. Email au Comité + CC Direction

### Régénération des pro-formas quand nouveau navire détecté

Cron : `0 */6 * * *` (toutes les 6h) — Endpoint : `POST /api/cron/vessels-sync`

1. Sync avec VesselFinder (nouveaux navires en escale)
2. Auto-création `voyages` + calcul CO₂
3. Génération auto pro-forma individuelle (format v4 validé)
4. Regénération de la pro-forma consolidée de l'armateur concerné
5. Email Direction : "N nouveaux navires détectés, X pro-formas émises"

---

## 🗂️ Étape 5 — Nouvelles tables Prisma

Ajouter au schema existant :

```prisma
// Ingestion bancaire
model BankStatement {
  id              String   @id @default(cuid())
  import_date     DateTime @default(now())
  source          String   // 'CSV_PREMIER_BANK' ou 'SWIFT_WEBHOOK'
  raw_content     String   @db.Text
  rows_total      Int
  rows_matched    Int
  rows_unmatched  Int
  rows_error      Int
  processed_by    String?  // user_id ou 'CRON'
  status          String   // 'PROCESSING' / 'COMPLETED' / 'FAILED'
  created_at      DateTime @default(now())

  unmatched_payments UnmatchedPayment[]
}

// Paiements non appariés (pour traitement manuel)
model UnmatchedPayment {
  id                  String   @id @default(cuid())
  bank_statement_id   String
  bank_statement      BankStatement @relation(fields: [bank_statement_id], references: [id])
  swift_ref           String
  amount_usd          Decimal
  ordering_party      String?
  remittance_info     String?
  raw_data            Json
  resolved            Boolean  @default(false)
  resolved_at         DateTime?
  resolved_by         String?
  resolved_to_proforma_id String?
  notes               String?  @db.Text
  created_at          DateTime @default(now())
}

// Historique bilans générés (audit)
model GeneratedReport {
  id            String   @id @default(cuid())
  type          String   // 'WEEKLY' / 'MONTHLY' / 'ON_DEMAND'
  period_start  DateTime
  period_end    DateTime
  file_paths    Json     // {excel: "...", pdf: "...", pptx: "..."}
  sent_to       String[] // emails destinataires
  sent_at       DateTime?
  generated_by  String   // 'CRON' ou user_id
  created_at    DateTime @default(now())

  @@index([type, period_end])
}

// Notifications envoyées (audit + anti-doublon)
model Notification {
  id            String   @id @default(cuid())
  trigger       String   // 'PAYMENT_MATCHED' / 'UNMATCHED' / 'BILAN_WEEKLY'...
  entity_type   String   // 'Proforma' / 'Paiement' / 'Report'
  entity_id     String
  channel       String   // 'EMAIL' / 'WHATSAPP' / 'SLACK'
  recipient     String
  template_used String
  content       String?  @db.Text
  sent_at       DateTime @default(now())
  status        String   // 'SENT' / 'FAILED' / 'DELIVERED'

  @@index([entity_type, entity_id])
  @@index([trigger, sent_at])
}
```

---

## 🚀 Endpoints API additionnels

Ajouter au `API_ENDPOINTS.md` :

```http
# Réconciliation bancaire
POST   /api/paiements/reconcile-bank
       body: multipart/form-data avec fichier CSV Premier Bank
       returns: {matched: N, unmatched: N, errors: N}

POST   /api/webhooks/swift/mt103
       body: JSON MT103 parsé
       returns: {matched: true/false, proforma_id?: "..."}

GET    /api/paiements/unmatched
       returns: liste UnmatchedPayment[] à traiter manuellement

POST   /api/paiements/unmatched/:id/resolve
       body: {proforma_id: "..."} → attribution manuelle

# Bilans auto-générés
POST   /api/cron/weekly-report                 (cron)
POST   /api/cron/monthly-report                (cron)
POST   /api/cron/vessels-sync                  (cron)

GET    /api/reports/history                    liste des bilans passés
GET    /api/reports/:id/download               télécharger un bilan archivé

POST   /api/reports/generate?type=weekly       forcer une génération à la demande
POST   /api/reports/generate?type=monthly

# Dashboard temps réel
GET    /api/dashboard/live                     KPI temps réel (WebSocket possible)
GET    /api/dashboard/recouvrement             taux recouvrement par armateur
GET    /api/dashboard/aging                    vieillissement créances (30/60/90+)

# Notifications
GET    /api/notifications                      historique
POST   /api/notifications/test                 tester un template
GET    /api/notifications/pending              non envoyées
```

---

## 📈 Dashboard temps réel

**Composants React attendus** :

1. **Bandeau KPI global**
   - Total facturé LTD · Total encaissé · Reste dû · Taux recouvrement %

2. **Graphique évolution recouvrement**
   - Ligne cumul facturé vs cumul encaissé (30/60/90 jours)

3. **Table armateurs top-débiteurs**
   - Nom · Dû · Payé · % · Statut relance · Cabinet en charge

4. **Aging analysis**
   - 0-30 jours · 30-60 jours · 60-90 jours · 90+ jours

5. **Feed événements temps réel**
   - Paiement reçu · Nouveau navire détecté · Mise en demeure envoyée · Trop-perçu

**Endpoint principal** : `GET /api/dashboard/live` → renvoie tout ce qu'il faut sur une seule requête.

---

## 🔒 Sécurité et audit

- **Toutes** les mutations sur `paiements` sont loggées dans `AuditLog`
- **Réconciliation** validée par 4-eyes principle : import automatique + revue Direction hebdo
- **Fichiers bancaires bruts** archivés 10 ans (compliance)
- **Notifications** archivées avec accusé réception si canal supporté
- **Reports générés** conservés indéfiniment (versioning)

---

## ✅ Checklist d'implémentation

### Sprint 1 (2 semaines) — Ingestion bancaire
- [ ] Endpoint `POST /api/paiements/reconcile-bank` avec parsing CSV
- [ ] Tables `BankStatement` + `UnmatchedPayment`
- [ ] Auto-matching règles 1-4
- [ ] UI de traitement des non-appariés

### Sprint 2 (2 semaines) — Notifications
- [ ] Table `Notification` + templates
- [ ] Intégration SMTP (Direction) + WhatsApp Business API
- [ ] Auto-envoi confirmations paiement + reçus PDF
- [ ] Alertes cabinets d'avocats

### Sprint 3 (2 semaines) — Bilans auto
- [ ] Cron `weekly-report` + `monthly-report`
- [ ] Génération Excel/PDF/PPTX depuis templates existants
- [ ] Envoi automatique Comité SOLIDE
- [ ] Table `GeneratedReport` + historique consultable

### Sprint 4 (2 semaines) — Dashboard live
- [ ] Endpoint `/api/dashboard/live` optimisé
- [ ] Composants React (KPI + tables + graphs)
- [ ] Feed WebSocket temps réel
- [ ] Aging analysis

**Délai total : 8 semaines** — après quoi la Direction Green-Gate ne produit plus jamais de bilan manuel.

---

## 📞 Support intégration

- **Direction Green-Gate** : Noël KPATCHAVI · +33 7 58 66 67 75
- **Templates emails à valider** : voir `workflows/PAYMENT_TRACKING.md`
- **Coordonnées bancaires** : voir pièce jointe `PJ5_Coordonnees_Bancaires.docx`

---

*Ce module transforme le suivi manuel actuel en machine automatique. Objectif : que la Direction ne consacre plus que 15 minutes par semaine à valider les bilans générés, au lieu de 4 à 6 heures à les produire.*
