# 📦 Green-Gate — Package d'intégration Armateurs (v2)

Package complet à transmettre au développeur pour l'intégration des armateurs et l'automatisation du recouvrement dans l'application Green-Gate.

**Date :** 13 juillet 2026
**Auteur :** Noël KPATCHAVI · Green-Gate Programme
**Version :** v2 — Enrichi pour la phase de recouvrement automatique

---

## 🎯 Objectif de cette version v2

Préparer l'application à recevoir les paiements armateurs **de manière totalement automatique**, afin d'éviter la production manuelle des bilans (actuellement 4 à 6 heures par semaine).

**À l'arrivée du premier paiement**, l'application doit :
- Détecter automatiquement le versement (import CSV Premier Bank ou webhook SWIFT)
- Rapprocher automatiquement le paiement à la pro-forma correspondante
- Mettre à jour les statuts (PENDING → PARTIAL / PAID)
- Notifier automatiquement la Direction et le cabinet d'avocats
- Régénérer les bilans hebdomadaires et mensuels sans intervention humaine

---

## 📁 Contenu du package v2

```
onboarding_armateurs/
├── README.md                        ← ce fichier (à lire en premier)
├── RECAPITULATIF_COMPLET.md         ← [v3 NEW] 📊 Récap unifié maritime + aviation (chiffres à jour)
├── PROCESSUS_ONBOARDING_v2.md       ← [v3 NEW] 🚢✈ Processus revu — 7 étapes unifiées mar+avi
│
├── ONBOARDING_ARMATEURS.md          ← [v1] Plan de base MARITIME : workflow, règles métier, KPI
├── ONBOARDING_COMPAGNIES_AVIATION.md ← [v2 NEW] Volet AVIATION : 6 compagnies, formule RFI 2.0
│
├── RECOUVREMENT_AUTOMATIQUE.md      ← [v2 NEW] Vue d'ensemble du recouvrement auto (maritime + aviation)
├── RECONCILIATION_BANCAIRE.md       ← [v2 NEW] Algorithme de matching bancaire
├── BILAN_AUTO_GENERATION.md         ← [v2 NEW] Auto-génération des 4 livrables
│
├── schemas/
│   ├── schema.prisma                ← Modèle Prisma (à étendre avec les tables v2)
│   └── schema.sql                   ← Modèle PostgreSQL brut
│
├── seeds/
│   ├── 01_armateurs.json            ← 20 armateurs (13 identifiés + 4 blocked)
│   ├── 02_navires.json              ← 100 navires
│   ├── 03_voyages.json              ← 100 voyages (avec calculs CO₂)
│   ├── 04_proformas.json            ← 458 pro-formas (100 mar + 358 avi)
│   ├── 05_relances.json             ← 40 relances (échantillon historique)
│   ├── 06_paiements.json            ← 3 paiements (échantillon)
│   └── 07_compagnies_aeriennes.json ← 6 compagnies (Ethiopian, FlyDubai...)
│
└── api/
    └── API_ENDPOINTS.md             ← Spec REST complète (v1 + endpoints v2)
```

---

## 🆕 Nouveautés v2 — Les 3 documents à lire en priorité

### 1. `RECOUVREMENT_AUTOMATIQUE.md`
La vue d'ensemble complète : du paiement SWIFT reçu jusqu'à la mise à jour du dashboard, en passant par les notifications automatiques. Contient le pseudo-code TypeScript de la fonction principale `importBankStatement()`.

### 2. `RECONCILIATION_BANCAIRE.md`
Le détail technique du matching paiement ↔ pro-forma : 5 règles avec seuils de confiance (100 %, 90 %, 85 %), gestion des paiements groupés, trop-perçus, contestations, devises non-USD.

### 3. `BILAN_AUTO_GENERATION.md`
La spec des 4 livrables auto-générés :
- Dashboard Excel v14+ hebdomadaire (lundi 07:00)
- Bilan PDF hebdomadaire (lundi 07:00)
- Rapport mensuel Word (1er du mois 07:00)
- Présentation PowerPoint 15 slides (1er du mois 07:00)

Templates existants réutilisés : `build_dashboard_v14.py`, `build_rapport_juillet.js`, `build_pptx_comite.py`.

---

## 🚀 Pour ton développeur — Instructions rapides

### Prérequis
- Node.js 20+
- PostgreSQL 15+
- Prisma CLI (`npm i -g prisma`)

### Setup en 5 minutes
```bash
# 1. Clone le repo cible
git clone <ton-repo-app-greengate>
cd greengate-app

# 2. Copier le schema Prisma
cp <ce-package>/schemas/schema.prisma prisma/schema.prisma

# 3. Créer la base + migrations
npx prisma migrate dev --name init_greengate

# 4. Copier les seeds
cp -r <ce-package>/seeds/ prisma/seeds/

# 5. Créer le script de seed (voir seed.ts ci-dessous)

# 6. Lancer les seeds
npx prisma db seed
```

