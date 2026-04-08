# Enrichissement Landing Page — Africgreen
### Source : `DOC-20260401-WA0124.docx` (Communiqué stratégique bilingue EN/FR)
### Date d'analyse : 2026-04-01

---

## 1. Résumé du document source

Le document est un **communiqué de presse / brief stratégique bilingue** (EN + FR) qui positionne Solide Technology comme l'entité commerciale derrière la plateforme Africgreen. Il apporte trois blocs de valeur que le site ne couvre pas encore :

| Bloc | Contenu clé | Présence actuelle sur le site |
|---|---|---|
| **Identité entreprise** | Solide Technology, DNA africain, 3 fondateurs nommés | ❌ Absent |
| **Validation terrain** | Partenariat Somaliland + "Green Gate Digital System" | ⚠️ Partiel (SVG hardcodé) |
| **Vision stratégique** | Observatoire africain de la fiscalité carbone | ❌ Absent |

---

## ✅ Décisions confirmées (2026-04-01)

| Décision | Statut |
|---|---|
| **Nom produit** : "Africgreen" (pas "AIS Portal") | ✅ Confirmé |
| **Nom commercial** : Solide Technology | ✅ Confirmé |
| **Sous-titre produit** : "Green Gate Digital System" | ✅ Confirmé — à promouvoir sur la landing page |
| **Scope** : Maritime + Aéroportuaire (pas seulement maritime) | ✅ Confirmé |

---

## 2. Composants de la landing page — État actuel

```
frontend/src/components/landing/
├── LandingPage.tsx         ← Orchestrateur (Navbar → Hero → Capabilities → Simulation → Sovereign → Footer)
├── HeroSection.tsx         ← Badge + titre + CTA + "Trusted by" (4 placeholders vides)
├── CapabilitiesSection.tsx ← 3 cards : Maritime Carbon Tax / Carbon Credits / AIS
├── SimulationSection.tsx   ← Simulateur de revenus carbone
├── SovereignSection.tsx    ← Features Paris Agreement + stats mock + carte SVG Berbera
├── AdminWorkflowSection.tsx
├── FinancialSection.tsx
├── ImpactSection.tsx
└── FeaturesFaqSection.tsx
```

> **Note** : `AdminWorkflowSection`, `FinancialSection`, `ImpactSection`, `FeaturesFaqSection` sont importées dans d'autres pages mais **pas** dans `LandingPage.tsx` — elles ne sont donc pas visibles sur la homepage publique.

---

## 3. Gaps identifiés et actions par composant

### 3.1 `HeroSection.tsx`

**Problème — Badge trop restrictif**
```
Actuel : "SOVEREIGN CARBON INTELLIGENCE PROTOCOL"
```
Le document positionne Africgreen sur **deux types de taxes** (carbone + environnementales) et **deux secteurs** (maritime + aéroportuaire). Le badge et le sous-titre hero ne reflètent que le maritime.

**Action requise : mise à jour i18n uniquement**

```jsonc
// frontend/messages/en.json — Landing
"badge": "AFRICA'S SOVEREIGN CARBON & ENVIRONMENTAL INTELLIGENCE PLATFORM",
"hero_subtitle": "A comprehensive digital solution enabling African states to monitor, collect, and optimize carbon and environmental taxes across maritime and airport operators — powered by blockchain for sovereignty, traceability, and zero fraud."
```

```jsonc
// frontend/messages/fr.json — Landing
"badge": "PLATEFORME AFRICAINE D'INTELLIGENCE CARBONE ET ENVIRONNEMENTALE SOUVERAINE",
"hero_subtitle": "Solution numérique permettant aux États africains de surveiller, collecter et optimiser les taxes carbone et environnementales auprès des opérateurs maritimes et aéroportuaires — propulsée par la blockchain pour la souveraineté, la traçabilité et la lutte anti-fraude."
```

---

