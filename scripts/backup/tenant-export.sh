#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# tenant-export.sh — sort d'une base TOUTES les données d'un pays, et rien d'autre,
# dans un format qui ne dépend ni de Supabase ni même de PostgreSQL.
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
#   EXPORT_SIGNING_KEY  (recommandé)  clé privée (PEM) qui signe le manifeste.
#                    Sans elle l'export sort non signé, et les chargements le
#                    refusent : rien ne prouverait d'où il vient. La clé ne se
#                    range ni dans le dépôt ni dans le dossier d'export.
#
# Produit (format « greengate-tenant-export/3 ») :
#   tenant/<table>.jsonl    les lignes du pays, une table par fichier ;
#   accounts/<table>.jsonl  les comptes que ces lignes citent, si la source en a ;
#   globals/<table>.jsonl   référentiels et réglages communs, en entier ;
#   schema.json             tables, colonnes, types, clés primaires et étrangères ;
#   manifest.json           pays, date, empreinte du schéma, lignes et SHA-256 ;
#   manifest.sig            signature du manifeste, si une clé est fournie.
#
# Le format est neutre : JSON Lines (un objet JSON par ligne, UTF-8), dates en
# ISO 8601, booléens true/false, tableaux en tableaux JSON, absence de valeur en
# null. Rien n'y suppose la base d'arrivée : avec schema.json, un État peut le
# charger dans son propre système, quel qu'il soit.
#
# Une exception à « absence de valeur en null » : dans une colonne de type JSON,
# null est une valeur comme une autre. Pour ces colonnes seulement, l'absence de
# valeur se note par l'absence du champ, et null veut dire « la valeur JSON
# null ».
#
# Ce que l'export NE contient PAS : les fichiers du stockage (PDF de pro-formas,
# justificatifs), les positions de navires et d'aéronefs, les caches. Voir
# scripts/backup/tenant-tables.conf et docs/runbooks/export-import-par-pays.md.
#
# Code de sortie : 0 = export complet, 1 = échec (rien d'exploitable n'est laissé).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
# Tout ce que ce script crée n'est lisible que par celui qui le lance : l'export
# porte des comptes et des empreintes de mots de passe.
umask 077
# L'export est en UTF-8 quel que soit le poste : sans cela, psql sous Windows
# écrirait dans l'encodage de la console.
export PGCLIENTENCODING=UTF8

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONF="$SCRIPT_DIR/tenant-tables.conf"
FP_SQL="$SCRIPT_DIR/tenant-fingerprint.sql"

die() { echo "FATAL: $*" >&2; exit 1; }

[ -n "${SUPABASE_DB_URL:-}" ] || die "SUPABASE_DB_URL n'est pas renseignée."
CODE="${1:-}"
[[ "$CODE" =~ ^[A-Za-z0-9_]{2,16}$ ]] || die "code de pays attendu en argument (lettres, chiffres, _), reçu : '${CODE}'"
command -v psql >/dev/null || die "psql introuvable."
command -v sha256sum >/dev/null || die "sha256sum introuvable."
[ -f "$CONF" ] || die "classement des tables introuvable : $CONF"
[ -f "$FP_SQL" ] || die "calcul de l'empreinte introuvable : $FP_SQL"
SIGNING_KEY=""
if [ -n "${EXPORT_SIGNING_KEY:-}" ]; then
  [ -f "$EXPORT_SIGNING_KEY" ] || die "clé de signature introuvable : $EXPORT_SIGNING_KEY"
  command -v openssl >/dev/null || die "openssl introuvable."
  # Chemin absolu : la suite du script change de dossier.
  SIGNING_KEY="$(cd "$(dirname "$EXPORT_SIGNING_KEY")" && pwd)/$(basename "$EXPORT_SIGNING_KEY")"
fi

PSQL=(psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -q)

JID="$("${PSQL[@]}" -tA -v code="$CODE" <<'SQL'
SELECT id FROM public.jurisdictions WHERE upper(code) = upper(:'code');
SQL
)"
[[ "$JID" =~ ^[0-9a-f-]{36}$ ]] || die "aucun pays de code '$CODE' dans public.jurisdictions."

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${EXPORT_DIR:-$REPO_ROOT/backups/tenant-$(echo "$CODE" | tr '[:upper:]' '[:lower:]')-$STAMP}"
[ ! -e "$OUT" ] || die "le dossier de sortie existe déjà : $OUT"
mkdir -p "$OUT/tenant" "$OUT/accounts" "$OUT/globals"

# En cas d'échec, ne rien laisser qui ressemble à un export complet.
cleanup() { [ -f "$OUT/manifest.json" ] || rm -rf "$OUT"; }
trap cleanup EXIT