### Script `prisma/seed.ts` à créer
```typescript
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  const seedsDir = path.join(__dirname, 'seeds');

  // 1. Armateurs (racine)
  const armateurs = JSON.parse(fs.readFileSync(path.join(seedsDir, '01_armateurs.json'), 'utf-8'));
  for (const a of armateurs.armateurs) {
    await prisma.armateur.upsert({
      where: { id: a.id },
      update: {},
      create: a,
    });
  }
  console.log(`✅ ${armateurs.armateurs.length} armateurs importés`);

  // 2. Compagnies aériennes
  const compagnies = JSON.parse(fs.readFileSync(path.join(seedsDir, '07_compagnies_aeriennes.json'), 'utf-8'));
  for (const c of compagnies.compagnies) {
    const { vols_realises_2026, usd_realises_2026, flotte_a_hga, ...data } = c;
    await prisma.compagnieAerienne.upsert({
      where: { id: c.id },
      update: {},
      create: data,
    });
  }
  console.log(`✅ ${compagnies.compagnies.length} compagnies importées`);

  // 3. Navires
  const navires = JSON.parse(fs.readFileSync(path.join(seedsDir, '02_navires.json'), 'utf-8'));
  for (const n of navires.navires) {
    await prisma.navire.upsert({
      where: { id: n.id },
      update: {},
      create: {
        ...n,
        type_navire: mapVesselType(n.type_navire),
      },
    });
  }
  console.log(`✅ ${navires.navires.length} navires importés`);

  // 4. Voyages
  const voyages = JSON.parse(fs.readFileSync(path.join(seedsDir, '03_voyages.json'), 'utf-8'));
  for (const v of voyages.voyages) {
    await prisma.voyage.upsert({
      where: { id: v.id },
      update: {},
      create: {
        ...v,
        date_arrivee: parseDate(v.date_arrivee),
        date_depart: v.date_depart ? parseDate(v.date_depart) : null,
      },
    });
  }
  console.log(`✅ ${voyages.voyages.length} voyages importés`);

  // 5. Pro-formas
  const proformas = JSON.parse(fs.readFileSync(path.join(seedsDir, '04_proformas.json'), 'utf-8'));
  for (const p of proformas.proformas) {
    const { voyage_ids, ...data } = p;
    await prisma.proforma.upsert({
      where: { id: p.id },
      update: {},
      create: {
        ...data,
        voyages: voyage_ids ? { connect: voyage_ids.map((id: string) => ({ id })) } : undefined,
      },
    });
  }
  console.log(`✅ ${proformas.proformas.length} pro-formas importées`);

  // 6. Relances
  const relances = JSON.parse(fs.readFileSync(path.join(seedsDir, '05_relances.json'), 'utf-8'));
  for (const r of relances.relances) {
    await prisma.relance.upsert({
      where: { id: r.id },
      update: {},
      create: r,
    });
  }
  console.log(`✅ ${relances.relances.length} relances importées`);

  // 7. Paiements
  const paiements = JSON.parse(fs.readFileSync(path.join(seedsDir, '06_paiements.json'), 'utf-8'));
  for (const p of paiements.paiements) {
    await prisma.paiement.upsert({
      where: { id: p.id },
      update: {},
      create: p,
    });
  }
  console.log(`✅ ${paiements.paiements.length} paiements importés`);
}

function mapVesselType(t: string) {
  const map: Record<string, string> = {
    'Bulk Carrier': 'BULK_CARRIER',
    'Container Ship': 'CONTAINER_SHIP',
    'General Cargo': 'GENERAL_CARGO',
    'Chemical Tanker': 'CHEMICAL_TANKER',
    'Livestock Carrier': 'LIVESTOCK_CARRIER',
  };
  return map[t] || 'OTHER';
}

function parseDate(s: string) {
  if (s.includes('T')) return new Date(s);
  // DD/MM/YYYY
  if (s.includes('/')) {
    const [d, m, y] = s.split('/');
    return new Date(`${y}-${m}-${d}`);
  }
  return new Date(s);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
```

### package.json — ajouter
```json
{
  "prisma": {
    "seed": "ts-node prisma/seed.ts"
  }
}
```

---

## 📋 Checklist d'intégration développeur — v2

### Phase 1 — Fondations (v1, si pas encore fait)

- [ ] **1. Base de données** : PostgreSQL 15 provisionnée
- [ ] **2. Schema Prisma** : `prisma migrate dev --name init`
- [ ] **3. Seeds importés** : `prisma db seed` → 20 armateurs, 100 navires, 458 pro-formas
- [ ] **4. API REST scaffolding** : NextJS/Express avec 7 groupes d'endpoints
- [ ] **5. Auth SSO Google** : login @solidetechnology.com uniquement
- [ ] **6. Rôles ADMIN/OPS/FINANCE/READONLY** : middleware RBAC
- [ ] **7. Endpoint `/dashboard/kpi`** : agrégations SQL temps réel
- [ ] **8. Service PDF pro-forma** : reportlab-like via Puppeteer
- [ ] **9. Service email SMTP** : Gmail + App Password + throttle 30s
- [ ] **10. Cron `/relances/tick`** : quotidien 08:00 UTC
- [ ] **11. OFAC screening** : refresh hebdo + block automatique
- [ ] **12. Portail armateur self-service** : lecture seule d'abord
- [ ] **13. Audit log** : toutes mutations sur armateurs/proformas
- [ ] **14. Backup quotidien** : dump PostgreSQL + rétention 30 jours