**Problème — "Trusted by" avec 4 boîtes vides**
```tsx
// HeroSection.tsx ligne 69–72 — 4 divs vides
{[1, 2, 3, 4].map((i) => (
    <div key={i} className="h-6 w-12 sm:h-8 sm:w-16 rounded-md" ... />
))}
```
Le document valide **Somaliland** comme premier partenaire souverain signataire.

**Action** : Remplacer les placeholders par au minimum le nom/logo Somaliland une fois le logo disponible. Créer une clé i18n :
```jsonc
"trusted_partner_1": "Somaliland",
"trusted_partner_label": "FIRST DEPLOYMENT — GREEN GATE DIGITAL SYSTEM"
```

---

### 3.2 `CapabilitiesSection.tsx`

**Problème — Périmètre limité au maritime**

Les 3 cards actuelles (Tax / Credits / AIS) ne couvrent que le maritime. Le document mentionne explicitement les **opérateurs aéroportuaires** comme second marché cible.

**Action** : Ajouter une 4e card pour la Phase 2.

```tsx
// Nouvelle card à ajouter dans capabilities[]
{
    icon: Plane,            // from lucide-react
    title: t('cap_airport_title'),
    desc: t('cap_airport_desc'),
    gradient: 'from-purple-500/20 to-purple-900/10',
    iconBg: 'bg-purple-500/10',
    iconColor: 'text-purple-400',
}
```

```jsonc
// en.json — Landing
"cap_airport_title": "Airport Environmental Tax",
"cap_airport_desc": "Extension of the fiscal engine to airport operators — automated calculation of environmental levies on air traffic within sovereign territories.",

// fr.json — Landing
"cap_airport_title": "Taxe Environnementale Aéroportuaire",
"cap_airport_desc": "Extension du moteur fiscal aux opérateurs aéroportuaires — calcul automatisé des taxes environnementales sur le trafic aérien en territoire souverain."
```

---

### 3.3 `SovereignSection.tsx`

**Problème 1 — Features Paris Agreement trop génériques**

```
Actuel :
sovereign_feat1: "Compliant with international maritime regulations"
sovereign_feat2: "Real-time satellite data integration"
sovereign_feat3: "Secure blockchain-backed ledger for transactions"
```

Le document insiste sur deux différenciateurs absents : **indépendance et souveraineté dans l'accès aux données**, et **garantie anti-fraude/falsification**.

```jsonc
// en.json — Landing
"sovereign_feat1": "Blockchain-secured traceability — zero fraud, zero falsification",
"sovereign_feat2": "Full data sovereignty — local hosting, independent access",
"sovereign_feat3": "IMO-compliant and Paris Agreement Article 6.2 & 6.4 ready"

// fr.json — Landing
"sovereign_feat1": "Traçabilité sécurisée par blockchain — zéro fraude, zéro falsification",
"sovereign_feat2": "Souveraineté totale des données — hébergement local, accès indépendant",
"sovereign_feat3": "Conforme OMI et Accord de Paris Articles 6.2 & 6.4"
```

**Problème 2 — "Berbera Maritime Zone" hardcodé**
```tsx
// SovereignSection.tsx ligne 59 — texte hardcodé
<p className="text-[10px] mt-0.5" ...>Berbera Maritime Zone</p>
```
Ce texte doit passer en i18n.
```jsonc
"sovereign_zone_label": "Berbera Maritime Zone — Somaliland EEZ"
```

---

### 3.4 `Footer.tsx`

**Problème — Copyright "AIS Portal" sans mention de Solide Technology**

```
Actuel : "© 2024 AIS Portal. All rights reserved. Republic of Somaliland."
```

Le document identifie **Solide Technology** comme l'entité légale propriétaire de la plateforme Africgreen.

```jsonc
// en.json — Footer
"copyright": "© 2026 Africgreen by Solide Technology. All rights reserved.",
"tagline": "A 100% African digital solution for sovereign carbon governance."

// fr.json — Footer
"copyright": "© 2026 Africgreen par Solide Technology. Tous droits réservés.",
"tagline": "Une solution digitale 100% africaine pour la gouvernance carbone souveraine."
```