# Classement, débarrassé des commentaires et des lignes vides.
grep -vE '^[[:space:]]*(#|$)' "$CONF" > "$OUT/_conf.psv"
cp "$FP_SQL" "$OUT/_fingerprint.sql"

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
CREATE TEMP TABLE _cols (sch text, tbl text, cols text, json_absent text);
\i _fingerprint.sql

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
-- pays range dans une colonne pointant vers les profils ou les comptes. Sans
-- elles, l'import laisserait des références dans le vide.
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
       AND c.confrelid IN (SELECT x::oid FROM unnest(ARRAY[to_regclass('public.profiles'),
                                                          to_regclass('auth.users')]) x
                            WHERE x IS NOT NULL)
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
SELECT 1, 'public', c.relname, format('jurisdiction_id = %L', :'jid'), 'tenant/' || c.relname || '.jsonl'
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'jurisdiction_id' AND NOT a.attisdropped);

INSERT INTO _plan
SELECT 1, 'public', tbl, replace(predicate, ':jid', quote_literal(:'jid')), 'tenant/' || tbl || '.jsonl'
  FROM _conf WHERE class = 'DERIVED';

-- Comptes : seulement si la source a un service d'authentification de ce type.
INSERT INTO _plan
SELECT 2, 'auth', v.tbl, v.predicate, 'accounts/' || v.tbl || '.jsonl'
  FROM (VALUES ('users',      'id IN (SELECT id FROM _exp_people)'),
               ('identities', 'user_id IN (SELECT id FROM _exp_people)')) AS v(tbl, predicate)
 WHERE to_regclass('auth.' || v.tbl) IS NOT NULL;

INSERT INTO _plan
SELECT 3, 'public', tbl, 'true', 'globals/' || tbl || '.jsonl' FROM _conf WHERE class = 'GLOBAL';

-- Les colonnes calculées par la base ne s'exportent pas : elles se recalculent.
-- Les jetons à usage unique des comptes (confirmation, récupération, changement
-- d'adresse…) ne sortent pas : ils partent vides. Vides et non absents, parce
-- que le service d'authentification ne sait pas relire un jeton absent.
--
-- json_absent : pour les colonnes de type JSON, la liste des champs à retirer de
-- la ligne quand la colonne n'a pas de valeur. Sans cela, « pas de valeur » et
-- « la valeur JSON null » sortiraient toutes deux en null, et la seconde
-- reviendrait vide à l'import.
INSERT INTO _cols
SELECT p.sch, p.tbl,
       string_agg(
         CASE WHEN p.sch = 'auth' AND p.tbl = 'users' AND a.attname LIKE '%token%'
              THEN format('%L AS %I', '', a.attname)
              ELSE quote_ident(a.attname) END,
         ', ' ORDER BY a.attnum) AS cols,
       string_agg(format('CASE WHEN x.%I IS NULL THEN %L END', a.attname, a.attname), ', ' ORDER BY a.attnum)
         FILTER (WHERE a.atttypid IN ('json'::regtype, 'jsonb'::regtype)) AS json_absent
  FROM _plan p
  JOIN pg_attribute a ON a.attrelid = format('%I.%I', p.sch, p.tbl)::regclass
 WHERE a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity <> 'a'
 GROUP BY p.sch, p.tbl;

-- Un fichier par table, une ligne JSON par enregistrement.
\o _gen_export.sql
SELECT format(E'\\o %s\nSELECT (%s)::text FROM (SELECT %s FROM %I.%I WHERE %s ORDER BY 1) x;',
              p.filename,
              CASE WHEN c.json_absent IS NULL THEN 'to_jsonb(x)'
                   ELSE format('to_jsonb(x) - array_remove(ARRAY[%s]::text[], NULL)', c.json_absent) END,
              c.cols, p.sch, p.tbl, p.predicate)
  FROM _plan p JOIN _cols c USING (sch, tbl)
 ORDER BY p.ord, p.filename;
\o _gen_counts.sql
SELECT format('SELECT %L, count(*) FROM %I.%I WHERE %s;', p.filename, p.sch, p.tbl, p.predicate)
  FROM _plan p ORDER BY p.ord, p.filename;
\o
\i _gen_export.sql
\o _counts.tsv
\i _gen_counts.sql

-- Description des tables, sur une seule ligne : c'est elle qui permet de créer
-- les tables ailleurs sans rejouer les migrations de cette plateforme.
\o schema.json
SELECT jsonb_build_object('tables', jsonb_agg(t ORDER BY t ->> 'file'))::text
  FROM (
    SELECT jsonb_build_object(
      'file', p.filename,
      'section', split_part(p.filename, '/', 1),
      'schema', p.sch,
      'table', p.tbl,
      -- Empreinte de la table, pour qu'un import sache nommer celle qui diffère.
      -- Les tables de comptes n'en ont pas : leur forme appartient au service
      -- d'authentification, pas à la plateforme.
      'fingerprint', CASE WHEN p.sch = 'public'
                          THEN pg_temp.table_fingerprint(format('%I.%I', p.sch, p.tbl)::regclass) END,
      'columns', (
        SELECT jsonb_agg(jsonb_build_object(
                 'name', a.attname,
                 'type', format_type(a.atttypid, a.atttypmod),
                 'nullable', NOT a.attnotnull) ORDER BY a.attnum)
          FROM pg_attribute a
         WHERE a.attrelid = format('%I.%I', p.sch, p.tbl)::regclass
           AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity <> 'a'),
      'primary_key', (
        SELECT coalesce(jsonb_agg(a.attname ORDER BY k.ord), '[]'::jsonb)
          FROM pg_constraint c
          CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.conrelid = format('%I.%I', p.sch, p.tbl)::regclass AND c.contype = 'p'),
      'foreign_keys', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'columns', (SELECT jsonb_agg(a.attname ORDER BY k.ord)
                               FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum),
                 'references', (SELECT rn.nspname || '.' || rc.relname
                                  FROM pg_class rc JOIN pg_namespace rn ON rn.oid = rc.relnamespace
                                 WHERE rc.oid = c.confrelid))), '[]'::jsonb)
          FROM pg_constraint c
         WHERE c.conrelid = format('%I.%I', p.sch, p.tbl)::regclass AND c.contype = 'f')
    ) AS t
    FROM _plan p
  ) s;

