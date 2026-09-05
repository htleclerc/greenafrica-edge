# 🚢✈ Processus d'Onboarding Green-Gate — v2 Unifié

**Périmètre** : Maritime (armateurs) + Aviation (compagnies aériennes)
**Version** : v2 (révision complète — 13 juillet 2026)
**Auteur** : Noël KPATCHAVI · Direction Green-Gate Programme

---

## 🎯 Objectif du processus

Faire passer chaque **débiteur** (armateur maritime ou compagnie aérienne) de l'état
**« détecté »** à l'état **« client actif payant »** en 45 à 90 jours, avec traçabilité
complète, conformité OFAC/UN, et automatisation à 90 %.

**Résultat visé** : à 12 mois, 80 % des débiteurs identifiés sont en statut `ACTIVE`
avec un taux de recouvrement effectif > 60 %.

---

## 🔄 Vue d'ensemble — Workflow en 7 étapes

```
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ①  DÉTECTION       ── automatique (VesselFinder / SCAA / FlightRadar24)   │
│      ↓                                                                       │
│  ②  IDENTIFICATION  ── semi-auto (Equasis / TrustedDocks / IATA registry)   │
│      ↓                                                                       │
│  ③  SCREENING       ── automatique (OFAC SDN + UN prohibited)               │
│      ↓                                                                       │
│  ④  INVITATION      ── envoi automatique (pro-forma + kit d'onboarding)     │
│      ↓                                                                       │
│  ⑤  KYC             ── formulaire self-service ou complété par l'équipe    │
│      ↓                                                                       │
│  ⑥  SIGNATURE       ── conditions Green-Gate signées électroniquement       │
│      ↓                                                                       │
│  ⑦  ACTIVATION      ── client actif · portail self-service · facturation   │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

**Statuts possibles à tout moment** :
`DETECTED` → `IDENTIFIED` → `SCREENED` → `INVITED` → `KYC` → `SIGNED` → `ACTIVE`
Cas particuliers : `BLOCKED_OFAC` · `BLOCKED_UN` · `SUSPENDED` · `DISPUTED` · `CHURNED`

---

## ① Étape 1 — DÉTECTION

### Objectif
Repérer tout navire ou vol entrant dans la zone Green-Gate (Port de Berbera ou Somaliland FIR)
en < 6 heures après le premier signal.

### Maritime
| Source | Fréquence | Champs récupérés |
|---|---|---|
| **VesselFinder API** | 6h | IMO, MMSI, ETA, position, GT |
| **Marine Traffic** | 6h | Redondance + vérification |
| **Port de Berbera (SCAA-Maritime)** | Manuel | Liste des escales confirmées quotidiennes |
| **AIS satellite** | Temps réel | Backup pour navires hors zone couverture |

### Aviation
| Source | Fréquence | Champs récupérés |
|---|---|---|
| **Somaliland Civil Aviation Authority (SCAA)** | Quotidien | Plans de vol officiels |
| **FlightRadar24 API** | 6h | Cross-check vols effectifs |
| **ADS-B** | Temps réel | Détection automatique arrivées |
| **Aéroports HGA + BBO** | Quotidien | Redevances collectées |

### Actions déclenchées
- Création de l'entité `navire` ou `vol` en base
- Statut initial : `DETECTED`
- Notification équipe OPS Green-Gate (si nouvelle entité)
- Kick-off du timer 6h pour identification

### KPI cible
- Délai détection → identification : < 6 h en médiane
- Taux de détection : > 98 % (comparé aux données consolidées ex-post)

---

## ② Étape 2 — IDENTIFICATION

### Objectif
Rattacher chaque navire/vol à son **débiteur légal** (armateur ou compagnie aérienne).

### Maritime — Rechercher l'armateur légal
| Outil | Coût | Fiabilité | Usage |
|---|---|---|---|
| **Equasis** | Gratuit | ★★★★☆ | Recherche IMO → owner registered |
| **IMO Manager DB** | Payant | ★★★★★ | ISM Manager (opérateur effectif) |
| **TrustedDocks** | USD 3 000/an | ★★★★★ | Base commerciale enrichie |
| **P&I Clubs registers** | Payant | ★★★☆☆ | Assurance civile (indice) |
| **Ambassades / consulats** | Diplomatique | Variable | Confirmation officielle |

### Aviation — Rechercher la compagnie aérienne
- **Code IATA** de vol → identification immédiate de la compagnie (déjà connue)
- **Cross-check ICAO** pour les vols cargo ou charter
- **Contact direct** avec l'aéroport si opérateur ambigu

### Résultat
- Statut passe de `DETECTED` à `IDENTIFIED`
- Enrichissement fiche `armateur` ou `compagnie` (adresse, contact, pavillon)
- Si non identifié dans 72h → marquer `PENDING_LOOKUP` et batch quotidien

### KPI cible
- Taux d'identification à 72h : > 60 % (maritime) / > 95 % (aviation)
- Taux d'identification finale (30 jours) : > 90 %

---

## ③ Étape 3 — SCREENING RÉGLEMENTAIRE

### Objectif
Vérifier qu'aucun contact commercial ne peut être engagé avec un débiteur sous sanctions.

### Checks obligatoires
| Contrôle | Base | Fréquence | Action si positif |
|---|---|---|---|
| **OFAC SDN List** (USA) | Treasury.gov API | À la création + refresh hebdo | Statut `BLOCKED_OFAC` — IN REM only |
| **UN Sanctions List** | UN.org XML feed | À la création + refresh hebdo | Statut `BLOCKED_UN` — notification consulaire only |
| **EU Sanctions** | EU Financial Sanctions | À la création + refresh mensuel | Analyse au cas par cas |
| **UK OFSI** | HM Treasury | À la création + refresh mensuel | Analyse au cas par cas |

### Cas connus dans le portefeuille actuel
| Débiteur | Type de sanction | Statut | Traitement |
|---|---|---|---|
| **IRISL / Valfajr** | OFAC SDN (Iran) | `BLOCKED_OFAC` | Bailiff Eidle Omer — in rem |
| **Petrofleet** | OFAC SDN | `BLOCKED_OFAC` | Bailiff — navires immobilisés |
| **Morgan Navigation** (Beirut) | UN prohibited | `BLOCKED_UN` | Notification consulaire uniquement |

### KPI cible
- 100 % des nouveaux débiteurs screened avant toute action commerciale
- 0 faux négatif (mesure : audit trimestriel des envois vs SDN à date)

---

## ④ Étape 4 — INVITATION

### Objectif
Émettre la première **pro-forma** et l'envoyer avec le **kit d'onboarding**, déclenchant le compte à rebours J+30 pour le paiement.

### Contenu de l'envoi
1. **Pro-forma PDF** (format Green Gate OS — logos + drapeau + sceau)
2. **Lettre d'accompagnement** rappelant :
   - Base légale (Décret MOE&CC/MWI/36/2026)
   - Formule de calcul
   - Modalités bancaires (Premier Bank + SWIFT)
   - Contact Direction (Noël KPATCHAVI)
3. **FAQ 2 pages** (contestation, méthodologie, recours)
4. **Lien vers le portail** self-service (à activer après KYC)

### Modalités d'envoi
| Canal | Priorité | Usage |
|---|---|---|
| **Email direct** | 1 | Si contact email connu et vérifié |
| **Email agent / ISM manager** | 2 | Si armateur direct injoignable |
| **P&I Club** (interpellation) | 3 | Pour armateurs européens |
| **Notification consulaire** | 4 | Pour armateurs BLOCKED_UN |
| **Bailiff notification** | 5 | Pour armateurs BLOCKED_OFAC (via Eidle) |

### Automatisation
- Cron quotidien 08:00 UTC scanne les entités `IDENTIFIED + SCREENED` non `INVITED`
- Génère la pro-forma consolidée si multi-escales
- Envoie via SMTP (`st.operations@greengate.africa`) avec CC Noël KPATCHAVI
- Throttle : 30 s entre envois (rate limit Gmail)
- Passe le statut à `INVITED` + démarre timer J+15/J+30/J+45

### KPI cible
- Délai identification → invitation : < 24 h
- Taux d'ouverture email (open rate) : > 40 %
- Taux de réponse dans 15 jours : > 25 %

---

## ⑤ Étape 5 — KYC (Know Your Customer)

### Objectif
Collecter et vérifier les données obligatoires du débiteur pour formaliser la relation.

### Données requises (formulaire self-service)
**Armateur maritime** :
- Raison sociale légale + numéro d'immatriculation
- Pays de siège social + adresse complète
- Contact commercial (nom, email, téléphone)
- Contact finance (nom, email, téléphone)
- Contact technique / opérations
- Liste complète des navires exploités (IMO)
- ISM Manager si distinct de l'owner
- Coordonnées P&I Club
- Preuve d'immatriculation (upload PDF)

**Compagnie aérienne** :
- Raison sociale + code IATA / ICAO
- Pays de siège + adresse
- Contact opérations aériennes
- Contact finance / comptabilité
- Liste des lignes régulières vers Somaliland FIR
- Contrats de leasing si applicable
- Coordonnées assureur RC aviation

### Workflow
- Invitation envoyée dans le mail initial (étape 4) — lien unique par débiteur
- Formulaire remplissable en ligne (portail Green-Gate)
- Validation par l'équipe OPS sous 3 jours ouvrés
- Vérification consulaire pour les adresses > USD 100 000 dus

### Statut
- Passe à `KYC` quand formulaire soumis
- Si validation OK → `KYC_VALIDATED`
- Si documents manquants → retour au débiteur avec relance

### KPI cible
- Taux de complétion KYC après invitation : > 40 %
- Délai moyen soumission KYC : < 30 jours après invitation

---

## ⑥ Étape 6 — SIGNATURE

### Objectif
Formaliser l'engagement du débiteur via signature électronique des Conditions Générales Green-Gate.

### Documents à signer
1. **Conditions Générales Green-Gate** (10 pages) — CGV commerciales
2. **Convention de reddition de comptes** — engagement de reporting
3. **Autorisation de facturation automatique** — pour les escales/vols futurs
4. **Adhésion ASCR** (optionnel — recommandé pour bénéfices écosystème)

### Outil de signature
- **DocuSign** (préféré) ou équivalent
- Signature qualifiée eIDAS pour armateurs européens
- Confirmation SMS + email pour armateurs hors UE

### Résultat
- Statut passe à `SIGNED`
- Contrat archivé dans le dossier client
- Activation du portail self-service prévue sous 48h

### KPI cible
- Taux de signature après KYC : > 70 %
- Délai KYC → signature : < 14 jours

---

## ⑦ Étape 7 — ACTIVATION

### Objectif
Passer le débiteur en client actif, avec facturation automatique de toutes les escales/vols futurs.

### Ce qui est activé
- **Portail self-service** — accès au tableau de bord personnel
  - Historique escales / vols
  - Pro-formas émises et statut de paiement
  - Téléchargement PDFs signés
  - Enregistrement de paiement + upload preuve SWIFT
  - FAQ + contact support dédié
- **Facturation automatique** — dès détection nouvelle escale/vol
- **Regroupement mensuel** (option pour aviation) — 1 pro-forma consolidée par mois
- **Rapport trimestriel personnalisé** envoyé par email

### Communication
- Email de bienvenue signé Noël KPATCHAVI
- Identifiants portail transmis en 2 messages séparés (sécurité)
- Rendez-vous téléphonique proposé dans les 15 jours

### Statut
- Passe à `ACTIVE`
- Devient contributeur régulier au portefeuille

### KPI cible
- Taux d'activation dans les 90 jours après détection : > 50 %
- Taux de recouvrement effectif pour clients actifs : > 85 %

---

## 🔀 Différences MARITIME vs AVIATION

| Aspect | Maritime | Aviation |
|---|---|---|
| **Nombre d'escales par débiteur** | 1 à 5 par mois | 20 à 90 par mois |
| **Facturation par défaut** | Par escale | Consolidée mensuelle |
| **Base juridique** | UNCLOS Art. 211 + IMO | Chicago 1944 Art. 15 & 24 + CORSIA |
| **Formule** | CO₂ × 50 % × USD 40 | CO₂ × RFI 2.0 × USD 40 |
| **Identification** | Complexe (Equasis) | Simple (IATA) |
| **Screening OFAC/UN** | Courant | Rare |
| **P&I Club** | Levier majeur | Non applicable |
| **Saisie in rem** | Possible dans tout port | Non applicable |
| **Enjeu diplomatique** | Par pavillon | Par compagnie nationale |
| **Contentieux** | Bailiff + cabinets Anvers | Négociation directe |

---

## 🚦 Cas particuliers

### Cas 1 — Débiteur BLOCKED (OFAC/UN)
**Workflow spécial IN REM** :
1. Aucun contact direct autorisé
2. Notification transmise au Bailiff (Me Eidle Omer, Hargeisa)
3. Bailiff émet notification officielle et engage procédure
4. Saisie conservatoire possible dans tout port européen (Convention Bruxelles 1952)
5. Compagnies aériennes : notification consulaire uniquement

### Cas 2 — Compagnies aériennes somaliennes (Daallo, Jubba)
**Workflow diplomatique** :
- Coordination directe avec Ministère MOE&CC
- Approche pédagogique préalable avant toute mise en demeure
- Reporting spécifique au Ministère
- Traitement au cas par cas par la Direction

### Cas 3 — Compagnie pivot (Ethiopian Airlines)
**Workflow VIP** :
- RDV préalable Direction avant toute facturation formelle
- Négociation possible d'un accord global annuel
- Positionnement comme partenaire panafricain de référence

### Cas 4 — Débiteur en contestation formelle
**Workflow disputes** :
- Statut passe à `DISPUTED`
- Blocage automatique des relances J+15/J+30/J+45
- Escalade au Directeur (Noël KPATCHAVI)
- Réponse motivée sous 15 jours
- Si non-résolu à 45 jours → arbitrage ou contentieux

### Cas 5 — Trop-perçu ou paiement erroné
**Workflow financial correction** :
- Enregistrement d'un paiement négatif
- Notification Direction sous 24h
- Émission virement de remboursement sous 15 jours
- Trace complète dans AuditLog

---

## 🤖 Automatisation — Cron jobs

| Cron | Fréquence | Endpoint | Action |
|---|---|---|---|
| Détection navires | 6h | `POST /cron/vessels-sync` | Sync VesselFinder + Marine Traffic |
| Détection vols | 6h | `POST /cron/aviation-sync` | Sync SCAA + FlightRadar24 |
| Identification batch | Quotidien 09:00 | `POST /cron/lookup-batch` | Equasis / TrustedDocks |
| Screening OFAC/UN | Hebdo | `POST /cron/sanctions-refresh` | Re-scan complet |
| Envoi pro-formas | Quotidien 08:00 | `POST /cron/send-invitations` | Nouveaux `IDENTIFIED + SCREENED` |
| Relances tick | Quotidien 08:00 | `POST /cron/relances-tick` | J+15 / J+30 / J+45 dues |
| Réconciliation bancaire | Quotidien 07:00 | `POST /cron/bank-import` | Import CSV Premier Bank |
| Bilans hebdo | Lundi 07:00 | `POST /cron/weekly-report` | Dashboard + PDF |
| Bilans mensuels | 1er du mois 07:00 | `POST /cron/monthly-report` | Word + PPTX |

---

## 📊 KPI globaux d'onboarding

| Indicateur | Cible | Fréquence de mesure |
|---|---:|---|
| Délai médian détection → identification | < 6 h | Quotidien |
| Taux identification à 72h (maritime) | > 60 % | Hebdo |
| Taux identification à 72h (aviation) | > 95 % | Hebdo |
| Taux screening 100 % avant envoi | 100 % | Chaque envoi |
| Délai identification → invitation | < 24 h | Quotidien |
| Taux d'ouverture email invitation | > 40 % | Mensuel |
| Taux de complétion KYC (30 jours) | > 40 % | Mensuel |
| Taux de signature après KYC | > 70 % | Mensuel |
| Taux d'activation à 90 jours | > 50 % | Mensuel |
| Taux de recouvrement clients actifs | > 85 % | Mensuel |
| Taux de recouvrement global portefeuille | > 60 % | Trimestriel |

---

## 🎯 État actuel du portefeuille (12 juillet 2026)

| Métrique | Maritime | Aviation | Total |
|---|:---:|:---:|:---:|
| Débiteurs détectés | 100 navires | 556 vols | 656 documents |
| Débiteurs identifiés | 25 armateurs | 6 compagnies | 31 |
| En cours d'identification | 75 navires | 0 | 75 |
| Sous sanctions (BLOCKED) | 3 armateurs | 0 | 3 |
| Statut `INVITED` | 0 (mandat en cours) | 0 (mandat en cours) | 0 |
| Statut `ACTIVE` | 0 | 0 | 0 |
| Facturable total | USD 1 889 653 | USD 861 237 | **USD 2 750 890** |
| Payé à ce jour | USD 0 | USD 0 | USD 0 |

**Prochain jalon** : premier statut `INVITED` prévu à l'issue de l'envoi du mandat aux cabinets d'Anvers (fin juillet 2026).

---

## 🗓️ Roadmap d'implémentation

### Q3 2026 (juillet-septembre)
- Finaliser mandat cabinets Anvers (5 cabinets)
- Envoyer les 26 premières pro-formas consolidées avec kits d'onboarding
- Premières relances J+15/J+30/J+45 automatisées
- Objectif : 50 % des débiteurs en `INVITED`

### Q4 2026 (octobre-décembre)
- Mise en production portail self-service
- Premières activations clients (statut `ACTIVE`)
- Réconciliation bancaire automatique opérationnelle
- Objectif : 20 % de débiteurs `ACTIVE` + premiers encaissements

### 2027
- Alignement IMO Net-Zero + CORSIA (obligatoires)
- Extension à un 5ᵉ État africain (Sénégal / Kenya / Côte d'Ivoire candidat)
- Objectif : 60 % de débiteurs `ACTIVE` + USD 8 M encaissés

---

## 📚 Documents de référence associés

- `ONBOARDING_ARMATEURS.md` — Détails maritime v1
- `ONBOARDING_COMPAGNIES_AVIATION.md` — Détails aviation v2
- `RECOUVREMENT_AUTOMATIQUE.md` — Automatisation post-invitation
- `RECONCILIATION_BANCAIRE.md` — Matching SWIFT ↔ pro-forma
- `BILAN_AUTO_GENERATION.md` — Reporting auto (4 livrables)
- `RECAPITULATIF_COMPLET.md` — Vue portefeuille consolidé

---

## 📞 Contacts opérationnels

| Fonction | Personne | Coordonnées |
|---|---|---|
| **Direction Green-Gate** | Noël KPATCHAVI | +33 7 51 42 23 84 · `st.operations@greengate.africa` |
| **Bailiff Somaliland** | Me Eidle Omer | `eidle@eidle-advocats.so` |
| **Cabinets Anvers (mandat)** | Van Hooydonk · Kegels · HBSV · D'Hoine · Karell M. | Voir mandat GG-MDT-2026-BE-001 |
| **Autorité de tutelle** | Ministère de l'Environnement Somaliland | Décret MOE&CC/MWI/36/2026 |
| **Auditeurs** | AmSpec + Forvis Mazars | Audit conjoint annuel |

---

*Ce processus v2 remplace les versions antérieures. Il unifie les workflows maritime
et aviation en un seul parcours cohérent, tout en préservant les spécificités
métier de chaque volet. Toute modification substantielle doit être validée par le
Comité SOLIDE avant application opérationnelle.*
