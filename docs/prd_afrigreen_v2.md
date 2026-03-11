# PRODUCT REQUIREMENTS DOCUMENT (PRD) - V2.2
**Produit :** AfricGreen (Sovereign Ecological Governance Platform - AIS Portal)
**Version :** 2.2 (Plateforme Unique Centralisée, Multi-Pays, IA)
**Cible Principale :** Gouvernements africains (Finances, Environnement, Autorités Portuaires)
**Date :** Mars 2026

---

## 1. Vision et Objectifs Stratégiques
AfricGreen est la plateforme souveraine panafricaine ("GovTech") permettant aux États de valoriser et taxer leur espace environnemental. 

Contrairement à une ébauche passée, la décision architecturale de la V2.2 est de **bâtir une SEULE plateforme Web mutualisée (le AIS Portal)**. Ce portail unifié adapte dynamiquement son interface et ses modules en fonction du profil de l'utilisateur de l'État (RBAC).

**Objectifs de l'Unification :**
- **Un seul backend de vérité :** Pas de silos. Une décision fiscale du Ministère impacte en live le système d'alerte des garde-côtes.
- **Réduction des coûts d'infrastructure :** Une seule codebase Next.js pour servir tous les besoins institutionnels, des impôts au suivi des navires par IA.
- **Protocole Panafricain Global :** Interconnecter plusieurs pays signataires dans un seul "Command Center" digitalisé.

---

## 2. Périmètre Fonctionnel : Les Modules de l'AIS Portal

Le SI AfricGreen se découpe en fonctionnalités métier accessibles par droits :

### Module 1 : Command Center Maritime (Surveillance Opérationnelle)
*Design UI : "Dark Ops", haute performance, focus temps réel.*
*Accès : Autorités portuaires, Garde-côtes, Officiers de Douane.*

- **The Eye (Live Map) :** Radar géospatial alimenté par satellite. Traçage des flottes à travers les différentes "Zones" des ZEE africaines.
- **Flotte & Conformité En-Direct :** Liste temps réel avec les statuts : `PAYMENT DUE` (En transit dans la ZEE), `COMPLIANT` (Redevance payée/Crédit HT), `PROCESSING` (À quai).
- **Actions Immédiates :** Identification IA des bateaux en évasion de radar ("Dark Fleet"), exécution de factures "Pro-Forma", interdiction électronique de Clearance.

### Module 2 : Tax Management & Paramétrage
*Design UI : Analytique, structuré, configurations B2G.*
*Accès : Ministères des Finances, Administrateurs Régaliens.*

- **Moteur Fiscale Configurable :** Paramétrage au millimètre du tarif carbone ($/TCO2e), segmentable par `Vessel Category` (Container vs Cargo) et `Jurisdiction Zone` (ZEE vs Port Vicinity), via un système de multiplicateurs (`1.2x`).
- **Gestion des Exemptions :** Formulaire de dérogation pour la flotte militaire, la recherche scientifique ou l'Humanitaire (ONU).
- **Transaction Logs Auditables :** Export des bilans avec de multiples sous-comptes (`Entry Tax`, `Transit Fee`, `Port Stay`).

### Module 3 : Projets Verts et Registre Carbone (Green Ledger)
*Design UI : Institutionnel, clair, Trust, public.*
*Accès : Administrations institutionnelles, Entreprises du Scope 1, Auditeurs Tiers.*

- **Sovereign Access & Logs :** Authentification ultra-sécurisée (SSO Gouvernemental, Magic Link) et suivi inaltérable ("Audit Log") de chaque validation de document étatique.
- **Workflow de Certification de Projets :** Pipeline intégré (Pre-cadre → Validation → Transfert) gérant le téléversement de preuves (PDD, Land Tenure, EIA) et l'assignation d'auditeurs externes (ex: SGS). 
- **Calculateur Universal d'Émissions :** Portail d'achat direct de compensations (Off-sets) destiné autant aux acteurs maritimes qu'aux opérateurs terrestres à qui l'on impute des émissions (Scope 1). 

---

## 3. L'Intelligence Artificielle en Socle Profond

L'AIS Portal ne fait pas que restituer de la donnée, l'IA produit cette donnée en tâche de fond :
- **Base Panafricaine Géospatiale :** L'algorithme ML lit les coordonnées AIS, croise avec les polygones Mégadonnées (PostGIS) et distribue automatiquement et dynamiquement la facture aux différents pays côtiers traversés.
- **IA d'Estimation OMI :** Via le respect de la Loi Cubique standardisée, l'IA estime le besoin de carburant et les rejets CO2 d'un navire de façon empirique lorsqu'il est impossible de poser un compteur physique dessus.

---

## 4. Architecture Unifiée Recommandée
- **Frontend Unique :** Next.js 14+ / React. App Router, Layouts intelligents selon le contexte de l'utilisateur (Thème Sombre vs Thème Clair). TailwindCSS pour stylisation flexible. Mapbox GL JS pour centraliser l'observation géospatiale.
- **Backend Plateforme :** Go (Robuste face à des milliers d'événements temporels/AIS). Modèles ML Python en services externes.
- **Base de Données / Spatial :** PostgreSQL avec PostGIS incontournable (Découpe algorithmique entre 2 pays et calcul de miles nautiques intra ZEE).

---

## 5. Roadmap Immédiate Panafricaine

**Phase V1.5 - Alpha Mutualisée (1 à 2 mois)**
1. Refonte complète du modèle de données (Entity-Relationship unifié avec domaine IA `TransitSegments`, Multi-Pays, paramétrages Fiscaux `TaxConfiguration`, Workflow `ProjectDocuments`).
2. Création de toutes les Routing pages et composants UX du Frontend Next.js :
   - Panneau Map "Command Center" Temps Réel
   - Panneau "Tax Settings" pour l'admin.
   - Project Overview et upload de certificats.
3. Remplacement des mock-datas simples par un mock-data complexe démontrant tous ces parcours. 

**Phase V2.0 - Le Pipeline Réel (3 à 6 mois)**
- Lancement de la base PostgreSQL réelle.
- Branchement des flux AIS spatioportés.
- Validation des méthodes de paiements et de "Clearence" portuaire entre deux ZEE Panafricaines.
