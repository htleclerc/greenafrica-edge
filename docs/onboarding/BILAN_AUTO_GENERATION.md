# 📊 Génération automatique des bilans — Spécifications

**Objectif** : Ne plus jamais produire de bilan manuellement.

**Contexte** : Actuellement, chaque bilan hebdo prend 4-6h à générer. Cette spec décrit comment automatiser à 100 % la production des 4 livrables récurrents.

---

## 📅 Les 4 livrables à automatiser

| # | Livrable | Fréquence | Destinataires |
|---|---|---|---|
| 1 | Dashboard Excel v14+ (4 onglets) | Hebdomadaire (lundi 07:00) | Direction |
| 2 | Bilan PDF 2 pages | Hebdomadaire (lundi 07:00) | Direction |
| 3 | Rapport mensuel Word 4 pages | Mensuel (1er du mois 07:00) | Comité SOLIDE |
| 4 | Présentation PowerPoint 15 slides | Mensuel (1er du mois 07:00) | Comité SOLIDE |

---

## 1. Dashboard Excel hebdomadaire

### Templates existants à réutiliser

Le script existant `build_dashboard_v14.py` (déjà validé) sert de base. Il faut le convertir en service appelable :

```python
# services/report_generator.py
from openpyxl import Workbook
from datetime import date

def generate_weekly_dashboard(week_start, week_end):
    """
    Génère le dashboard Excel hebdo avec les 4 onglets standards.
    Reprend exactement le template de build_dashboard_v14.py.
    """
    # 1. Charger les données de la période
    vessels = Vessel.query.filter(
        Vessel.arrival >= week_start,
        Vessel.arrival <= week_end
    ).all()

    # 2. Calculer les KPI
    kpi = compute_kpi(vessels, snapshot_date=week_end)

    # 3. Générer le workbook (repris du script existant)
    wb = build_workbook_from_template(kpi, vessels)

    # 4. Sauver et archiver
    filename = f"Dashboard_GreenGate_v{version}_{week_start.isoformat()}.xlsx"
    filepath = ARCHIVE_DIR / filename
    wb.save(filepath)

    # 5. Enregistrer dans GeneratedReport
    GeneratedReport.create(
        type="WEEKLY",
        period_start=week_start,
        period_end=week_end,
        file_paths={"excel": str(filepath)},
        generated_by="CRON"
    )

    return filepath
```

### Données incluses

- **Onglet 1 — KPI global** : total facturé/encaissé/dû · taux recouvrement · trajectoire annualisée
- **Onglet 2 — Maritime** : détail 100 navires + top armateurs débiteurs
- **Onglet 3 — Aviation** : 6 compagnies (nouvelle formule CO₂ × RFI 2.0)
- **Onglet 4 — Actions Q3** : actions en cours + calendrier recouvrement

### Cron

```
# /etc/cron.d/greengate
0 7 * * 1 www-data curl -X POST http://localhost:3000/api/cron/weekly-report
```

---

## 2. Bilan PDF hebdomadaire

Format synthétique en 2 pages A4 pour la Direction — même graphisme que les pro-formas (Green Gate OS).

### Structure

**Page 1** :
- Header Green Gate + drapeau Somaliland (identique aux pro-formas)
- Bandeau doré "BILAN HEBDOMADAIRE — Semaine XX de 2026"
- Table KPI : facturé, encaissé, dû, %
- Table top-5 armateurs par restant dû

**Page 2** :
- Évolution graphique (bar chart) sur 8 semaines
- Actions en cours (mandats avocats, relances J+15/J+30/J+45)
- Signature Direction

### Template à générer

À partir du script `build_proformas_v11_format_original.py`, extraire la logique header/footer et l'appliquer au bilan PDF.

---

## 3. Rapport mensuel Word

Format v3 classique (sobre, bien espacé) — reprend `Rapport_Mensuel_Juillet_2026.docx` comme template.

### Sections auto-alimentées

1. **Synthèse exécutive** (KPI de la période)
2. **Volet maritime** (répartition par wave)
3. **Volet aviation** (par compagnie)
4. **Trajectoire et projections** (comparaison réaliste vs optimiste)
5. **Plan d'action Q suivant** (auto-généré depuis tickets en cours)
6. **Recommandations** (générées depuis règles métier)

### Template

Réutiliser `build_rapport_juillet.js`. Convertir en service :

```javascript
// services/monthly_report.js
async function generateMonthlyReport(month, year) {
  const data = await collectMonthData(month, year);
  const doc = buildDocx(data, template="monthly_v3_classique");
  const buf = await Packer.toBuffer(doc);
  const filepath = `${ARCHIVE_DIR}/Rapport_Mensuel_${monthName(month)}_${year}.docx`;
  fs.writeFileSync(filepath, buf);
  await archiveReport(filepath, "MONTHLY", {startOfMonth: ..., endOfMonth: ...});
  return filepath;
}
```

---

## 4. Présentation PowerPoint 15 slides

Format Forest & Moss palette — reprend `Presentation_Comite_SOLIDE_Juin_2026.pptx` comme template.

