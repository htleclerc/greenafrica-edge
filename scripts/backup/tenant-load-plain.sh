#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# tenant-load-plain.sh — charge l'export d'un pays dans un PostgreSQL NU.
#
# « Nu » : aucune table de la plateforme, aucune extension, aucun composant de
# Supabase. Le script crée les tables à partir de schema.json, dans un schéma à
# part, puis y charge les données. Il sert à deux choses :
#
#   • remettre à un État ses données dans une base qu'il héberge lui-même, pour
#     qu'il les consulte ou les reprenne dans son propre système ;
#   • prouver, à chaque test, que l'export se suffit à lui-même.
#
# Ce n'est PAS une installation de la plateforme : ni règles d'accès, ni
# déclencheurs, ni clés étrangères. Les tables arrivent avec leurs colonnes,
# leurs types et leur clé primaire. Un type propre à la plateforme (une
# énumération, par exemple) devient du texte.
#
# Pour un autre système que PostgreSQL, ce script sert de modèle : schema.json
# donne les tables, les fichiers .jsonl donnent les lignes.
#
# Usage :
#   TARGET_DB_URL="postgresql://..." CONFIRM_TARGET_DB=<nom de la base> \
#   EXPORT_VERIFY_KEY=<clé publique de l'émetteur> \
#     ./scripts/backup/tenant-load-plain.sh <dossier d'export> [schéma]
#
#   [schéma]  schéma à créer dans la cible. Défaut : greengate_export. Il ne
#             doit pas exister : le script ne touche à rien d'existant.
#
# Avant de créer quoi que ce soit, la signature du manifeste et l'empreinte de
# chaque fichier sont vérifiées. Tout se passe ensuite dans une seule
# transaction, vérification comprise : nombre de lignes de chaque table, et pays
# de chaque ligne qui en porte un. Code de sortie : 0 = chargé et vérifié,
# 1 = échec (rien n'a été créé).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
export PGCLIENTENCODING=UTF8

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup/tenant-common.sh
source "$SCRIPT_DIR/tenant-common.sh"

[ -n "${TARGET_DB_URL:-}" ] || die "TARGET_DB_URL n'est pas renseignée."
SRC="${1:-}"
LANDING="${2:-greengate_export}"
[ -n "$SRC" ] && [ -d "$SRC" ] || die "dossier d'export attendu en argument."
[ -f "$SRC/manifest.json" ] && [ -f "$SRC/schema.json" ] || die "manifest.json ou schema.json absent : ce dossier n'est pas un export complet."
[[ "$LANDING" =~ ^[a-z][a-z0-9_]{0,40}$ ]] || die "nom de schéma invalide : $LANDING"
command -v psql >/dev/null || die "psql introuvable."
command -v sha256sum >/dev/null || die "sha256sum introuvable."

PSQL=(psql "$TARGET_DB_URL" -X -v ON_ERROR_STOP=1 -q)
TARGET_DB="$("${PSQL[@]}" -tA -c 'SELECT current_database()' | tr -d '\r')"
[ "${CONFIRM_TARGET_DB:-}" = "$TARGET_DB" ] \
  || die "la cible est la base « $TARGET_DB ». Pour confirmer, relancer avec CONFIRM_TARGET_DB=$TARGET_DB"

# Tout se fait sur une copie privée de l'export, jamais dans le dossier reçu.
private_export_copy "$SRC"
cleanup() { rm -rf "$EXPORT_COPY"; }
trap cleanup EXIT
verify_export_signature "$EXPORT_COPY"
cd "$EXPORT_COPY"

JID="$(grep -oE '"id": "[0-9a-f-]{36}"' manifest.json | head -1 | grep -oE '[0-9a-f-]{36}' || true)"
[ -n "$JID" ] || die "identifiant du pays introuvable dans le manifeste."
check_export_files _expected.tsv