---

## 4. Nouveaux composants à créer

### 4.1 `AboutSection.tsx` — Priorité 🔴 HAUTE

**Source dans le document** : paragraphes sur les 3 fondateurs + concept d'ADN africain.

**Chemin** : `frontend/src/components/landing/AboutSection.tsx`

**Insertion dans `LandingPage.tsx`** : entre `<CapabilitiesSection />` et `<SimulationSection />`

**Structure suggérée** :
```tsx
<AboutSection>
  ├── Badge : "SOLIDE TECHNOLOGY — 100% AFRICAN DNA"
  ├── Titre : "Born from African Expertise, Built for Africa"
  ├── Sous-titre : paragraph from document
  └── 3 founder cards :
      ├── KPATCHAVI Noel Hiverto — CEO, Solide Technology
      ├── RADJI Safiou — Chartered Accountant, pioneer of sustainable finance in Africa
      └── DIA Mamadou — Business strategist & African government relations
```

**Clés i18n à créer dans les 5 locales** :

```jsonc
// Landing namespace
"about_badge": "SOLIDE TECHNOLOGY — 100% AFRICAN DNA",
"about_title": "Born from African Expertise, Built for Africa",
"about_subtitle": "In a carbon market undergoing rapid transformation across the African continent, Solide Technology — a 100% African player — reaffirms its credibility as a strategic partner for states in enhancing the value of their environmental and green resources.",
"about_dna_title": "An exclusively African DNA",
"about_dna_desc": "This uniqueness goes beyond symbolism. It embodies a new generation of African leaders who no longer merely observe the continent's challenges, but take on the historic responsibility to enable Africa to decide for itself, by itself — and propose a model for the rest of the world.",
"about_team_label": "THE FOUNDING TEAM",
"about_founder1_name": "Noel Hiverto KPATCHAVI",
"about_founder1_role": "CEO, Solide Technology",
"about_founder1_bio": "Leading long-term PPP (Public-Private Partnership) projects and technology transfer initiatives across the African continent.",
"about_founder2_name": "Safiou RADJI",
"about_founder2_role": "Chartered Accountant — Sustainable Finance & Digital Innovation",
"about_founder2_bio": "Pioneer of sustainable finance in Africa, specialist in digital innovation and expertise transfer to African markets.",
"about_founder3_name": "Mamadou DIA",
"about_founder3_role": "Business Strategist & Government Relations",
"about_founder3_bio": "Businessman and lobbyist with deep ties to African governments, driving strategic partnerships across the continent.",

// French equivalents
"about_badge": "SOLIDE TECHNOLOGY — ADN 100% AFRICAIN",
"about_title": "Née de l'expertise africaine, construite pour l'Afrique",
"about_subtitle": "Dans un marché du carbone en pleine mutation sur le continent africain, Solide Technology — acteur 100% africain — confirme sa crédibilité en tant que partenaire stratégique pour la valorisation des ressources environnementales et vertes des États.",
"about_dna_title": "Un ADN exclusivement africain",
"about_dna_desc": "Cette singularité ne se limite pas à la symbolique. Elle incarne une nouvelle génération de leaders africains qui ne se contentent plus d'observer, mais s'assignent la mission historique de voir l'Afrique décider par elle-même, pour elle-même — et proposer une référence pour le reste du monde.",
"about_team_label": "L'ÉQUIPE FONDATRICE",
"about_founder1_bio": "Pilote de grands projets PPP (Partenariats Public-Privé) et de transferts de technologies vers le continent africain.",
"about_founder2_bio": "Pionnier de la finance durable en Afrique, spécialiste du digital et de l'innovation, actif dans les transferts d'expertises vers le continent.",
"about_founder3_bio": "Homme d'affaires et lobbyiste auprès des États africains, artisan des partenariats stratégiques sur le continent."
```

---

### 4.2 `PartnerSection.tsx` — Priorité 🔴 HAUTE

**Source dans le document** : partenariat Somaliland + "Green Gate Digital System"

