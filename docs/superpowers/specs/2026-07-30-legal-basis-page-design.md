# Page publique `/legal-basis` — base légale & méthodologie

**Date** : 2026-07-30
**Statut** : spec validée (PO)
**Source** : `GUIDE_page_legal-basis.md` (Direction Green-Gate, Noël Kpatchavi)

---

## 1. Objectif

Publier la page publique qui récapitule et justifie le calcul de la contribution carbone
Green-Gate, référencée par les pro-formas en circulation (section 5, page 2).

Trois audiences :

1. **Débiteur** recevant un pro-forma — vérifie la solidité juridique avant paiement.
2. **Cabinet de recouvrement** (Eidle Advocats à Hargeisa, Van Hooydonk au barreau d'Anvers) —
   cite les textes dans les mises en demeure.
3. **Auditeurs / régulateurs** (ASCR, AmSpec, Forvis Mazars, autorités de tutelle) —
   vérifient l'alignement avec les standards internationaux.

Ton : sobre, institutionnel, factuel. Aucune formule commerciale.

---

## 2. Décisions PO

| Question | Décision |
|---|---|
| Méthodologie publiée | **Guide verbatim** — la méthode qui a produit les 656 pro-formas en circulation. Le moteur Go n'est pas décrit sur la page. |
| PDF non fournis par la Direction | **Mention « sur demande »** — chaque texte listé et citable, disponibilité indiquée, aucun lien mort. |
| Périmètre linguistique | **6 locales** (`en`/`fr` rédigés, `ar`/`pt`/`sw`/`so` baseline auto à relire natif). |

---

## 3. Approche retenue

Reconstruire le contenu du guide sur **`LegalPageShell`** (le shell des trois pages légales
existantes), et non copier le TSX autonome du guide.

Le composant fourni par le guide vise `OsCard`/`OsBadge`/`OsButton` avec des couleurs
Tailwind `forest-*` — vérifié : `forest` apparaît **0 fois** dans le codebase, la page
rendrait sans style. Son `alternates.languages` suppose par ailleurs des routes
`/en/legal-basis` qui n'existent pas : la locale est **portée par cookie** (`NEXT_LOCALE`,
cf. `frontend/src/i18n/request.ts`), sans préfixe d'URL.

Réutiliser le shell apporte gratuitement : sommaire latéral collant, thème `--os-*`,
comportement overlay `?from=auth|signup|login`, i18n 6 locales, et fait de la page une
sœur des trois documents légaux existants plutôt qu'un one-off.

---

## 4. Fichiers

| Fichier | Nature |
|---|---|
| `frontend/src/app/(legal)/legal-basis/page.tsx` | **neuf** — server component : `metadata` + JSON-LD, rend `<LegalBasisContent />` |
| `frontend/src/components/legal/LegalBasisContent.tsx` | **neuf** — client, `useTranslations('LegalBasis')`, 7 sections sur `LegalPageShell` |
| `frontend/messages/{en,fr,ar,pt,sw,so}.json` | **modifiés** — namespace `LegalBasis` + `Legal.badge_legal_basis` + `Legal.footer_legal_basis` + `Footer.legal_basis` |
| `frontend/src/components/legal/LegalPageShell.tsx` | **modifié** — 4ᵉ lien dans la barre de pied de document |
| `frontend/src/components/layout/Footer.tsx` | **modifié** — `legal_basis: '/legal-basis'` dans `SUPPORT_ROUTES` |
| `frontend/src/components/legal/__tests__/legalBasisMessages.test.ts` | **neuf** — parité des clés sur les 6 locales |

### 4.1 `page.tsx` (server)

```tsx
export const metadata: Metadata = {
  title: 'Legal Basis & Methodology | Green-Gate Programme',
  description: '…',           // cf. §5 du guide
  keywords: [...],            // cf. §5 du guide
  robots: { index: true, follow: true },
  alternates: { canonical: 'https://greengate.africa/legal-basis' },  // PAS de languages
  openGraph: { title, description, url, type: 'article' },
}
```

Plus le JSON-LD `GovernmentService` (§5 du guide) injecté via
`<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(...) }} />`
dans le server component — jamais dans le composant client.

### 4.2 `LegalBasisContent.tsx` (client)

