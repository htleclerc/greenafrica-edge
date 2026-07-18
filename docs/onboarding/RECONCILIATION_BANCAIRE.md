# 🏦 Réconciliation bancaire — Guide opérationnel

**Objet** : Documenter le flux de rapprochement paiements bancaires ↔ pro-formas
**Cible** : Développeur intégrateur + équipe compta Green-Gate

---

## 1. Format d'export Premier Bank (à confirmer avec la banque)

### CSV attendu — colonnes minimales

```csv
value_date;booking_date;amount;currency;debit_credit;counterparty_name;counterparty_iban;swift_reference;remittance_information;description
2026-08-15;2026-08-15;3985.12;USD;C;H&P SHIP MANAGEMENT LTD;CY123456789;SWIFT2026081500001;PRO-2026-064001 MV EUROPA;Payment carbon contribution
```

**Champ critique** : `remittance_information` — c'est ici que se trouve la référence pro-forma.

### Format alternatif — MT940 (standard SWIFT)

Si la banque exporte en MT940, ajouter un parser dédié :
```
:20:REF20260815001
:25:100613310001USD
:60F:C260815USD0,00
:61:2608150815CR3985,12NTRFSWIFT2026081500001
:86:Payment PRO-2026-064001 MV EUROPA IMO 9412356
:62F:C260815USD3985,12
```

Bibliothèque suggérée : `mt940` (Python) ou `swiftmt` (Node).

---

## 2. Algorithme de matching

### Pseudo-code

```python
def match_payment(bank_row):
    """Retourne (proforma_id, confidence) ou None"""

    # RÈGLE 1 — Référence exacte dans remittance_information
    ref_match = re.search(r"PRO-2026-\d{6}", bank_row.remittance_info)
    if ref_match:
        pf = Proforma.find(reference=ref_match.group())
        if pf:
            return (pf.id, 1.0)  # 100 %

    # RÈGLE 2 — Référence consolidée
    cons_match = re.search(r"CONS-2026-\d{8}-[A-Z_]+", bank_row.remittance_info)
    if cons_match:
        pf = Proforma.find(reference=cons_match.group())
        if pf:
            return (pf.id, 1.0)

    # RÈGLE 3 — Multi-références (paiement groupé)
    multi_refs = re.findall(r"PRO-2026-\d{6}", bank_row.remittance_info)
    if len(multi_refs) > 1:
        return handle_multi_ref_payment(bank_row, multi_refs)

    # RÈGLE 4 — Match par nom armateur + montant exact
    armateur = fuzzy_match_armateur(bank_row.counterparty_name)
    if armateur:
        candidates = Proforma.find(
            armateur_id=armateur.id,
            total_usd=bank_row.amount,
            payment_status="PENDING"
        )
        if len(candidates) == 1:
            return (candidates[0].id, 0.9)  # 90 %

    # RÈGLE 5 — Match par IMO dans remittance
    imo_match = re.search(r"IMO\s*(\d{7})", bank_row.remittance_info)
    if imo_match:
        navire = Navire.find(imo=imo_match.group(1))
        if navire:
            pf = Proforma.find(navire_id=navire.id, payment_status="PENDING")
            if pf:
                return (pf.id, 0.85)

    # AUCUN MATCH
    return None
```

### Seuils de confiance

| Confidence | Action |
|---|---|
| 1.0 (100 %) | Match auto, statut mis à jour immédiatement, notif envoyée |
| 0.8 – 0.99 | Match "probable" — nécessite validation Direction (dashboard) |
| < 0.8 | Créé en `UnmatchedPayment` — traitement manuel |

---

## 3. Gestion des paiements consolidés

### Cas 1 — Paiement d'une pro-forma consolidée
Référence : `CONS-2026-20260713-ARM-002`
→ Attribution à la pro-forma consolidée, qui met à jour ses N pro-formas individuelles au prorata.

### Cas 2 — Paiement groupé multi-références
Référence : `PRO-2026-064001,064002,064003 CONSOLIDATED`
→ Attribution au prorata des montants dus.