**Chemin** : `frontend/src/components/landing/PartnerSection.tsx`

**Insertion dans `LandingPage.tsx`** : entre `<SovereignSection />` et `<Footer />`

**Structure suggérée** :
```tsx
<PartnerSection>
  ├── Badge : "PREMIER DÉPLOIEMENT OPÉRATIONNEL"
  ├── Titre : "Green Gate Digital System — Somaliland"
  ├── Description : partenariat, premier outil de collecte harmonisée
  ├── 3 stat cards :
  │   ├── "500–800+ Port Calls / Year"
  │   ├── "Gulf of Aden — Strategic EEZ"
  │   └── "First carbon tax digital system in Somaliland"
  └── CTA : "Explore the Case Study" → /projects
```

**Clés i18n à créer dans les 5 locales** :

```jsonc
// en.json — Landing
"partner_badge": "FIRST OPERATIONAL DEPLOYMENT",
"partner_title": "Green Gate Digital System",
"partner_subtitle": "A historic implementation in Somaliland — the first digital system for carbon and environmental tax collection powered by the Africgreen portal.",
"partner_desc": "This blockchain-based digital solution ensures traceability, independence, and sovereignty in data access and management, while protecting against fraud and falsification. Solide Technology positions itself as a world-class digital partner at the forefront of transparent, rigorous, and sovereign environmental asset management.",
"partner_stat1_label": "Annual Port Calls",
"partner_stat1_value": "500–800+",
"partner_stat1_sub": "Berbera Port — Gulf of Aden",
"partner_stat2_label": "Strategic Position",
"partner_stat2_value": "Suez → Indian Ocean",
"partner_stat2_sub": "One of the world's busiest shipping routes",
"partner_stat3_label": "Status",
"partner_stat3_value": "LIVE DEPLOYMENT",
"partner_stat3_sub": "First of its kind in Africa",
"partner_cta": "Explore the Somaliland Case",
"partner_vision_title": "Towards an African Carbon Observatory",
"partner_vision_desc": "In Solide Technology's vision, the Africgreen platform could become one of Africa's first harmonized tools for collecting carbon and environmental taxes — a true African observatory for climate change resource mobilization.",

// fr.json — Landing
"partner_badge": "PREMIER DÉPLOIEMENT OPÉRATIONNEL",
"partner_title": "Green Gate Digital System",
"partner_subtitle": "Une réalisation historique au Somaliland — premier système digital de collecte des taxes Carbone et environnementales déployé à partir du portail Africgreen.",
"partner_desc": "Solution numérique basée sur le processus blockchain, assurant traçabilité, indépendance et souveraineté dans l'accès et la gestion des données et garantie contre les risques de fraudes et de falsification. Solide Technology se positionne comme un interlocuteur de tout premier plan, à l'avant-garde d'une gestion transparente, rigoureuse, efficace et souveraine des actifs environnementaux.",
"partner_stat1_label": "Escales annuelles",
"partner_stat1_value": "500–800+",
"partner_stat1_sub": "Port de Berbera — Golfe d'Aden",
"partner_stat2_label": "Position stratégique",
"partner_stat2_value": "Suez → Océan Indien",
"partner_stat2_sub": "L'une des routes maritimes les plus fréquentées au monde",
"partner_stat3_label": "Statut",
"partner_stat3_value": "DÉPLOIEMENT EN COURS",
"partner_stat3_sub": "Premier du genre en Afrique",
"partner_cta": "Découvrir le cas Somaliland",
"partner_vision_title": "Vers un Observatoire Africain du Carbone",
"partner_vision_desc": "Dans la vision de Solide Technology, la plateforme Africgreen pourrait devenir en Afrique l'un des premiers outils de collecte harmonisée des taxes Carbone et environnementales — un véritable observatoire africain des enjeux liés à la mobilisation des ressources pour relever les défis climatiques sur le continent."
```

---

### 4.3 Mise à jour `LandingPage.tsx`

Après création des deux nouveaux composants, l'ordre final de la page sera :

