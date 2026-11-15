#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# tenant-import.sh — recharge l'export d'un pays dans une base PostgreSQL qui
# porte déjà les tables de la plateforme.
#
# La base cible n'a pas à être chez Supabase : un PostgreSQL hébergé par l'État
# convient, pourvu que les tables y existent à l'identique. Le script le vérifie
# par l'empreinte du schéma inscrite dans l'export, calculée sur les tables
# elles-mêmes — pas sur un journal de migrations propre à un hébergeur.
#
# Pour charger l'export dans une base qui n'a PAS les tables de la plateforme
# (entrepôt, autre système), voir tenant-load-plain.sh.
#
# ÉCRIT dans la base cible. Deux garde-fous :
#   • la cible se passe par TARGET_DB_URL, jamais par SUPABASE_DB_URL, pour
#     qu'un export et un import lancés dans le même terminal ne visent pas la
#     même base par distraction ;
#   • il faut répéter le nom de la base cible dans CONFIRM_TARGET_DB.
#
# Usage :
#   TARGET_DB_URL="postgresql://..." CONFIRM_TARGET_DB=<nom de la base> \
#     ./scripts/backup/tenant-import.sh <dossier d'export>
#
# Tout se passe dans une seule transaction : un échec n'importe rien.
# Rejouable : une ligne déjà présente (même clé) est laissée telle quelle.
#
# Les contrôles de clés étrangères et les déclencheurs sont suspendus pendant le
# chargement (session_replication_role = replica) : les lignes arrivent table
# par table, pas dans l'ordre de leurs dépendances. Il faut pour cela un compte
# qui en a le droit : le compte `postgres` chez Supabase, un superutilisateur
# sur un PostgreSQL que l'on héberge soi-même.
#
# Les comptes (accounts/) ne sont chargés que si la cible a les tables
# d'authentification correspondantes ; sinon ils restent dans l'export, à
# reprendre dans le système d'identité de l'État.
#
# Code de sortie : 0 = import vérifié, 1 = échec (rien n'a été écrit).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
export PGCLIENTENCODING=UTF8

die() { echo "FATAL: $*" >&2; exit 1; }

[ -n "${TARGET_DB_URL:-}" ] || die "TARGET_DB_URL n'est pas renseignée."
SRC="${1:-}"
[ -n "$SRC" ] && [ -d "$SRC" ] || die "dossier d'export attendu en argument."
[ -f "$SRC/manifest.json" ] || die "manifest.json absent : ce dossier n'est pas un export complet."
command -v psql >/dev/null || die "psql introuvable."
command -v sha256sum >/dev/null || die "sha256sum introuvable."

PSQL=(psql "$TARGET_DB_URL" -X -v ON_ERROR_STOP=1 -q)

TARGET_DB="$("${PSQL[@]}" -tA -c 'SELECT current_database()' | tr -d '\r')"
[ "${CONFIRM_TARGET_DB:-}" = "$TARGET_DB" ] \
  || die "la cible est la base « $TARGET_DB ». Pour confirmer, relancer avec CONFIRM_TARGET_DB=$TARGET_DB"

cd "$SRC"

grep -q '"format": "greengate-tenant-export/2"' manifest.json \
  || die "format d'export inconnu (attendu greengate-tenant-export/2)."
JID="$(grep -oE '"id": "[0-9a-f-]{36}"' manifest.json | head -1 | grep -oE '[0-9a-f-]{36}')"
FINGERPRINT="$(grep -oE '"schema_fingerprint": "[0-9a-f]{32}"' manifest.json | grep -oE '[0-9a-f]{32}')"
[ -n "$JID" ] || die "identifiant du pays introuvable dans le manifeste."
[ -n "$FINGERPRINT" ] || die "empreinte du schéma introuvable dans le manifeste."