Mêmes imports et même forme que `PrivacyPolicyContent.tsx` :
`LegalPageShell, LegalSection, LegalP, LegalUl, LegalLi, LegalHighlight, LegalWarning, LegalTable`,
plus `richTextComponents = { b, strong }` pour `t.rich`.

Props du shell :

- `badgeLabel={legal('badge_legal_basis')}`
- `badgeColor="#A78BFA"` — violet ; les trois couleurs prises sont `#38BDF8` (privacy),
  `#F59E0B` (security), `#00D97E` (terms).
- `sections` = les 7 entrées ci-dessous (le shell numérote lui-même `01`…`07`).

---

## 5. Plan des sections

| # | `id` | Contenu (guide) |
|---|---|---|
| 01 | `programme-summary` | Summary box → `LegalTable` : programme, concessionnaire, périmètre, taux, devise, banque/SWIFT |
| 02 | `national-framework` | A.1 décret MOE&CC/MWI/36/2026 (+ ses 7 articles en `LegalUl`), A.2 Maritime Carbon Tax Act 2024, A.3 concession SOLIDE TECHNOLOGY |
| 03 | `maritime-methodology` | B.1 IMO MEPC.346(78) + facteur HFO 3.114, B.2 UNCLOS art. 211, B.3 EU MRV 2023/957, B.4 formule + exemple chiffré RASHA |
| 04 | `aviation-methodology` | C.1 Convention de Chicago art. 15 & 24, C.2 CORSIA / Annexe 16 vol. IV, C.3 IPCC AR6 RFI 2.0, C.4 formule + exemple chiffré ET-309 |
| 05 | `governance-audit` | D.1 ASCR, D.2 AmSpec + Forvis Mazars, D.3 endossement Union Africaine |
| 06 | `dispute-jurisdiction` | E.1 délai de contestation 10 jours ouvrés, E.2 droit applicable, E.3 rampe J+15 / J+30 / J+45 / J+90 |
| 07 | `contact` | Bloc contact SOLIDE TECHNOLOGY + dossier légal consolidé sur demande |

### 5.1 Exemples chiffrés — sources vérifiées

Les deux exemples reproduisent des documents réellement émis ; les chiffres sont **stockés**,
pas inventés pour la page.

**Maritime — `PRO-2026-064001`** (`docs/onboarding/seeds/03_voyages.json`, `voy-001` ;
navire `nav-001` = RASHA, IMO 9235957, Bulk Carrier, 17 784 GT) :

| Étape | Valeur | Champ seed |
|---|---:|---|
| Distance de voyage standardisée | 4 500 nm | `distance_nm` |
| Vitesse standard | 13 nœuds | `vitesse_kn` |
| Durée de voyage | 14,4 jours | `voyage_days` |
| Soutage HFO | 465,6 t | `fuel_consumed_t` |
| Facteur d'émission HFO | × 3,114 tCO₂/t | — |
| CO₂ total du voyage | **1 450 tCO₂** | `co2_voyage_tco2` |
| Allocation internationale | × 50 % | — |
| CO₂ taxable | **725 tCO₂** | `co2_facturable_tco2` |
| Taux carbone | × 40,00 USD/t | — |
| **Contribution due** | **29 000 USD** | `contribution_usd` = 28 999,99 |

Contrôle : 465,6 × 3,114 = 1 449,8 ≈ 1 450 ✓. Le facteur 3,114 est donc bien celui qui a
produit ces documents.

> **Écart d'un cent à traiter dans le texte.** 725 × 40 = 29 000,00 exactement, alors que le
> pro-forma en circulation porte 28 999,99. La table publie 29 000 (comme le guide) et une
> note précise que **le montant figurant sur le pro-forma fait foi** — pour qu'un avocat
> rapprochant les deux ne trouve pas d'écart inexpliqué.

**Aviation — `AVI-MAI-2026-0001`** (`docs/onboarding/seeds/04b_proformas_aviation_mai_extension.json` ;
compagnie `avi-001` = Ethiopian Airlines Group, ET-309, ADD-HGA, B737-800) :

| Étape | Valeur |
|---|---:|
| Cycle LTO | 2,50 tCO₂ |
| Croisière (1,5 h × 3,0 tCO₂/h) | 4,50 tCO₂ |
| Base CO₂ du voyage | **7,00 tCO₂** (`vol_details.co2_voyage_tco2`) |
| Radiative Forcing Index | × 2,0 (`vol_details.rfi`) |
| CO₂-équivalent effectif | **14,00 tCO₂eq** |
| Taux carbone | × 40,00 USD/t |
| **Contribution due** | **560 USD** (`total_usd`) |