```tsx
export function LandingPage() {
    return (
        <main ...>
            <Navbar activePage="overview" />
            <HeroSection />
            <CapabilitiesSection />    {/* + 4e card airport */}
            <AboutSection />           {/* NOUVEAU */}
            <SimulationSection />
            <SovereignSection />       {/* features + zone label mis à jour */}
            <PartnerSection />         {/* NOUVEAU */}
            <Footer />                 {/* copyright mis à jour */}
        </main>
    );
}
```

---

## 5. Récapitulatif des clés i18n à créer

À injecter **simultanément dans les 5 fichiers** :
`frontend/messages/{en,fr,ar,pt,sw}.json`

> EN et FR sont fournis ci-dessus. AR, PT, SW nécessitent une traduction.

| Clé | Namespace | Composant cible |
|---|---|---|
| `badge` (update) | `Landing` | `HeroSection` |
| `hero_subtitle` (update) | `Landing` | `HeroSection` |
| `trusted_partner_1` | `Landing` | `HeroSection` |
| `trusted_partner_label` | `Landing` | `HeroSection` |
| `cap_airport_title` | `Landing` | `CapabilitiesSection` |
| `cap_airport_desc` | `Landing` | `CapabilitiesSection` |
| `sovereign_feat1/2/3` (update) | `Landing` | `SovereignSection` |
| `sovereign_zone_label` | `Landing` | `SovereignSection` |
| `about_badge` | `Landing` | `AboutSection` (new) |
| `about_title` | `Landing` | `AboutSection` (new) |
| `about_subtitle` | `Landing` | `AboutSection` (new) |
| `about_dna_title` | `Landing` | `AboutSection` (new) |
| `about_dna_desc` | `Landing` | `AboutSection` (new) |
| `about_team_label` | `Landing` | `AboutSection` (new) |
| `about_founder1_name/role/bio` | `Landing` | `AboutSection` (new) |
| `about_founder2_name/role/bio` | `Landing` | `AboutSection` (new) |
| `about_founder3_name/role/bio` | `Landing` | `AboutSection` (new) |
| `partner_badge` | `Landing` | `PartnerSection` (new) |
| `partner_title` | `Landing` | `PartnerSection` (new) |
| `partner_subtitle` | `Landing` | `PartnerSection` (new) |
| `partner_desc` | `Landing` | `PartnerSection` (new) |
| `partner_stat1/2/3_label/value/sub` | `Landing` | `PartnerSection` (new) |
| `partner_cta` | `Landing` | `PartnerSection` (new) |
| `partner_vision_title` | `Landing` | `PartnerSection` (new) |
| `partner_vision_desc` | `Landing` | `PartnerSection` (new) |
| `copyright` (update) | `Footer` | `Footer` |
| `tagline` | `Footer` | `Footer` |

**Total : ~35 nouvelles clés + 5 mises à jour dans les 5 locales = 200 entrées à synchroniser.**

---

## 6. Règles de conformité projet à respecter (CLAUDE.md)

| Règle | Implication pour ce chantier |
|---|---|
| **TypeScript strict — no `any`** | Les données fondateurs peuvent être typées `Founder[]` dans un fichier `types/secure/index.ts` |
| **i18n obligatoire** | Aucun texte du document ne peut être copié directement dans un `.tsx` |
| **5 locales simultanées** | Créer toutes les clés dans en/fr/ar/pt/sw en une seule PR — ne pas itérer locale par locale |
| **CSS variables uniquement** | Ne pas hardcoder les hex `#10B981` — utiliser `var(--ais-emerald)` ou classes Tailwind |
| **Mock data dans `secureMock.ts`** | Les stats du `PartnerSection` (500-800 escales, etc.) passent par `secureMock.ts` si elles sont dynamiques |
| **Commit conventionnel** | `feat(landing): add AboutSection and PartnerSection with Solide Technology content` |
| **Nouveau composant public** | Pas de permission RBAC nécessaire pour les sections de la landing page publique |

---

