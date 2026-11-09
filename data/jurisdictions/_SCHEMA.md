# Référentiel pays — schéma

Une source de vérité par juridiction : `<key>.json`, où `<key>` est la clé de
`frontend/src/components/landing/coverage.ts` (code ISO-3166 alpha-2 en
minuscules, ou `somaliland` qui n'a pas de code ISO).

## Pourquoi ce dossier n'est pas dans `frontend/`

Tout ce qu'un composant importe depuis `frontend/src/` part dans le bundle
client, donc est public. Le bloc `internal` de ces fichiers (potentiel de
recettes, hypothèses de tarification) ne doit jamais y arriver.

`scripts/build-jurisdiction-profiles.mjs` lit ces fichiers et génère
`frontend/src/components/jurisdictions/profiles.generated.ts` en ne recopiant
que `scopes` et `figures`. Un test refuse le build si une clé de `internal`
apparaît dans le fichier généré.

Les notes conceptuelles gouvernementales (modèle
`Note_Conceptuelle_GreenGate_Guinee_v5`) lisent le fichier entier, `internal`
compris.

## Structure

```jsonc
{
  "key": "gn",
  "status": "live" | "pipeline",   // doit concorder avec coverage.ts

  // Ce sur quoi la contribution peut porter. C'est la réponse à
  // « sur quelle branche d'activité peut-on intervenir ».
  "scopes": [
    {
      "mode": "MARITIME" | "AIR" | "MINING",
      "activity": "<code du vocabulaire contrôlé>",  // traduit, cf i18n
      "gateway": "Port autonome de Conakry"          // nom propre, non traduit
    }
  ],

  // Chiffres publiables. Jamais un montant de recettes.
  "figures": [
    {
      "metric": "<code du vocabulaire contrôlé>",
      "subject": "<code activity>",   // facultatif, qualifie la mesure
      "value": 183000000,
      "year": 2025,
      "sourceLabel": "Reuters / China Global South",
      "sourceUrl": null,              // null = source non reliée, à retrouver
      "period": "1 mai → 31 août 2026", // facultatif : la mesure ne couvre pas une année pleine
      "projection": false,            // facultatif : la source qualifie elle-même le chiffre de projection
      "note": "Premier exportateur mondial."  // facultatif, affiché tel quel — rédiger en français
    }
  ],

  // JAMAIS exposé au front.
  "internal": {
    "potential_usd": { "phase1_low": 0, "phase1_high": 0, "horizon_low": 0, "horizon_high": 0, "horizon_year": 2030 },
    "breakdown": [ { "source": "...", "low": 0, "high": 0, "basis": "..." } ],
    "notes": "..."
  }
}
```

## Règles

1. **Aucun chiffre sans `year` et sans `sourceLabel`.** `sourceUrl` peut être
   `null` quand seule la référence papier est connue, jamais inventé.
2. **Ne jamais interpoler.** Un indicateur absent est absent ; il ne se déduit
   pas d'un pays voisin.
3. Un chiffre que la source qualifie elle-même de projection porte
   `"projection": true`.
4. **Un relevé qui ne couvre pas une année pleine porte `period`.** Sans quoi
   391 escales sur quatre mois se lisent comme 391 escales par an.
5. **Un montant liquidé n'est pas un montant encaissé.** Aucun champ de
   recettes n'est publiable, et dans `internal` les deux restent distincts.
6. `activity` et `metric` ne prennent que des codes du vocabulaire contrôlé
   (`frontend/src/components/jurisdictions/vocabulary.ts`) : c'est ce qui rend
   l'affichage traduisible en 6 langues sans rédiger de prose par pays.