"${PSQL[@]}" -v landing="$LANDING" -v jid="$JID" <<'SQL'
\pset tuples_only on
\pset format unaligned
\pset fieldsep '\t'

CREATE TEMP TABLE _schema (doc jsonb);
\copy _schema FROM 'schema.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')

-- Les comptes prennent un préfixe : leurs tables portent des noms trop généraux
-- (users, identities) pour être posées telles quelles à côté des autres.
CREATE TEMP TABLE _tables AS
SELECT t ->> 'file' AS file,
       CASE WHEN t ->> 'section' = 'accounts' THEN 'account_' ELSE '' END || (t ->> 'table') AS name,
       t -> 'columns' AS columns, t -> 'primary_key' AS pk
  FROM _schema, jsonb_array_elements(doc -> 'tables') AS t;

-- schema.json vient de l'export : on ne lui fait pas confiance. Les noms qu'il
-- porte servent à écrire le script de chargement ; un nom forgé (saut de ligne,
-- guillemet, chemin) y glisserait des commandes. Tout ce qui n'a pas la forme
-- attendue, ou n'a pas été vérifié par son empreinte, fait refuser l'export.
CREATE TEMP TABLE _expected (path text, n bigint);
\copy _expected FROM '_expected.tsv' WITH (FORMAT text)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM _tables t
     WHERE t.file IS NULL OR t.name IS NULL
        OR t.file !~ '^(tenant|accounts|globals)/[a-z0-9_]+\.jsonl$'
        OR t.name !~ '^[a-z0-9_]{1,63}$'
        OR NOT EXISTS (SELECT 1 FROM _expected e WHERE e.path = t.file)
        OR jsonb_typeof(t.columns) IS DISTINCT FROM 'array'
        OR jsonb_typeof(t.pk) IS DISTINCT FROM 'array'
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(t.columns) = 'array' THEN t.columns ELSE '[]'::jsonb END) c
                    WHERE coalesce(c ->> 'name', '') !~ '^[a-z0-9_]+$'
                       OR coalesce(c ->> 'nullable', '') NOT IN ('true', 'false'))
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(
                     CASE WHEN jsonb_typeof(t.pk) = 'array' THEN t.pk ELSE '[]'::jsonb END) k
                    WHERE k !~ '^[a-z0-9_]+$')
  ) THEN
    RAISE EXCEPTION 'schema.json : nom de fichier, de table ou de colonne inattendu, ou fichier absent du manifeste — export refusé.';
  END IF;
END $$;

