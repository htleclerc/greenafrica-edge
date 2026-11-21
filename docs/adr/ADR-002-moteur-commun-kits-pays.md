# ADR-002 — Moteur commun, un kit et un déploiement par pays

**Date** : 2026-11-21 · **Statut** : proposé

## Contexte
Le produit doit être livré clés en main au Togo puis dupliqué dans d'autres pays, avec une
identité visuelle et éditoriale propre, distincte de Green Gate, tout en réutilisant le moteur
(calcul, avis, encaissements, audit).

## Décision
- Le moteur (Go + schéma Supabase) est commun et versionné.
- Chaque pays est décrit par un kit `countries/<iso>/` (configuration, barèmes, géographie,
  paiements, contenus, gabarits), validé par un schéma Zod.
- Une instance déployée = un pays : base, domaine, clés et données séparés.
- L'interface utilise le design system Agbé ; aucun élément de marque Green Gate n'est réutilisé,
  contrôlé par un job CI.

## Conséquences
- Ajouter un pays ne demande pas de modifier le moteur.
- Les correctifs du moteur sont livrés à tous les pays par montée de version.
- Le sélecteur de juridiction et les contenus multi-pays disparaissent de l'interface.