### Phase 2 — Recouvrement automatique (v2)

**Sprint 1 (2 semaines) — Ingestion bancaire**
- [ ] **15. Table `BankStatement`** + `UnmatchedPayment` (schema Prisma étendu)
- [ ] **16. Endpoint `POST /api/paiements/reconcile-bank`** avec parser CSV
- [ ] **17. Algorithme de matching** — 5 règles avec seuils de confiance
- [ ] **18. UI admin `/admin/payments/unmatched`** pour traitement manuel

**Sprint 2 (2 semaines) — Notifications automatiques**
- [ ] **19. Table `Notification`** + templates (PAYMENT_PAID, UNMATCHED, etc.)
- [ ] **20. Intégration SMTP** (Direction) et WhatsApp Business API
- [ ] **21. Auto-envoi** confirmations paiement + reçus PDF
- [ ] **22. Alertes cabinets d'avocats** (mandats clôturés)

**Sprint 3 (2 semaines) — Bilans auto-générés**
- [ ] **23. Table `GeneratedReport`** + archivage
- [ ] **24. Cron `weekly-report`** lundi 07:00 (Excel + PDF)
- [ ] **25. Cron `monthly-report`** 1er du mois 07:00 (Word + PPTX)
- [ ] **26. Endpoint `POST /api/reports/generate`** à la demande

**Sprint 4 (2 semaines) — Dashboard live**
- [ ] **27. Endpoint `/api/dashboard/live`** optimisé (< 200 ms)
- [ ] **28. Composants React** (KPI cards + tables + graphiques)
- [ ] **29. Feed WebSocket temps réel** (paiements arrivant)
- [ ] **30. Aging analysis** (0-30j, 30-60j, 60-90j, 90j+)

**Délai total v2 : 8 semaines** — après quoi la Direction ne produit plus jamais de bilan manuel.

---

## 🎯 Règles métier CRITIQUES (à respecter absolument)

1. **JAMAIS de contact direct avec armateurs OFAC SDN** (`is_ofac_sdn = true`)
   - Ex: IRISL/Valfajr (arm-007), Petrofleet (arm-012)
   - Procédure IN REM uniquement via Bailiff Eidle Omer (Eidle Advocats Hargeisa)

2. **JAMAIS de contact avec armateurs UN prohibited** (`is_un_prohibited = true`)
   - Ex: Morgan Navigation Beirut (arm-013) — navires MAYAR, LILY J, HAJH GHSN J
   - Notification consulaire uniquement

3. **CC obligatoire à tous les envois** : `n.kpatchavi@solidetechnology.com`

4. **CC additionnel J+45** : `eidle@eidle-advocats.so`

5. **Throttle SMTP** : 30 secondes entre envois (rate limit Gmail)

6. **DRY-RUN par défaut** sur tous les scripts d'envoi

7. **Confirmation interactive** avant SEND réel (bypass avec `--yes`)

8. **Formule maritime v11 HYBRID** :
   `contribution_usd = co2_voyage_tco2 × 0.50 × 40`

9. **Formule aviation NEW** (juin 2026) :
   `contribution_usd = co2_voyage_tco2 × 2.0 × 40` (RFI 2.0)

10. **Facteur émission HFO** = 3.114 tCO₂/t fuel (IMO MEPC.346(78))

---

## 📞 Support intégration

- **Direction Green-Gate** : Noël KPATCHAVI · n.kpatchavi@solidetechnology.com · +33 7 58 66 67 75
- **Documentation formule** : voir `Etat_de_lart_mondial_v2.docx` (parties 1-4)
- **Rapport mensuel juillet 2026** : voir `Rapport_Mensuel_Juillet_2026.docx`
- **Dashboard v14 exemple** : voir `Dashboard_GreenGate_v14_5juillet.xlsx`

---

## 📚 Documents de contexte à joindre au brief développeur

1. `ONBOARDING_ARMATEURS.md` — plan complet architecture
2. `schemas/schema.prisma` — modèle données
3. `seeds/` — données réelles pour tests
4. `api/API_ENDPOINTS.md` — spec REST complète
5. Décret MOE&CC/MWI/36/2026 (base légale)
6. Formule v11 HYBRID (fiche technique)

---

*Ce package est autoportant : ton développeur devrait pouvoir livrer un MVP fonctionnel en 2-3 semaines à partir de ces éléments.*