### Slides auto-alimentées

1. Couverture (dates du mois)
2. TL;DR — Chiffres clés
3. Évolution mensuelle vs cible
4. Volet maritime — détail 100 navires
5. Volet aviation — détail 358 vols
6. Top 10 armateurs par montant
7. Recouvrement — état des lieux
8. Cabinet d'avocats — statut mandats
9. OFAC / UN — dossiers spéciaux
10. Trajectoire 2026-2030
11. Points d'attention
12. Décisions à valider par le Comité
13. Plan d'action mois suivant
14. Budget prévisionnel
15. Q&R

### Template

Réutiliser `build_pptx_comite.py`. Génération conditionnelle des slides selon événements du mois.

---

## 🔧 Architecture d'automatisation

```
┌────────────────────────────────────────────────────────────────┐
│                                                                 │
│  Cron (cron.d ou n8n) → API endpoint → Service générateur      │
│                                                                 │
│  API endpoint expose:                                           │
│    POST /api/cron/weekly-report                                 │
│    POST /api/cron/monthly-report                                │
│    POST /api/reports/generate?type=X (à la demande)             │
│                                                                 │
│  Service générateur:                                            │
│    1. Query DB pour période concernée                           │
│    2. Compute KPI (compute_kpi.ts)                              │
│    3. Fill template (openpyxl / docx-js / pptxgenjs)            │
│    4. Save to /archive/reports/YYYY/MM/                         │
│    5. Archive metadata to GeneratedReport table                 │
│    6. Send emails avec pièces jointes                           │
│    7. Log dans AuditLog                                         │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

---

## 📧 Envoi automatique des bilans

### Configuration SMTP (Gmail App Password requis)

```yaml
# config/mail.yml
smtp:
  host: smtp.gmail.com
  port: 587
  user: st.operations@greengate.africa
  pass: ${GMAIL_APP_PASSWORD}   # à définir en variable d'env

sender:
  name: "Green-Gate Programme"
  email: st.operations@greengate.africa

signature: |
  Green-Gate Programme
  Directeur : Noël KPATCHAVI
  +33 7 58 66 67 75
```

### Destinataires par type de bilan

```yaml
recipients:
  weekly:
    to:
      - n.kpatchavi@solidetechnology.com
    cc: []
  monthly:
    to:
      - n.kpatchavi@solidetechnology.com
    cc:
      - comite@solidetechnology.com
      - moe@somaliland.gov.so
    bcc:
      - archive@solidetechnology.com
```

### Template email hebdo

```
Objet: 📊 Bilan hebdo Green-Gate — Semaine {WW}/{YYYY}

Bonjour Noël,

Voici le bilan de la semaine {WW}/{YYYY} :

• Recettes facturées cette semaine : USD {facture_hebdo}
• Recettes encaissées cette semaine : USD {encaisse_hebdo}
• Nouveaux navires détectés : {n_nouveaux}
• Restant dû portfolio : USD {portfolio_du}

📎 Pièces jointes :
  - Dashboard_GreenGate_v14_{date}.xlsx
  - Bilan_hebdo_{WW}-{YYYY}.pdf

Bonne journée,
— Green-Gate OS (automatique)
```

---

## 🔍 Consultation historique

Endpoint `GET /api/reports/history` — renvoie tous les bilans générés avec :
- Type · Période · Date de génération · Fichiers
- Filtres : type, période, généré par
- Téléchargement direct depuis l'archive

Écran admin `/admin/reports` :
- Timeline des bilans passés
- Bouton "Regénérer" pour toute période (utile en cas de correction rétrospective)
- Bouton "Envoyer à..." pour renvoyer un bilan archivé

---

## 🧪 Tests d'acceptance

Avant mise en production, valider :

- [ ] Cron `weekly-report` déclenche bien chaque lundi 07:00 UTC
- [ ] Le fichier Excel généré correspond au template validé v14
- [ ] Le PDF hebdo est identique visuellement au template Green Gate OS
- [ ] Les emails sont envoyés aux bons destinataires (test avec compte alias)
- [ ] Les fichiers sont archivés dans `/archive/reports/YYYY/MM/`
- [ ] La table `GeneratedReport` est correctement peuplée
- [ ] En cas d'échec du cron, une alerte Slack/email est envoyée
- [ ] Le regenerate à la demande fonctionne pour une semaine passée

---

## 📌 Objectif final

**Direction Green-Gate consacre 15 minutes/semaine à valider les bilans** (au lieu de 4-6h à les produire).

**Comité SOLIDE reçoit ses rapports mensuels sans intervention humaine**, avec archivage automatique et traçabilité complète.

**Aucun bilan ne peut être oublié** : le système envoie une alerte si un cron échoue ou si un fichier n'est pas généré à temps.

---

*Cette spec complète `RECOUVREMENT_AUTOMATIQUE.md` et `RECONCILIATION_BANCAIRE.md`. Ensemble, ces trois modules constituent le cœur de l'automatisation Green-Gate v2.*
