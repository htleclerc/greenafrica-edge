# PRODUCT REQUIREMENTS DOCUMENT (PRD)
**Produit :** Africgreen (Sovereign Climate Platform)
**Version :** 1.1 (Incluant la stratégie MVP / Sandbox)
**Cible :** Gouvernement du Somaliland (Port de Berbera)

---

## 1. Vision et Objectifs du Produit
Africgreen est une plateforme technologique "GovTech" permettant au Somaliland de monétiser ses atouts climatiques et maritimes. Elle vise à automatiser la collecte d'une contribution carbone (principe pollueur-payeur) auprès des navires transitant ou accostant dans sa ZEE, tout en préparant un registre de crédits carbone souverains.

**Objectifs clés :**
- Générer des revenus immédiats et autofinancés pour l'État sans investissement public lourd.
- Déployer rapidement une preuve de concept (Sandbox/MVP) pour convaincre les ministères et investisseurs.
- Assurer la compétitivité du Port de Berbera via une tarification équilibrée.

## 2. Personas Utilisateurs
- **L'Officier Portuaire (Berbera) :** Vérifie le statut de paiement des navires via une interface simple pour accorder ou bloquer la "Clearance" (départ).
- **L'Agent Maritime / Armateur :** Reçoit les factures pro-forma, effectue les paiements et obtient le certificat de conformité.
- **Le Ministère des Finances / MoECC :** Supervise les recettes fiscales et l'impact écologique via un "Command Center" (Dashboard).
- **L'Administrateur Africgreen :** Gère les configurations techniques, les taux et le registre carbone.

## 3. Périmètre Fonctionnel (Modules Clés)

### Module 1 : Radar Souverain (Tracking Maritime AIS)
- **MVP (Sandbox) :** Affichage d'une carte interactive (Dark mode) de la ZEE avec des navires simulés via des données JSON (Mock Data). Code couleur dynamique : Vert (Payé), Rouge/Orange (Impayé/En approche).
- **Cible V1 :** Ingestion d'API satellite réelle (ex: Spire) et géorepérage (Geofencing) automatisé dans la base de données spatiale (PostGIS).

### Module 2 : Moteur de Facturation (Billing Engine)
- **Calculateur :** Mode forfaitaire (Phase 1) basé sur la capacité en EVP (conteneurs) ou le tonnage. Transition prévue vers un calcul par algorithme cubique (estimation CO2) en Phase 3.
- **Facturation :** Génération instantanée d'un document PDF officiel "Maritime Environmental Levy Notice" avec détails du calcul et statut de paiement.

### Module 3 : Tableau de Bord (Dashboard Ministériel)
- **KPIs en temps réel :** Affichage des "Navires détectés", "Revenus générés (USD)" et "CO2 estimé".
- **Interactivité :** Mise à jour instantanée des compteurs et des statuts sur la carte lors du règlement d'une redevance.

### Module 4 : Green Ledger (Registre Carbone - Phase 2)
- Inventaire des projets verts (mangroves de Zeila) et tokenisation des crédits certifiés (Verra/Gold Standard) pour compensation volontaire des armateurs.

## 4. Architecture et Tech Stack (Recommandée)
- **Approche MVP Rapide :** Low-code/No-code ou framework rapide (type Antigravity, Streamlit, Vue.js) avec données JSON statiques et génération HTML-to-PDF côté client.
- **Approche Cible (V1) :** - Backend : Python (FastAPI/Django) ou Node.js.
  - Base de données : PostgreSQL + PostGIS (pour le calcul géospatial).
  - Frontend : React.js.
  - Sécurité : Chiffrement AES-256, 2FA pour les agents de l'État.

## 5. Roadmap de Déploiement
- **Phase 0 (Mois 1) :** Sandbox Interactif (Démo avec fausses données pour validation politique).
- **Phase 1 (Mois 1 à 6) :** Déploiement du portail V1, redevance forfaitaire, premières factures réelles.
- **Phase 2 (Mois 6 à 18) :** Lancement du Fonds Climat, certification des projets, prévente de crédits.
- **Phase 3 (Mois 18 à 36) :** Modèle hybride automatisé (Taxe + Crédits) et transfert de technologie.