Exemple : USD 30 000 reçu pour 3 pro-formas de USD 10 000, 15 000, 20 000 (total 45 000)
- PRO-064001 : 30 000 × (10/45) = USD 6 666,67 (PARTIAL)
- PRO-064002 : 30 000 × (15/45) = USD 10 000 (PARTIAL)
- PRO-064003 : 30 000 × (20/45) = USD 13 333,33 (PARTIAL)

### Cas 3 — Trop-perçu
USD 12 000 reçu pour PRO-064001 de USD 10 000
→ PRO-064001 marquée PAID
→ USD 2 000 créés en `Credit` sur le compte armateur
→ Application automatique sur pro-forma suivante émise pour ce même armateur

---

## 4. Conversion de devises

Si un armateur paye dans une autre devise que USD (rare mais possible) :

```python
def convert_to_usd(amount, currency, value_date):
    # Utilise l'API BCE (European Central Bank) — gratuit et fiable
    rate = fetch_ecb_rate(currency, "USD", value_date)
    return amount * rate
```

- **Cache local** des taux pour éviter appels répétés
- **Fallback** : taux fixé le vendredi précédent si API indisponible
- **Écart accepté** : ±0,5 % vs montant attendu → considéré comme match

Commission bancaire (frais d'intermédiaire) : à déduire automatiquement de l'attendu si mention dans le message SWIFT.

---

## 5. Traitement des cas particuliers

### 5.1 Paiement anonyme (armateur inconnu)

Ex : virement d'un cabinet d'avocats belge sans référence pro-forma.

**Workflow** :
1. Créer `UnmatchedPayment` avec statut `ANONYMOUS`
2. Envoyer alerte Direction : "Paiement USD X sans référence"
3. Rechercher indice dans `counterparty_name` (nom cabinet)
4. Direction assigne manuellement à un armateur/pro-forma
5. Le système enregistre l'attribution et notifie les parties

### 5.2 Remboursement

Cas : un armateur a payé 2× la même pro-forma par erreur.
- Débit compté négatif dans `Paiement` (montant_usd négatif)
- Notification Direction pour émission virement de remboursement
- Trace complète dans AuditLog

### 5.3 Contestation

Si un armateur conteste après paiement partiel :
- Passer proforma en `DISPUTED`
- Bloquer relances J+15/J+30/J+45
- Attention manuelle Direction requise
- Coordination avec cabinet d'avocats

---

## 6. Interface d'administration

### Écran `/admin/payments/unmatched`

Liste tous les `UnmatchedPayment` non résolus, avec :
- Colonnes : Date · Montant · Contrepartie · Message SWIFT · Actions
- Actions : `[Attribuer à pro-forma]` `[Créer nouvel armateur]` `[Rembourser]` `[Archiver]`
- Filtre par âge (nouveau/24h+/48h+/7j+) — priorisation

### Écran `/admin/payments/history`

Historique complet des paiements avec :
- Filtres : armateur, période, statut, méthode
- Export CSV / Excel
- Visualisation graphique cumul

---

## 7. Fichiers de test

Trois fichiers CSV de test pour valider l'implémentation :

**`test_bank_import_1_simple.csv`** — 3 paiements simples avec réf claire
**`test_bank_import_2_multi.csv`** — 5 paiements dont 2 groupés
**`test_bank_import_3_edge.csv`** — 4 paiements avec cas particuliers (anonyme, trop-perçu, devise EUR)

À générer par le développeur pour couvrir les tests unitaires.

---

## 8. KPI de qualité du matching

À afficher en dashboard admin :

| Indicateur | Cible |
|---|---|
| Taux de matching automatique (règle 1) | > 90 % |
| Taux de matching probable (règles 2-5) | > 5 % |
| Taux non-matché | < 5 % |
| Délai moyen résolution non-matché | < 24h |
| Taux d'erreur (mismatch corrigé) | < 0,1 % |

Ces KPI sont recalculés à chaque import bancaire.

---

*Ce guide est le complément technique de `RECOUVREMENT_AUTOMATIQUE.md`. Le développeur peut s'y référer pendant l'implémentation du module bancaire.*