-- Un type standard est repris tel quel ; tout autre devient du texte. Un
-- tableau reste un tableau. Le type n'est jamais recopié sans avoir été reconnu.
CREATE FUNCTION pg_temp.portable_type(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN regexp_replace(t, '\[\]$', '') ~ ('^(uuid|text|boolean|smallint|integer|bigint|real|double precision|date|jsonb|json|bytea|inet'
                || '|numeric(\(\d+(,\d+)?\))?|character varying(\(\d+\))?|character(\(\d+\))?'
                || '|timestamp(\(\d\))? with(out)? time zone|time(\(\d\))? with(out)? time zone)$')
             THEN regexp_replace(t, '\[\]$', '')
           ELSE 'text'
         END || CASE WHEN t ~ '\[\]$' THEN '[]' ELSE '' END;
$$;

\o _gen_ddl.sql
SELECT format('CREATE TABLE %I.%I (%s%s);', :'landing', t.name,
         (SELECT string_agg(format('%I %s%s', c ->> 'name', pg_temp.portable_type(c ->> 'type'),
                                   CASE WHEN (c ->> 'nullable')::boolean THEN '' ELSE ' NOT NULL' END),
                            ', ' ORDER BY ord)
            FROM jsonb_array_elements(t.columns) WITH ORDINALITY AS x(c, ord)),
         CASE WHEN jsonb_array_length(t.pk) > 0
              THEN ', PRIMARY KEY (' || (SELECT string_agg(quote_ident(k), ', ' ORDER BY ord)
                                           FROM jsonb_array_elements_text(t.pk) WITH ORDINALITY AS y(k, ord)) || ')'
              ELSE '' END)
  FROM _tables t ORDER BY t.file;
-- Dans une colonne de type JSON, un champ présent et valant null est la valeur
-- JSON null ; un champ absent, l'absence de valeur. Sans ce cas particulier,
-- les deux arriveraient vides.
\o _gen_load.sql
SELECT format(
  E'CREATE TEMP TABLE _l (doc jsonb);\n\\copy _l FROM %L WITH (FORMAT csv, QUOTE E''\\x01'', DELIMITER E''\\x02'')\nINSERT INTO %I.%I SELECT %s FROM _l, jsonb_populate_record(NULL::%I.%I, _l.doc) AS r;\nDROP TABLE _l;',
  t.file, :'landing', t.name,
  (SELECT string_agg(
            CASE WHEN pg_temp.portable_type(c ->> 'type') IN ('json', 'jsonb')
                 THEN format('CASE WHEN _l.doc -> %L = ''null''::jsonb THEN ''null''::%s ELSE r.%I END',
                             c ->> 'name', pg_temp.portable_type(c ->> 'type'), c ->> 'name')
                 ELSE format('r.%I', c ->> 'name') END,
            ', ' ORDER BY ord)
     FROM jsonb_array_elements(t.columns) WITH ORDINALITY AS x(c, ord)),
  :'landing', t.name)
  FROM _tables t ORDER BY t.file;
\o
SELECT set_config('load.landing', :'landing', false) AS _landing, set_config('load.jid', :'jid', false) AS _jid \gset

BEGIN;
CREATE SCHEMA :"landing";
\i _gen_ddl.sql
\i _gen_load.sql

-- Vérification AVANT de valider : le nombre de lignes de chaque table doit être
-- celui du manifeste, et toute ligne qui porte un pays doit porter celui que
-- l'export annonce. Au moindre écart, rien n'est créé.
CREATE TEMP TABLE _loaded (file text, n bigint);
DO $$
DECLARE
  v_t record;
  v_n bigint;
  v_bad text;
BEGIN
  FOR v_t IN SELECT * FROM _tables ORDER BY file LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', current_setting('load.landing'), v_t.name) INTO v_n;
    INSERT INTO _loaded VALUES (v_t.file, v_n);
    IF v_t.columns @> '[{"name": "jurisdiction_id"}]' AND v_t.file LIKE 'tenant/%' THEN
      EXECUTE format('SELECT count(*) FROM %I.%I WHERE jurisdiction_id::text IS DISTINCT FROM %L',
                     current_setting('load.landing'), v_t.name, current_setting('load.jid')) INTO v_n;
      IF v_n > 0 THEN
        RAISE EXCEPTION '% : % ligne(s) n''appartiennent pas au pays annoncé (%) — export refusé.',
          v_t.file, v_n, current_setting('load.jid');
      END IF;
    END IF;
  END LOOP;
  SELECT string_agg(format('%s (annoncé %s, chargé %s)', e.path, e.n, coalesce(l.n::text, 'rien')), ', ' ORDER BY e.path)
    INTO v_bad
    FROM _expected e LEFT JOIN _loaded l ON l.file = e.path
   WHERE l.n IS DISTINCT FROM e.n;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'chargement incomplet : % — rien n''a été créé.', v_bad;
  END IF;
END $$;

\o _loaded.tsv
SELECT file, n FROM _loaded ORDER BY file;
\o
COMMIT;
SQL

TABLES="$(wc -l < _loaded.tsv | tr -d ' ')"
TOTAL="$(awk -F'\t' '{s+=$2} END{print s+0}' _loaded.tsv)"
echo "Export chargé dans « $TARGET_DB », schéma $LANDING : $TOTAL ligne(s) sur $TABLES table(s), toutes vérifiées."
