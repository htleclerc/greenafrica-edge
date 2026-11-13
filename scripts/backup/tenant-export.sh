#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# tenant-export.sh — sort d'une base TOUTES les données d'un pays, et rien d'autre.
#
# LECTURE SEULE sur la base source : tout se passe dans une transaction
# REPEATABLE READ READ ONLY, donc l'export est une photographie cohérente même
# si l'application écrit pendant ce temps.
#
# Usage :
#   SUPABASE_DB_URL="postgresql://..." ./scripts/backup/tenant-export.sh SO
#
#   SUPABASE_DB_URL  (obligatoire)  base source. Jamais écrite en dur ici.
#   $1               (obligatoire)  code du pays, tel que dans public.jurisdictions.
#   EXPORT_DIR       (facultatif)   dossier de sortie. Par défaut
#                    <dépôt>/backups/tenant-<code>-<horodatage>. `backups/` est
#                    ignoré par git : un export ne se committe JAMAIS, il porte
#                    des données personnelles et des empreintes de mots de passe.
#
# Produit :
#   tenant/<table>.csv   les lignes du pays, une table par fichier ;
#   auth/users.csv, auth/identities.csv   les comptes que ces lignes citent ;
#   globals/<table>.csv  référentiels et réglages communs, en entier ;
#   manifest.json        pays, date, version de migration, lignes et SHA-256.
#
# Ce que l'export NE contient PAS : les fichiers du stockage (PDF de pro-formas,
# justificatifs), les positions de navires et d'aéronefs, les caches. Voir
# scripts/backup/tenant-tables.conf et docs/runbooks/export-import-par-pays.md.
#
# Code de sortie : 0 = export complet, 1 = échec (rien d'exploitable n'est laissé).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONF="$SCRIPT_DIR/tenant-tables.conf"

die() { echo "FATAL: $*" >&2; exit 1; }

[ -n "${SUPABASE_DB_URL:-}" ] || die "SUPABASE_DB_URL n'est pas renseignée."
CODE="${1:-}"
[[ "$CODE" =~ ^[A-Za-z0-9_]{2,16}$ ]] || die "code de pays attendu en argument (lettres, chiffres, _), reçu : '${CODE}'"
command -v psql >/dev/null || die "psql introuvable."
command -v sha256sum >/dev/null || die "sha256sum introuvable."
[ -f "$CONF" ] || die "classement des tables introuvable : $CONF"

PSQL=(psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -q)

JID="$("${PSQL[@]}" -tA -v code="$CODE" <<'SQL'
SELECT id FROM public.jurisdictions WHERE upper(code) = upper(:'code');
SQL
)"
[[ "$JID" =~ ^[0-9a-f-]{36}$ ]] || die "aucun pays de code '$CODE' dans public.jurisdictions."

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${EXPORT_DIR:-$REPO_ROOT/backups/tenant-$(echo "$CODE" | tr '[:upper:]' '[:lower:]')-$STAMP}"
[ ! -e "$OUT" ] || die "le dossier de sortie existe déjà : $OUT"
mkdir -p "$OUT/tenant" "$OUT/auth" "$OUT/globals"

# En cas d'échec, ne rien laisser qui ressemble à un export complet.
cleanup() { [ -f "$OUT/manifest.json" ] || rm -rf "$OUT"; }
trap cleanup EXIT

# Classement, débarrassé des commentaires et des lignes vides.
grep -vE '^[[:space:]]*(#|$)' "$CONF" > "$OUT/_conf.psv"

cd "$OUT"
"${PSQL[@]}" -v jid="$JID" <<'SQL'
\pset tuples_only on
\pset format unaligned
\pset fieldsep '\t'

-- Tables de travail, créées AVANT la transaction : une transaction en lecture
-- seule accepte d'écrire dans une table temporaire, pas d'en créer une.
CREATE TEMP TABLE _conf (tbl text PRIMARY KEY, class text NOT NULL, predicate text);
CREATE TEMP TABLE _exp_people (id uuid PRIMARY KEY);
CREATE TEMP TABLE _plan (ord int, sch text, tbl text, predicate text, filename text);
CREATE TEMP TABLE _cols (sch text, tbl text, cols text);

BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- \gset range le résultat dans une variable au lieu de l'afficher (pas de
-- /dev/null : le script doit aussi tourner sous Windows).
SELECT set_config('export.jid', :'jid', true) AS _export_jid \gset

\copy _conf FROM '_conf.psv' WITH (FORMAT csv, DELIMITER '|')

-- Garde-fou : chaque table du schéma public doit être classée.
DO $$
DECLARE
  unclassified text;
  unknown text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO unclassified
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attname = 'jurisdiction_id' AND NOT a.attisdropped)
     AND NOT EXISTS (SELECT 1 FROM _conf f WHERE f.tbl = c.relname);
  IF unclassified IS NOT NULL THEN
    RAISE EXCEPTION 'table(s) sans pays et non classée(s) dans tenant-tables.conf : %', unclassified;
  END IF;

  SELECT string_agg(f.tbl, ', ' ORDER BY f.tbl) INTO unknown
    FROM _conf f WHERE to_regclass('public.' || quote_ident(f.tbl)) IS NULL;
  IF unknown IS NOT NULL THEN
    RAISE EXCEPTION 'tenant-tables.conf cite des tables qui n''existent pas : %', unknown;
  END IF;

  IF EXISTS (SELECT 1 FROM _conf WHERE class NOT IN ('GLOBAL', 'DERIVED', 'SKIP')) THEN
    RAISE EXCEPTION 'tenant-tables.conf : classe inconnue (attendu GLOBAL, DERIVED ou SKIP)';
  END IF;