# ── Intégrité des fichiers, avant toute écriture ─────────────────────────────
: > _expected.tsv
while IFS= read -r line; do
  path="$(printf '%s' "$line" | sed -E 's/.*"path": "([^"]+)".*/\1/')"
  rows="$(printf '%s' "$line" | sed -E 's/.*"rows": ([0-9]+).*/\1/')"
  sum="$(printf '%s' "$line" | sed -E 's/.*"sha256": "([0-9a-f]+)".*/\1/')"
  [[ "$path" =~ ^((tenant|accounts|globals)/[a-z0-9_]+\.jsonl|schema\.json)$ ]] || die "chemin inattendu dans le manifeste : $path"
  [ -f "$path" ] || die "fichier manquant : $path"
  [ "$(sha256sum "$path" | cut -d' ' -f1)" = "$sum" ] || die "empreinte différente pour $path : l'export a été modifié ou tronqué."
  printf '%s\t%s\n' "$path" "$rows" >> _expected.tsv
done < <(grep -E '"path": ' manifest.json)

cleanup() { rm -f _expected.tsv _gen_import.sql _gen_verify.sql _imported.tsv; }
trap cleanup EXIT

# Le compte doit pouvoir suspendre les contrôles le temps du chargement.
"${PSQL[@]}" -c 'BEGIN; SET LOCAL session_replication_role = replica; ROLLBACK;' >/dev/null 2>&1 \
  || die "ce compte ne peut pas suspendre les contrôles de clés étrangères (session_replication_role). Utiliser le compte postgres chez Supabase, ou un superutilisateur sur un PostgreSQL auto-hébergé."

"${PSQL[@]}" -v jid="$JID" -v fingerprint="$FINGERPRINT" <<'SQL'
\pset tuples_only on
\pset format unaligned
\pset fieldsep '\t'

-- La description des tables tient sur une ligne : on la lit comme un champ brut.
CREATE TEMP TABLE _schema (doc jsonb);
\copy _schema FROM 'schema.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
CREATE TEMP TABLE _tables AS
SELECT t ->> 'file' AS file, t ->> 'section' AS section, t ->> 'schema' AS sch,
       t ->> 'table' AS tbl, t -> 'columns' AS columns
  FROM _schema, jsonb_array_elements(doc -> 'tables') AS t;

SELECT set_config('import.fingerprint', :'fingerprint', false) AS _fp \gset

-- La cible doit porter les mêmes tables, colonne pour colonne.
DO $$
DECLARE
  missing text;
  target_fp text;
BEGIN
  SELECT string_agg(format('%s.%s', sch, tbl), ', ' ORDER BY sch, tbl) INTO missing
    FROM _tables
   WHERE section <> 'accounts' AND to_regclass(format('%I.%I', sch, tbl)) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'table(s) absente(s) de la base cible : %. Créer d''abord le schéma de la plateforme, ou charger l''export avec tenant-load-plain.sh.', missing;
  END IF;

  SELECT md5(string_agg(
           format('%s.%s.%s:%s', t.sch, t.tbl, a.attname, format_type(a.atttypid, a.atttypmod)),
           '|' ORDER BY t.sch, t.tbl, a.attname)) INTO target_fp
    FROM _tables t
    JOIN pg_attribute a ON a.attrelid = format('%I.%I', t.sch, t.tbl)::regclass
   WHERE t.section <> 'accounts'
     AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity <> 'a';
  IF target_fp IS DISTINCT FROM current_setting('import.fingerprint') THEN
    RAISE EXCEPTION 'le schéma de la cible (%) diffère de celui de l''export (%) : aligner les tables avant d''importer.',
      target_fp, current_setting('import.fingerprint');
  END IF;
END $$;

-- Une étape par fichier. Chaque ligne du fichier est un objet JSON, lu tel quel
-- puis réparti dans les colonnes de la table.
\o _gen_import.sql
SELECT format(
  E'CREATE TEMP TABLE _l (doc jsonb);\n\\copy _l FROM %L WITH (FORMAT csv, QUOTE E''\\x01'', DELIMITER E''\\x02'')\nINSERT INTO %I.%I (%s) SELECT %s FROM _l, jsonb_populate_record(NULL::%I.%I, _l.doc) AS r ON CONFLICT DO NOTHING;\nDROP TABLE _l;',
  t.file, t.sch, t.tbl,
  (SELECT string_agg(quote_ident(c ->> 'name'), ', ' ORDER BY ord)
     FROM jsonb_array_elements(t.columns) WITH ORDINALITY AS x(c, ord)),
  (SELECT string_agg('r.' || quote_ident(c ->> 'name'), ', ' ORDER BY ord)
     FROM jsonb_array_elements(t.columns) WITH ORDINALITY AS x(c, ord)),
  t.sch, t.tbl)
  FROM _tables t
 WHERE t.section <> 'accounts' OR to_regclass(format('%I.%I', t.sch, t.tbl)) IS NOT NULL
 ORDER BY t.file;
\o _gen_verify.sql
SELECT format('SELECT %L, count(*) FROM %I.%I WHERE jurisdiction_id = %L;', t.file, t.sch, t.tbl, :'jid')
  FROM _tables t
 WHERE t.section = 'tenant' AND t.columns @> '[{"name": "jurisdiction_id"}]'
 ORDER BY t.file;
\o

BEGIN;
SET LOCAL session_replication_role = replica;
\i _gen_import.sql

-- Les compteurs repartent après la plus grande valeur importée.
DO $$
DECLARE
  r record;
  top bigint;
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, c.relname AS tbl, a.attname AS col,
           pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) AS seq
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND pg_get_serial_sequence(format('%I.%I', n.nspname, c.relname), a.attname) IS NOT NULL
  LOOP
    EXECUTE format('SELECT max(%I) FROM %I.%I', r.col, r.sch, r.tbl) INTO top;
    IF top IS NOT NULL THEN
      PERFORM setval(r.seq, greatest(top, (SELECT last_value FROM pg_sequences
                                            WHERE schemaname || '.' || sequencename = r.seq)));
    END IF;
  END LOOP;
END $$;

-- Vérification dans la même transaction : la cible doit porter, pour ce pays,
-- au moins autant de lignes que l'export en annonce.
\o _imported.tsv
\i _gen_verify.sql
\o
COMMIT;
SQL

BAD="$(awk -F'\t' 'NR==FNR {want[$1]=$2; next} { gsub(/\r/, "", $2); if ($2 < want[$1]) print $1 " (attendu " want[$1] ", trouvé " $2 ")" }' _expected.tsv _imported.tsv)"
[ -z "$BAD" ] || die "import incomplet après validation — ne devrait pas arriver : $BAD"

TABLES="$(wc -l < _imported.tsv | tr -d ' ')"
TOTAL="$(awk -F'\t' '{s+=$2} END{print s+0}' _imported.tsv)"
echo "Import terminé dans « $TARGET_DB » : $TOTAL ligne(s) du pays sur $TABLES table(s), toutes vérifiées."
if [ "$("${PSQL[@]}" -tA -c "SELECT to_regclass('auth.users') IS NOT NULL" | tr -d '\r')" != "t" ]; then
  echo "Comptes NON chargés : la cible n'a pas de tables d'authentification. Ils restent dans accounts/, à reprendre dans le système d'identité de la cible."
fi
echo "Reste à faire à la main : les fichiers du stockage, qui ne font pas partie de l'export."
