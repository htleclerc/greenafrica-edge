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
#     ./scripts/backup/tenant-load-plain.sh <dossier d'export> [schéma]
#
#   [schéma]  schéma à créer dans la cible. Défaut : greengate_export. Il ne
#             doit pas exister : le script ne touche à rien d'existant.
#
# Tout se passe dans une seule transaction. Code de sortie : 0 = chargé et
# vérifié, 1 = échec (rien n'a été créé).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
export PGCLIENTENCODING=UTF8

die() { echo "FATAL: $*" >&2; exit 1; }

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

cd "$SRC"
grep -q '"format": "greengate-tenant-export/2"' manifest.json || die "format d'export inconnu."

: > _expected.tsv
while IFS= read -r line; do
  path="$(printf '%s' "$line" | sed -E 's/.*"path": "([^"]+)".*/\1/')"
  rows="$(printf '%s' "$line" | sed -E 's/.*"rows": ([0-9]+).*/\1/')"
  sum="$(printf '%s' "$line" | sed -E 's/.*"sha256": "([0-9a-f]+)".*/\1/')"
  [[ "$path" =~ ^((tenant|accounts|globals)/[a-z0-9_]+\.jsonl|schema\.json)$ ]] || die "chemin inattendu dans le manifeste : $path"
  [ -f "$path" ] || die "fichier manquant : $path"
  [ "$(sha256sum "$path" | cut -d' ' -f1)" = "$sum" ] || die "empreinte différente pour $path : l'export a été modifié ou tronqué."
  [ "$path" = "schema.json" ] || printf '%s\t%s\n' "$path" "$rows" >> _expected.tsv
done < <(grep -E '"path": ' manifest.json)

cleanup() { rm -f _expected.tsv _gen_ddl.sql _gen_load.sql _gen_verify.sql _loaded.tsv; }
trap cleanup EXIT

"${PSQL[@]}" -v landing="$LANDING" <<'SQL'
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

-- Un type standard est repris tel quel ; tout autre devient du texte. Un
-- tableau reste un tableau.
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
\o _gen_load.sql
SELECT format(
  E'CREATE TEMP TABLE _l (doc jsonb);\n\\copy _l FROM %L WITH (FORMAT csv, QUOTE E''\\x01'', DELIMITER E''\\x02'')\nINSERT INTO %I.%I SELECT r.* FROM _l, jsonb_populate_record(NULL::%I.%I, _l.doc) AS r;\nDROP TABLE _l;',
  t.file, :'landing', t.name, :'landing', t.name)
  FROM _tables t ORDER BY t.file;
\o _gen_verify.sql
SELECT format('SELECT %L, count(*) FROM %I.%I;', t.file, :'landing', t.name) FROM _tables t ORDER BY t.file;
\o

BEGIN;
CREATE SCHEMA :"landing";
\i _gen_ddl.sql
\i _gen_load.sql
\o _loaded.tsv
\i _gen_verify.sql
\o
COMMIT;
SQL

BAD="$(awk -F'\t' 'NR==FNR {want[$1]=$2; next} { gsub(/\r/, "", $2); if ($2 != want[$1]) print $1 " (attendu " want[$1] ", trouvé " $2 ")" }' _expected.tsv _loaded.tsv)"
[ -z "$BAD" ] || die "chargement incomplet : $BAD"

TABLES="$(wc -l < _loaded.tsv | tr -d ' ')"
TOTAL="$(awk -F'\t' '{s+=$2} END{print s+0}' _loaded.tsv)"
echo "Export chargé dans « $TARGET_DB », schéma $LANDING : $TOTAL ligne(s) sur $TABLES table(s), toutes vérifiées."