END $$;

-- Personnes citées par les données du pays : tout identifiant qu'une ligne du
-- pays range dans une colonne pointant vers profiles ou auth.users. Sans elles,
-- l'import laisserait des références dans le vide.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE c.contype = 'f' AND n.nspname = 'public'
       AND c.confrelid IN ('public.profiles'::regclass, 'auth.users'::regclass)
       AND EXISTS (SELECT 1 FROM pg_attribute j
                    WHERE j.attrelid = c.conrelid AND j.attname = 'jurisdiction_id' AND NOT j.attisdropped)
  LOOP
    EXECUTE format(
      'INSERT INTO _exp_people SELECT DISTINCT %I FROM %s WHERE jurisdiction_id = %L AND %I IS NOT NULL ON CONFLICT DO NOTHING',
      r.col, r.tbl, current_setting('export.jid'), r.col);
  END LOOP;
END $$;

-- Plan d'export : une ligne par fichier.

INSERT INTO _plan
SELECT 1, 'public', c.relname, format('jurisdiction_id = %L', :'jid'), 'tenant/' || c.relname || '.csv'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'jurisdiction_id' AND NOT a.attisdropped);

INSERT INTO _plan
SELECT 1, 'public', tbl, replace(predicate, ':jid', quote_literal(:'jid')), 'tenant/' || tbl || '.csv'
  FROM _conf WHERE class = 'DERIVED';

INSERT INTO _plan VALUES
  (2, 'auth', 'users',      'id IN (SELECT id FROM _exp_people)',      'auth/users.csv'),
  (2, 'auth', 'identities', 'user_id IN (SELECT id FROM _exp_people)', 'auth/identities.csv');

INSERT INTO _plan
SELECT 3, 'public', tbl, 'true', 'globals/' || tbl || '.csv' FROM _conf WHERE class = 'GLOBAL';

-- Les colonnes calculées par la base ne s'exportent pas : elles ne se réimportent pas.
INSERT INTO _cols
SELECT p.sch, p.tbl,
       string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) AS cols
  FROM _plan p
  JOIN pg_attribute a ON a.attrelid = format('%I.%I', p.sch, p.tbl)::regclass
 WHERE a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity <> 'a'
 GROUP BY p.sch, p.tbl;

\o _gen_export.sql
SELECT format('\copy (SELECT %s FROM %I.%I WHERE %s ORDER BY 1) TO %L WITH (FORMAT csv, HEADER true)',
              c.cols, p.sch, p.tbl, p.predicate, p.filename)
  FROM _plan p JOIN _cols c USING (sch, tbl)
 ORDER BY p.ord, p.filename;
\o _gen_counts.sql
SELECT format('SELECT %L, count(*) FROM %I.%I WHERE %s;', p.filename, p.sch, p.tbl, p.predicate)
  FROM _plan p ORDER BY p.ord, p.filename;
\o
\i _gen_export.sql
\o _counts.tsv
\i _gen_counts.sql
\o _meta.tsv
SELECT 'migration', coalesce(max(version), '') FROM supabase_migrations.schema_migrations;
SELECT 'code', code FROM public.jurisdictions WHERE id = :'jid';
SELECT 'name', name FROM public.jurisdictions WHERE id = :'jid';
\o
COMMIT;
SQL

# ── Manifeste ────────────────────────────────────────────────────────────────
MIGRATION="$(awk -F'\t' '$1=="migration"{print $2}' _meta.tsv)"
JCODE="$(awk -F'\t' '$1=="code"{print $2}' _meta.tsv)"
JNAME="$(awk -F'\t' '$1=="name"{print $2}' _meta.tsv)"
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

{
  printf '{\n'
  printf '  "format": "greengate-tenant-export/1",\n'
  printf '  "jurisdiction": { "id": "%s", "code": "%s", "name": "%s" },\n' "$JID" "$(json_escape "$JCODE")" "$(json_escape "$JNAME")"
  printf '  "exported_at": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "migration_version": "%s",\n' "$MIGRATION"
  printf '  "files": [\n'
  first=1
  while IFS=$'\t' read -r file rows; do
    [ -f "$file" ] || die "fichier annoncé mais absent : $file"
    sum="$(sha256sum "$file" | cut -d' ' -f1)"
    [ $first -eq 1 ] || printf ',\n'
    first=0
    printf '    { "path": "%s", "rows": %s, "sha256": "%s" }' "$file" "$rows" "$sum"
  done < _counts.tsv
  printf '\n  ]\n}\n'
} > manifest.json.tmp

rm -f _conf.psv _gen_export.sql _gen_counts.sql _counts.tsv _meta.tsv
mv manifest.json.tmp manifest.json

TOTAL="$(grep -o '"rows": [0-9]*' manifest.json | awk '{s+=$2} END{print s+0}')"
echo "Export du pays $JCODE ($JID) terminé : $TOTAL ligne(s), migration $MIGRATION."
echo "Dossier : $OUT"
echo "Ce dossier contient des données personnelles : le chiffrer avant tout transfert."
