#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# tenant-import.sh — recharge dans une base l'export d'un pays.
#
# La base cible doit avoir EXACTEMENT le même schéma que la source : mêmes
# migrations, jouées jusqu'à la même version. Le script le vérifie et refuse
# sinon. Il n'y a pas d'import « à peu près ».
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
# par table, pas dans l'ordre de leurs dépendances, et elles portent déjà leur
# pays. La cohérence est celle de l'export, pris dans une transaction unique.
#
# Code de sortie : 0 = import vérifié, 1 = échec (rien n'a été écrit).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

die() { echo "FATAL: $*" >&2; exit 1; }

[ -n "${TARGET_DB_URL:-}" ] || die "TARGET_DB_URL n'est pas renseignée."
SRC="${1:-}"
[ -n "$SRC" ] && [ -d "$SRC" ] || die "dossier d'export attendu en argument."
[ -f "$SRC/manifest.json" ] || die "manifest.json absent : ce dossier n'est pas un export complet."
command -v psql >/dev/null || die "psql introuvable."
command -v sha256sum >/dev/null || die "sha256sum introuvable."

PSQL=(psql "$TARGET_DB_URL" -X -v ON_ERROR_STOP=1 -q)

TARGET_DB="$("${PSQL[@]}" -tA -c 'SELECT current_database()')"
[ "${CONFIRM_TARGET_DB:-}" = "$TARGET_DB" ] \
  || die "la cible est la base « $TARGET_DB ». Pour confirmer, relancer avec CONFIRM_TARGET_DB=$TARGET_DB"

cd "$SRC"

grep -q '"format": "greengate-tenant-export/1"' manifest.json || die "format d'export inconnu."
JID="$(grep -oE '"id": "[0-9a-f-]{36}"' manifest.json | head -1 | grep -oE '[0-9a-f-]{36}')"
EXPORT_MIGRATION="$(grep -oE '"migration_version": "[^"]*"' manifest.json | sed -E 's/.*: "(.*)"/\1/')"
[ -n "$JID" ] || die "identifiant du pays introuvable dans le manifeste."

TARGET_MIGRATION="$("${PSQL[@]}" -tA -c "SELECT coalesce(max(version), '') FROM supabase_migrations.schema_migrations")"
[ "$TARGET_MIGRATION" = "$EXPORT_MIGRATION" ] \
  || die "schémas différents : export en migration $EXPORT_MIGRATION, cible en $TARGET_MIGRATION. Aligner les migrations d'abord."

# ── Intégrité des fichiers, avant toute écriture ─────────────────────────────
: > _files.tsv
while IFS= read -r line; do
  path="$(printf '%s' "$line" | sed -E 's/.*"path": "([^"]+)".*/\1/')"
  rows="$(printf '%s' "$line" | sed -E 's/.*"rows": ([0-9]+).*/\1/')"
  sum="$(printf '%s' "$line" | sed -E 's/.*"sha256": "([0-9a-f]+)".*/\1/')"
  [[ "$path" =~ ^(tenant|auth|globals)/[a-z0-9_]+\.csv$ ]] || die "chemin inattendu dans le manifeste : $path"
  [ -f "$path" ] || die "fichier manquant : $path"
  [ "$(sha256sum "$path" | cut -d' ' -f1)" = "$sum" ] || die "empreinte différente pour $path : l'export a été modifié ou tronqué."
  header="$(head -n 1 "$path" | tr -d '\r')"
  [[ "$header" =~ ^[a-z0-9_,\"]+$ ]] || die "en-tête inattendu dans $path"
  case "$path" in
    auth/*) schema=auth ;;
    *)      schema=public ;;
  esac
  table="$(basename "$path" .csv)"
  printf '%s\t%s\t%s\t%s\t%s\n' "$path" "$schema" "$table" "$rows" "$header" >> _files.tsv
done < <(grep -E '"path": ' manifest.json)

cleanup() { rm -f _files.tsv _import.sql _imported.tsv; }
trap cleanup EXIT

# ── Script d'import, une étape par fichier ───────────────────────────────────
{
  echo '\pset tuples_only on'
  echo '\pset format unaligned'
  echo "\\pset fieldsep '\\t'"
  echo 'BEGIN;'
  echo 'SET LOCAL session_replication_role = replica;'
  while IFS=$'\t' read -r path schema table rows header; do
    echo "CREATE TEMP TABLE _imp (LIKE ${schema}.${table}) ON COMMIT DROP;"
    echo "\\copy _imp (${header}) FROM '${path}' WITH (FORMAT csv, HEADER true)"
    echo "INSERT INTO ${schema}.${table} (${header}) SELECT ${header} FROM _imp ON CONFLICT DO NOTHING;"
    echo 'DROP TABLE _imp;'
  done < _files.tsv

  # Les compteurs repartent après la plus grande valeur importée.
  cat <<'SQL'
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
SQL

  # Vérification dans la même transaction : pour chaque table du pays, la cible
  # doit porter au moins autant de lignes de ce pays que l'export en annonce.
  echo '\o _imported.tsv'
  while IFS=$'\t' read -r path schema table rows header; do
    case "$path" in
      tenant/*)
        if printf '%s' "$header" | tr ',' '\n' | grep -qx 'jurisdiction_id'; then
          echo "SELECT '${path}', ${rows}, count(*) FROM ${schema}.${table} WHERE jurisdiction_id = '${JID}';"
        fi ;;
    esac
  done < _files.tsv
  echo '\o'
  echo 'COMMIT;'
} > _import.sql

"${PSQL[@]}" -f _import.sql

BAD="$(awk -F'\t' '$3 < $2 {print $1 " (attendu " $2 ", trouvé " $3 ")"}' _imported.tsv)"
[ -z "$BAD" ] || die "import incomplet après validation — ne devrait pas arriver : $BAD"

TABLES="$(wc -l < _imported.tsv | tr -d ' ')"
TOTAL="$(awk -F'\t' '{s+=$3} END{print s+0}' _imported.tsv)"
echo "Import terminé dans « $TARGET_DB » : $TOTAL ligne(s) du pays sur $TABLES table(s), toutes vérifiées."
echo "Reste à faire à la main : les fichiers du stockage, qui ne font pas partie de l'export."