\o _meta.tsv
SELECT 'code', code FROM public.jurisdictions WHERE id = :'jid';
SELECT 'name', name FROM public.jurisdictions WHERE id = :'jid';
-- Empreinte du schéma : colonnes, clés et contraintes des tables du pays et des
-- référentiels (voir tenant-fingerprint.sql). Une base d'arrivée de même nature
-- la recalcule sur ses propres tables pour savoir si elle peut recevoir cet
-- export tel quel.
SELECT 'fingerprint', pg_temp.schema_fingerprint(array_agg(format('%I.%I', p.sch, p.tbl)::regclass))
  FROM _plan p
 WHERE p.sch = 'public';
SELECT 'source_engine', 'PostgreSQL ' || current_setting('server_version');
\o
COMMIT;
SQL

# ── Manifeste ────────────────────────────────────────────────────────────────
meta() { awk -F'\t' -v k="$1" '$1==k{print $2}' _meta.tsv | tr -d '\r'; }
JCODE="$(meta code)"
JNAME="$(meta name)"
FINGERPRINT="$(meta fingerprint)"
ENGINE="$(meta source_engine)"
[ -n "$FINGERPRINT" ] || die "empreinte du schéma vide."
json_escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

{
  printf '{\n'
  printf '  "format": "greengate-tenant-export/3",\n'
  printf '  "jurisdiction": { "id": "%s", "code": "%s", "name": "%s" },\n' "$JID" "$(json_escape "$JCODE")" "$(json_escape "$JNAME")"
  printf '  "exported_at": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "source_engine": "%s",\n' "$(json_escape "$ENGINE")"
  printf '  "schema_fingerprint": "%s",\n' "$FINGERPRINT"
  printf '  "data_format": "JSON Lines, UTF-8 ; dates ISO 8601 ; un objet par ligne ; colonnes de type JSON : champ absent = pas de valeur, null = valeur JSON null ; voir schema.json",\n'
  printf '  "files": [\n'
  first=1
  while IFS=$'\t' read -r file rows; do
    rows="$(printf '%s' "$rows" | tr -d '\r')"
    [ -f "$file" ] || die "fichier annoncé mais absent : $file"
    sum="$(sha256sum "$file" | cut -d' ' -f1)"
    [ $first -eq 1 ] || printf ',\n'
    first=0
    printf '    { "path": "%s", "rows": %s, "sha256": "%s" }' "$file" "$rows" "$sum"
  done < _counts.tsv
  printf ',\n    { "path": "schema.json", "rows": 1, "sha256": "%s" }' "$(sha256sum schema.json | cut -d' ' -f1)"
  printf '\n  ]\n}\n'
} > manifest.json.tmp

rm -f _conf.psv _fingerprint.sql _gen_export.sql _gen_counts.sql _counts.tsv _meta.tsv

# Signature : le manifeste porte l'empreinte de tous les fichiers, le signer
# suffit à signer l'export entier. Posée avant le manifeste : sans manifeste le
# dossier n'est pas un export, un échec ici ne laisse donc rien derrière lui.
if [ -n "$SIGNING_KEY" ]; then
  openssl dgst -sha256 -sign "$SIGNING_KEY" -out manifest.sig manifest.json.tmp \
    || die "signature du manifeste impossible avec la clé fournie."
fi
mv manifest.json.tmp manifest.json

TOTAL="$(grep -o '"rows": [0-9]*' manifest.json | awk '{s+=$2} END{print s+0}')"
echo "Export du pays $JCODE ($JID) terminé : $((TOTAL - 1)) ligne(s), schéma $FINGERPRINT."
echo "Dossier : $OUT"
echo "Ce dossier contient des données personnelles : le chiffrer avant tout transfert."
if [ -z "$SIGNING_KEY" ]; then
  echo "ATTENTION : export NON signé (EXPORT_SIGNING_KEY absente). Les chargements le refuseront." >&2
fi