## 7. Données mock à ajouter dans `secureMock.ts`

```typescript
// frontend/src/mock/datas/secureMock.ts — à ajouter

export const partnerStats = {
    annualPortCalls: "500–800+",
    annualPortCallsSub: "Port of Berbera — Gulf of Aden",
    strategicRoute: "Suez → Indian Ocean",
    strategicRouteSub: "World's busiest shipping corridor",
    deploymentStatus: "LIVE",
    deploymentStatusSub: "First carbon tax digital system in Somaliland",
};

export const founders = [
    {
        id: "kpatchavi",
        initials: "NK",
        color: "emerald",
    },
    {
        id: "radji",
        initials: "RS",
        color: "yellow",
    },
    {
        id: "dia",
        initials: "MD",
        color: "blue",
    },
];
```

---

## 8. Inventaire complet du nettoyage "AIS Portal" → "Africgreen / Green Gate Digital System"

Suite à la confirmation du 2026-04-01 : **"AIS Portal" est un ancien nom à éliminer partout**, remplacé par :
- **Africgreen** → nom du produit / de la plateforme
- **Green Gate Digital System** → sous-titre produit (déjà présent dans la sidebar de tous les dashboards)
- **Solide Technology** → raison sociale de l'entreprise

### 8.1 État actuel par fichier

#### ✅ Déjà correct — rien à faire

| Fichier | Clé / Élément | Valeur actuelle |
|---|---|---|
| `messages/{en,fr,ar,pt,sw}.json` | `Common.title` | `"Africgreen"` ✅ |
| `messages/{en,fr,ar,pt,sw}.json` | `Auth.ais_portal` | `"Africgreen"` ✅ |
| `messages/{en,fr,ar,pt,sw}.json` | `Dashboard.sidebar_app_title` | `"Africgreen"` ✅ |
| `messages/{en,fr,ar,pt,sw}.json` | `Dashboard.sidebar_app_subtitle` | `"Green Gate Digital System"` ✅ |
| `messages/{en,fr}.json` | `Footer.copyright` | `"© 2026 Africgreen by Solide Technology..."` ✅ |
| `Footer.tsx` ligne 40 | Logo texte hardcodé | `"Africgreen"` ✅ (mais à passer en i18n) |

#### ⚠️ À corriger — "AIS Portal" encore présent dans le contenu texte

| Fichier | Clé | Problème | Correction |
|---|---|---|---|
| `messages/en.json` | `Landing.sovereign_desc` | `"The AIS Portal provides the technological infrastructure..."` | Remplacer "The AIS Portal" par "Africgreen" |
| `messages/fr.json` | `Landing.sovereign_desc` | `"Le Portail AIS fournit l'infrastructure..."` | Remplacer "Le Portail AIS" par "Africgreen" |
| `messages/ar.json` | `Landing.sovereign_desc` | `"توفر بوابة AIS..."` | Remplacer "بوابة AIS" par "أفريك‌غرين" / "Africgreen" |
| `messages/pt.json` | `Landing.sovereign_desc` | `"O Portal AIS fornece..."` | Remplacer "O Portal AIS" par "Africgreen" |
| `messages/sw.json` | `Landing.sovereign_desc` | `"AIS Portal inatoa miundombinu..."` | Remplacer "AIS Portal" par "Africgreen" |

#### ⚠️ À vérifier — clé nommée "ais_portal" à renommer (refactor cosmétique)

| Fichier | Clé actuelle | Valeur | Recommandation |
|---|---|---|---|
| `messages/{en,fr,ar,pt,sw}.json` | `Auth.ais_portal` | `"Africgreen"` | Renommer la clé en `Auth.brand_name` pour cohérence |
| `LoginPage.tsx`, `ForgotPasswordPage.tsx`, `PendingApprovalPage.tsx`, `ResetPasswordPage.tsx` | `t('ais_portal')` | → `t('brand_name')` | Mettre à jour les 4 composants auth |

