---
name: Africgreen branding decisions
description: Confirmed brand naming — AIS Portal is deprecated, Africgreen is the product, Green Gate Digital System is the sub-brand
type: project
---

Brand naming confirmed 2026-04-01:
- **"AIS Portal"** = ancien nom, à éliminer partout dans le code
- **"Africgreen"** = nom du produit / de la plateforme (déjà correct dans Common.title, Auth.ais_portal, Footer logo)
- **"Green Gate Digital System"** = sous-titre officiel du produit (déjà dans sidebar, à promouvoir sur la landing)
- **"Solide Technology"** = raison sociale de l'entreprise propriétaire

**Why:** Décision confirmée par le client lors de la revue du communiqué stratégique DOC-20260401-WA0124.

**How to apply:** Ne jamais écrire "AIS Portal" dans du nouveau code ou du contenu i18n. Toujours utiliser "Africgreen" pour le produit et "Solide Technology" pour l'entreprise. Le sous-titre "Green Gate Digital System" peut apparaître en tagline sur la landing et dans la sidebar.

Résidus à corriger identifiés :
- `Landing.sovereign_desc` dans les 5 locales contient encore "The AIS Portal" / "Le Portail AIS" / "بوابة AIS" / "O Portal AIS" / "AIS Portal" → remplacer par "Africgreen"
- Clé `Auth.ais_portal` à renommer en `Auth.brand_name` (refactor cosmétique, valeur déjà = "Africgreen")
- `Footer.tsx` ligne ~40 : logo hardcodé "Africgreen" → passer en `t('brand_name')`