> **Correction de référence documentaire.** Le guide cite `AVI-2026-5001` — cette référence
> **n'existe pas** dans les seeds. Le document réel est `AVI-MAI-2026-0001`. La page cite la
> référence réelle : une page juridique ne peut pas porter un numéro de document que personne
> ne peut rapprocher. La méthodologie publiée reste celle du guide, conformément à la décision PO.

Note à conserver (guide) : *la composante passagers a été retirée par décision du Comité
SOLIDE en juin 2026.*

### 5.2 Documents « sur demande »

Les 8 PDF du §6 du guide sont listés comme textes citables. Aucun `href`. Un `LegalHighlight`
par section concernée indique que les copies certifiées sont disponibles sur demande à
`st.operations@greengate.africa`. Le bouton « Download the full legal dossier » devient la
même mention en section 07.

Brancher les fichiers plus tard = pur changement de contenu, sans retoucher la structure.

---

## 6. Tests

`legalBasisMessages.test.ts` — le mode de défaillance réel de cette page est une clé absente
dans une locale : `next-intl` lève à l'exécution et casse la page pour cette langue.

Le test charge les 6 fichiers de `frontend/messages/` et vérifie :

1. le namespace `LegalBasis` existe dans les 6 ;
2. l'ensemble des clés est **identique** à celui de `en.json` (aucune manquante, aucune en trop) ;
3. aucune valeur vide ou uniquement blanche ;
4. `Legal.badge_legal_basis`, `Legal.footer_legal_basis` et `Footer.legal_basis` présents dans les 6.

Les trois pages légales existantes n'ont pas de test de rendu ; on ne s'en écarte pas.

---

## 7. Hors périmètre (assumé)

- **Pas de `sitemap.xml`.** Le repo n'en a aucun ; en créer un pour une page est une tâche SEO
  distincte. La checklist SEO du guide (Search Console, communiqué, backlinks) reste à la
  charge de la Direction.
- **Aucune modification du moteur Go**, des migrations, ni du préambule PDF de `invoiceService.ts`.
- **Aucun PDF ajouté** dans `frontend/public/docs/` (non fournis).

---

## 8. Risque ouvert — divergence méthodologique

**À trancher par la Direction, hors de cette page.**

La méthodologie publiée est celle des 656 pro-formas en circulation. Le moteur de production
calcule autrement :

| | Page publiée (= documents en circulation) | Moteur Go (pro-formas automatiques) |
|---|---|---|
| Maritime | soutage voyage type × 3,114 × **50 %** × 40 USD | distance AIS en ZEE × gCO₂/NM (`emission_factors`, cascade EU_MRV → catégorie → fallback, IMO 4ᵉ étude GES 2020), **sans allocation** — `backend/internal/tax/calculator.go:75` |
| Aviation | LTO + croisière × **RFI 2,0** | cycles ICAO LTO seuls, **sans RFI ni croisière** — `backend/internal/tax/air.go:82` |
| Taux | 40 USD uniforme | table `tariffs` versionnée par juridiction/mode (semée à 40 USD, `decree_ref` MOE&CC/mi/36/2026) |

Conséquence : le jour où la plateforme émet un pro-forma automatique, son montant ne sera pas
reproductible depuis cette page. Deux issues possibles — aligner le moteur sur la méthode du
décret, ou publier ultérieurement une section « mesure télémétrique » distinguant les deux
régimes de documents.

Divergences mineures relevées au passage, non traitées ici :

- `TaxSimulatorPage.tsx:26` utilise un facteur HFO de **3,206** là où les documents émis et le
  guide utilisent **3,114**.
- La table `methodologies` (mig 071) porte le code `IMO_MEPC_364_79` tandis que le préambule PDF
  et le guide citent **MEPC.346(78)**.
- La rampe de recouvrement E.3 du guide **correspond** à l'implémentation
  (`collectionReminderService.ts` : J15 amiable → J30 mise en demeure → J45 pré-huissier) ;
  seule la publication J+90 au registre n'est pas implémentée.