> ⚠️ Ce renommage est **cosmétique uniquement** (la valeur affichée est déjà correcte). À faire dans un commit de refactoring séparé : `refactor(auth): rename ais_portal i18n key to brand_name`

#### ⚠️ À corriger — Footer.tsx logo hardcodé

| Fichier | Ligne | Problème | Correction |
|---|---|---|---|
| `Footer.tsx` | ~40 | `<span>Africgreen</span>` — hardcodé, pas i18n | Passer par `t('brand_name')` depuis `Footer` namespace |

**Valeur à ajouter dans le Footer namespace de chaque locale :**
```jsonc
// messages/{en,fr,ar,pt,sw}.json — Footer namespace
"brand_name": "Africgreen"
```

#### ⚠️ À ajouter — "Green Gate Digital System" absent de la landing page

| Emplacement | Action | Clé i18n |
|---|---|---|
| `HeroSection.tsx` — badge ou subtitle | Ajouter une mention visible | `Landing.ggds_tagline` |
| `PartnerSection.tsx` (nouveau) | Titre principal de la section | `Landing.partner_title` |

```jsonc
// messages/en.json — Landing
"ggds_tagline": "Powered by Green Gate Digital System",

// messages/fr.json — Landing
"ggds_tagline": "Propulsé par le Green Gate Digital System"
```

### 8.2 Corrections `sovereign_desc` (texte complet corrigé, 5 locales)

```jsonc
// en.json — Landing.sovereign_desc
"sovereign_desc": "Africgreen provides the technological infrastructure required for implementation of Articles 6.2 and 6.4 of the Paris Agreement, ensuring transparency and accountability in carbon markets."

// fr.json — Landing.sovereign_desc
"sovereign_desc": "Africgreen fournit l'infrastructure technologique requise pour la mise en œuvre des Articles 6.2 et 6.4 de l'Accord de Paris, assurant transparence et responsabilité dans les marchés carbone."

// ar.json — Landing.sovereign_desc
"sovereign_desc": "توفر Africgreen البنية التحتية التقنية المطلوبة لتنفيذ المادتين 6.2 و6.4 من اتفاقية باريس، مما يضمن الشفافية والمساءلة في أسواق الكربون."

// pt.json — Landing.sovereign_desc
"sovereign_desc": "Africgreen fornece a infraestrutura tecnológica necessária para a implementação dos Artigos 6.2 e 6.4 do Acordo de Paris, garantindo transparência e responsabilidade nos mercados de carbono."

// sw.json — Landing.sovereign_desc
"sovereign_desc": "Africgreen inatoa miundombinu ya kiteknolojia inayohitajika kwa utekelezaji wa Vifungu 6.2 na 6.4 vya Paris Agreement, kuhakikisha uwazi na uwajibikaji katika masoko ya kaboni."
```

---

## 9. Points d'attention / risques résiduels

**1. Fondateurs sans photos**
Le document ne fournit pas d'images. L'`AboutSection` devra fonctionner avec des avatars générés (initiales + couleur CSS) ou des placeholders, en attendant les assets visuels officiels.

**2. "Green Gate Digital System" sur la landing — visibilité**
Le nom est déjà dans la sidebar du dashboard (toutes locales). Il doit maintenant apparaître sur la landing page publique. L'endroit optimal est le badge ou le sous-titre de la `HeroSection`, et le titre de la `PartnerSection` (nouvelle).

**3. Locales AR/PT/SW pour les nouvelles sections**
Le document source fournit uniquement EN et FR. Les nouvelles clés pour `AboutSection` et `PartnerSection` en arabe, portugais et swahili sont à commander séparément avant la mise en ligne.

**4. Cohérence du copyright AR/PT/SW**
Le `Footer.copyright` a déjà été mis à jour en EN et FR (`"© 2026 Africgreen by Solide Technology"`). Vérifier que AR, PT, SW ont le même texte à jour.

---

*Document généré le 2026-04-01 — À partir de `DOC-20260401-WA0124.docx` croisé avec l'analyse du codebase `frontend/` (Next.js 16 / React 19 / next-intl).*
