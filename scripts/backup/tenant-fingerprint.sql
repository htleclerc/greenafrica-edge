-- ─────────────────────────────────────────────────────────────────────────────
-- Empreinte du schéma, partagée par l'export et l'import d'un pays.
--
-- L'export l'inscrit dans le manifeste et dans schema.json ; l'import la
-- recalcule sur la base d'arrivée. Les deux doivent donc la calculer exactement
-- de la même façon : d'où ce fichier unique, lu par les deux scripts.
--
-- Ce qu'elle couvre, table par table :
--   • les colonnes : nom, type, obligatoire ou non ;
--   • les clés primaires et les index uniques (colonnes, condition éventuelle) ;
--   • les contraintes CHECK ;
--   • les clés étrangères vers les tables de la plateforme (schéma public).
--
-- Ce qu'elle ne couvre pas, volontairement :
--   • les noms des contraintes et des index : ils n'ont pas d'effet sur les
--     données ;
--   • les clés étrangères vers un autre schéma (auth) : une base hébergée sans
--     ce service d'authentification doit pouvoir recevoir l'export ;
--   • les règles d'accès et les déclencheurs : ils ne changent pas ce qu'une
--     table peut contenir.
--
-- Elle ne dépend pas de la session qui la calcule : search_path vide (tout nom
-- hors pg_catalog sort avec son schéma) et tri en collation "C".
-- ─────────────────────────────────────────────────────────────────────────────

CREATE FUNCTION pg_temp.table_fingerprint(rel regclass) RETURNS text
LANGUAGE sql STABLE
SET search_path = ''
AS $fp$
  SELECT encode(sha256(convert_to(coalesce(string_agg(line, E'\n' ORDER BY line COLLATE "C"), ''), 'UTF8')), 'hex')
    FROM (
      SELECT 'col ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
             || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END AS line
        FROM pg_catalog.pg_attribute a
       WHERE a.attrelid = rel
         AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity <> 'a'
      UNION ALL
      SELECT CASE WHEN i.indisprimary THEN 'primary (' ELSE 'unique (' END
             || (SELECT string_agg(pg_get_indexdef(i.indexrelid, k, true), ', ' ORDER BY k)
                   FROM generate_series(1, i.indnkeyatts) AS k)
             || ')' || coalesce(' where ' || pg_get_expr(i.indpred, i.indrelid, true), '')
        FROM pg_catalog.pg_index i
       WHERE i.indrelid = rel AND i.indisunique
      UNION ALL
      SELECT CASE c.contype WHEN 'f' THEN 'fk ' ELSE 'check ' END || pg_get_constraintdef(c.oid, true)
        FROM pg_catalog.pg_constraint c
       WHERE c.conrelid = rel
         AND (c.contype = 'c'
              OR (c.contype = 'f'
                  AND EXISTS (SELECT 1 FROM pg_catalog.pg_class t
                               WHERE t.oid = c.confrelid AND t.relnamespace = 'public'::regnamespace)))
    ) AS lines;
$fp$;

CREATE FUNCTION pg_temp.schema_fingerprint(rels regclass[]) RETURNS text
LANGUAGE sql STABLE
SET search_path = ''
AS $fp$
  SELECT encode(sha256(convert_to(coalesce(string_agg(r::text || ' ' || pg_temp.table_fingerprint(r), E'\n'
                                                      ORDER BY r::text COLLATE "C"), ''), 'UTF8')), 'hex')
    FROM unnest(rels) AS r;
$fp$;
