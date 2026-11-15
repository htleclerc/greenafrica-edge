#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# tenant-roundtrip-test.sh — prouve qu'un pays se détache : export, puis import
# dans une autre base, puis comparaison ligne à ligne.
#
# Ne touche QUE la base locale de développement, et dans celle-ci seulement deux
# bases de travail qu'il crée et supprime lui-même :
#   gg_rt_src  la « base partagée », avec deux pays fictifs (TSTA et TSTB) ;
#   gg_rt_dst  le « projet neuf » où TSTA doit arriver seul.
#
# Ce qu'il vérifie :
#   1. l'export de TSTA ne contient aucune ligne de TSTB ;
#   2. après import, chaque table porte pour TSTA exactement les mêmes lignes
#      que la source (empreinte du contenu, pas seulement le nombre) ;
#   3. aucune ligne de TSTB n'est arrivée dans la cible ;
#   4. rejouer l'import ne duplique rien ;
#   5. un export modifié après coup est refusé.
#
# Usage : ./scripts/backup/tenant-roundtrip-test.sh
#   LOCAL_DB_URL     (facultatif)  défaut : la base Supabase locale.
#   LOCAL_ADMIN_URL  (facultatif)  compte superutilisateur local, sur template1.
#
# Effet de bord, local seulement : pour copier la base, le test coupe les
# sessions qui y sont ouvertes (une application de développement branchée
# dessus se reconnecte d'elle-même). Les tâches de fond de Supabase y gardent
# une connexion en permanence, on ne peut pas la copier autrement.
#
# Refuse de tourner contre autre chose que 127.0.0.1 / localhost.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

die() { echo "ÉCHEC: $*" >&2; exit 1; }
ok()  { echo "  ok — $*"; }

[[ "$BASE_URL" =~ @(127\.0\.0\.1|localhost)[:/] ]] || die "ce test ne tourne que sur une base locale."

# Même serveur, autre base : on remplace le dernier segment de l'adresse.
url_for() { printf '%s/%s' "${BASE_URL%/*}" "$1"; }
# Copier une base exige d'en couper les sessions, donc un superutilisateur :
# en local, c'est supabase_admin, avec le mot de passe par défaut de la pile.
ADMIN_URL="${LOCAL_ADMIN_URL:-postgresql://supabase_admin:postgres@127.0.0.1:54322/template1}"
[[ "$ADMIN_URL" =~ @(127\.0\.0\.1|localhost)[:/] ]] || die "LOCAL_ADMIN_URL doit viser une base locale."
SRC_URL="$(url_for gg_rt_src)"
DST_URL="$(url_for gg_rt_dst)"
TEMPLATE_DB="${BASE_URL##*/}"

WORK="$(mktemp -d)"
drop_dbs() {
  psql "$ADMIN_URL" -X -q -c 'DROP DATABASE IF EXISTS gg_rt_src' -c 'DROP DATABASE IF EXISTS gg_rt_dst' -c 'DROP DATABASE IF EXISTS gg_rt_plain' >/dev/null 2>&1 || true
}
cleanup() { drop_dbs; rm -rf "$WORK"; }
trap cleanup EXIT

echo "1. Deux bases de travail, copies du schéma local"
drop_dbs
# Les tâches de fond se reconnectent en une seconde ou deux : on coupe et on
# copie dans la foulée, en réessayant si elles ont été plus rapides.
clone_db() {
  local name="$1" attempt
  for attempt in 1 2 3 4 5 6; do
    if psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1 \
         -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$TEMPLATE_DB' AND pid <> pg_backend_pid()" \
         -c "CREATE DATABASE $name TEMPLATE \"$TEMPLATE_DB\"" >/dev/null 2>&1; then
      return 0
    fi
    psql "$ADMIN_URL" -X -q -c 'SELECT pg_sleep(0.5)' >/dev/null 2>&1 || true
  done
  return 1
}
clone_db gg_rt_src || die "impossible de copier la base locale vers gg_rt_src"
clone_db gg_rt_dst || die "impossible de copier la base locale vers gg_rt_dst"
ok "gg_rt_src et gg_rt_dst créées"

echo "2. Deux pays fictifs dans la source"
psql "$SRC_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
SET session_replication_role = replica;  -- jeu d'essai : on pose les lignes telles quelles

INSERT INTO public.jurisdictions (id, code, name, status) VALUES
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'TSTA', 'Pays fictif A', 'ACTIVE'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'TSTB', 'Pays fictif B', 'ACTIVE');

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'staff-a@roundtrip.test'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'staff-b@roundtrip.test');
INSERT INTO public.profiles (id, email, full_name, role, is_active) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'staff-a@roundtrip.test', 'Agent A', 'PORT_OFFICER', true),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'staff-b@roundtrip.test', 'Agent B', 'PORT_OFFICER', true);
INSERT INTO public.user_jurisdictions (user_id, jurisdiction_id) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-00000000000b');

INSERT INTO public.shipowners (id, name, account_state, official_email, preferred_language, jurisdiction_id) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000010', 'Armateur A', 'ACTIVE', 'owner-a@roundtrip.test', 'en', 'aaaaaaaa-0000-4000-8000-00000000000a'),
  ('bbbbbbbb-0000-4000-8000-000000000010', 'Armateur B', 'ACTIVE', 'owner-b@roundtrip.test', 'en', 'bbbbbbbb-0000-4000-8000-00000000000b');

INSERT INTO public.vessels (id, imo_number, mmsi, name, call_sign, flag_code, category,
                            gross_tonnage_dwt, engine_power_kw, design_speed_knots, jurisdiction_id) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000020', '9990000001', '999000001', 'Navire A, "le premier"', 'RTA', 'SO', 'CARGO', 5000, 1000, 12.0, 'aaaaaaaa-0000-4000-8000-00000000000a'),
  ('bbbbbbbb-0000-4000-8000-000000000020', '9990000002', '999000002', 'Navire B', 'RTB', 'DJ', 'CARGO', 5000, 1000, 12.0, 'bbbbbbbb-0000-4000-8000-00000000000b');

INSERT INTO public.transactions (id, vessel_id, vessel_name, vessel_imo, transaction_type,
                                 emissions_tco2, tax_amount_usd, status, shipowner_id, jurisdiction_id) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000030', 'aaaaaaaa-0000-4000-8000-000000000020', 'Navire A', '9990000001', 'ENTRY_TAX', 10.0, 100.0, 'PENDING', 'aaaaaaaa-0000-4000-8000-000000000010', 'aaaaaaaa-0000-4000-8000-00000000000a'),
  ('bbbbbbbb-0000-4000-8000-000000000030', 'bbbbbbbb-0000-4000-8000-000000000020', 'Navire B', '9990000002', 'ENTRY_TAX', 20.0, 200.0, 'PENDING', 'bbbbbbbb-0000-4000-8000-000000000010', 'bbbbbbbb-0000-4000-8000-00000000000b');

-- Tables filles : le pays est posé à la main ici, les déclencheurs étant suspendus.
INSERT INTO public.exemptions (vessel_id, vessel_name, reason, valid_until, approved_by, notes, jurisdiction_id) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000020', 'Navire A', 'OTHER', DATE '2030-01-01', 'aaaaaaaa-0000-4000-8000-000000000001', E'note sur\ndeux lignes', 'aaaaaaaa-0000-4000-8000-00000000000a'),
  ('bbbbbbbb-0000-4000-8000-000000000020', 'Navire B', 'OTHER', DATE '2030-01-01', 'bbbbbbbb-0000-4000-8000-000000000001', '', 'bbbbbbbb-0000-4000-8000-00000000000b');
INSERT INTO public.disputes (transaction_id, vessel_id, submitted_by, reason, description, original_amount_usd, jurisdiction_id) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000030', 'aaaaaaaa-0000-4000-8000-000000000020', 'aaaaaaaa-0000-4000-8000-000000000001', 'OTHER', 'litige A', 100.0, 'aaaaaaaa-0000-4000-8000-00000000000a'),
  ('bbbbbbbb-0000-4000-8000-000000000030', 'bbbbbbbb-0000-4000-8000-000000000020', 'bbbbbbbb-0000-4000-8000-000000000001', 'OTHER', 'litige B', 200.0, 'bbbbbbbb-0000-4000-8000-00000000000b');
SQL
ok "TSTA et TSTB peuplés"

echo "3. Export de TSTA"
EXPORT_DIR="$WORK/export" SUPABASE_DB_URL="$SRC_URL" bash "$SCRIPT_DIR/tenant-export.sh" TSTA >/dev/null
[ -f "$WORK/export/manifest.json" ] || die "pas de manifeste"
if grep -rl 'bbbbbbbb-0000-4000-8000' "$WORK/export/tenant" "$WORK/export/accounts" >/dev/null 2>&1; then
  die "l'export de TSTA contient des lignes de TSTB : $(grep -rl 'bbbbbbbb-0000-4000-8000' "$WORK/export/tenant" "$WORK/export/accounts" | tr '\n' ' ')"
fi
ok "aucune ligne de TSTB dans l'export"
grep -q 'staff-a@roundtrip.test' "$WORK/export/accounts/users.jsonl" || die "le compte du personnel de TSTA manque à l'export"
ok "les comptes cités par TSTA sont dans l'export"

echo "4. Import dans la base neuve"
TARGET_DB_URL="$DST_URL" bash "$SCRIPT_DIR/tenant-import.sh" "$WORK/export" >/dev/null 2>&1 \
  && die "l'import a accepté de tourner sans confirmation de la cible"
ok "import refusé sans confirmation de la cible"
TARGET_DB_URL="$DST_URL" CONFIRM_TARGET_DB=gg_rt_dst bash "$SCRIPT_DIR/tenant-import.sh" "$WORK/export" >/dev/null
ok "import terminé"

echo "5. Comparaison source / cible"
# Empreinte du contenu de chaque table pour TSTA, calculée de la même façon des
# deux côtés. Les colonnes calculées par la base sont comprises : elles doivent
# se recalculer à l'identique.
FINGERPRINT_SQL=$(cat <<'SQL'
SELECT format(
  'SELECT %L, count(*), coalesce(md5(string_agg(t::text, E''\n'' ORDER BY t::text)), '''') FROM public.%I t WHERE jurisdiction_id = %L;',
  c.relname, c.relname, 'aaaaaaaa-0000-4000-8000-00000000000a')
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'jurisdiction_id' AND NOT a.attisdropped)
 ORDER BY c.relname;
SQL
)
fingerprint() {
  psql "$1" -X -q -tA -v ON_ERROR_STOP=1 -c "$FINGERPRINT_SQL" > "$WORK/fp.sql"
  psql "$1" -X -q -tA -F '|' -v ON_ERROR_STOP=1 -f "$WORK/fp.sql"
}
fingerprint "$SRC_URL" > "$WORK/src.fp"
fingerprint "$DST_URL" > "$WORK/dst.fp"
if ! diff "$WORK/src.fp" "$WORK/dst.fp" > "$WORK/fp.diff"; then
  cat "$WORK/fp.diff" >&2
  die "le contenu de TSTA diffère entre la source et la cible"
fi
NONEMPTY="$(awk -F'|' '$2 > 0' "$WORK/src.fp" | wc -l | tr -d ' ')"
[ "$NONEMPTY" -ge 6 ] || die "le jeu d'essai ne couvre que $NONEMPTY table(s) : le test ne prouverait rien"
ok "contenu identique sur $(wc -l < "$WORK/src.fp" | tr -d ' ') tables, dont $NONEMPTY non vides"

LEAK="$(psql "$DST_URL" -X -q -tA -c "SELECT count(*) FROM public.shipowners WHERE jurisdiction_id = 'bbbbbbbb-0000-4000-8000-00000000000b'")"
LEAK2="$(psql "$DST_URL" -X -q -tA -c "SELECT count(*) FROM public.jurisdictions WHERE code = 'TSTB'")"
LEAK3="$(psql "$DST_URL" -X -q -tA -c "SELECT count(*) FROM auth.users WHERE email = 'staff-b@roundtrip.test'")"
[ "$LEAK$LEAK2$LEAK3" = "000" ] || die "des données de TSTB sont arrivées dans la cible"
ok "rien de TSTB dans la cible"

PEOPLE="$(psql "$DST_URL" -X -q -tA -c "SELECT count(*) FROM auth.users u JOIN public.profiles p ON p.id = u.id WHERE u.email = 'staff-a@roundtrip.test'")"
[ "$PEOPLE" = "1" ] || die "le compte du personnel de TSTA n'est pas arrivé complet (compte + profil)"
ok "compte et profil du personnel de TSTA arrivés"

echo "6. Rejouer l'import ne duplique rien"
TARGET_DB_URL="$DST_URL" CONFIRM_TARGET_DB=gg_rt_dst bash "$SCRIPT_DIR/tenant-import.sh" "$WORK/export" >/dev/null
fingerprint "$DST_URL" > "$WORK/dst2.fp"
diff "$WORK/dst.fp" "$WORK/dst2.fp" >/dev/null || die "un second import a changé le contenu"
ok "second import sans effet"

echo "6 bis. L'export se charge dans un PostgreSQL nu, sans la plateforme"
# template0 : une base vide d'origine — ni tables, ni extensions, ni schéma
# d'authentification. C'est le cas d'un État qui héberge sa propre base.
psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -c 'CREATE DATABASE gg_rt_plain TEMPLATE template0 OWNER postgres' \
  || die "impossible de créer la base nue"
PLAIN_URL="$(url_for gg_rt_plain)"
[ "$(psql "$PLAIN_URL" -X -q -tA -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")" = "0" ] \
  || die "la base nue n'est pas vide"
[ "$(psql "$PLAIN_URL" -X -q -tA -c "SELECT count(*) FROM pg_namespace WHERE nspname = 'auth'")" = "0" ] \
  || die "la base nue porte un schéma d'authentification"
TARGET_DB_URL="$PLAIN_URL" CONFIRM_TARGET_DB=gg_rt_plain bash "$SCRIPT_DIR/tenant-load-plain.sh" "$WORK/export" >/dev/null
ok "tables créées depuis schema.json et lignes chargées, nombres vérifiés"
# Contenu, pas seulement nombre : le navire dont le nom porte une virgule et des
# guillemets, et la note sur deux lignes, doivent arriver intacts.
NAME="$(psql "$PLAIN_URL" -X -q -tA -c "SELECT name FROM greengate_export.vessels WHERE id = 'aaaaaaaa-0000-4000-8000-000000000020'")"
[ "$NAME" = 'Navire A, "le premier"' ] || die "nom du navire altéré dans la base nue : $NAME"
LINES="$(psql "$PLAIN_URL" -X -q -tA -c "SELECT array_length(string_to_array(notes, E'\n'), 1) FROM greengate_export.exemptions WHERE vessel_id = 'aaaaaaaa-0000-4000-8000-000000000020'")"
[ "$LINES" = "2" ] || die "note sur deux lignes altérée dans la base nue ($LINES ligne)"
ok "valeurs délicates intactes (virgule, guillemets, saut de ligne)"
PEOPLE_PLAIN="$(psql "$PLAIN_URL" -X -q -tA -c "SELECT count(*) FROM greengate_export.account_users WHERE email = 'staff-a@roundtrip.test'")"
[ "$PEOPLE_PLAIN" = "1" ] || die "le compte du personnel de TSTA manque dans la base nue"
ok "comptes disponibles dans la base nue, hors de tout service d'authentification"
# L'import « plateforme » doit refuser cette base : elle n'a pas ses tables.
TARGET_DB_URL="$PLAIN_URL" CONFIRM_TARGET_DB=gg_rt_plain bash "$SCRIPT_DIR/tenant-import.sh" "$WORK/export" >/dev/null 2>"$WORK/plain.err" \
  && die "l'import de la plateforme a accepté une base sans ses tables"
grep -q 'absente' "$WORK/plain.err" || die "refus attendu pour tables absentes, obtenu : $(head -c 200 "$WORK/plain.err")"
ok "l'import de la plateforme refuse une base sans ses tables, et le dit"

echo "7. Un export altéré est refusé"
printf 'x' >> "$WORK/export/tenant/vessels.jsonl"
TARGET_DB_URL="$DST_URL" CONFIRM_TARGET_DB=gg_rt_dst bash "$SCRIPT_DIR/tenant-import.sh" "$WORK/export" >/dev/null 2>&1 \
  && die "un export modifié a été accepté"
ok "empreinte vérifiée avant toute écriture"

echo "8. Une table non classée bloque l'export"
# La copie appartient au superutilisateur : c'est lui qui peut y créer une table.
psql "${ADMIN_URL%/*}/gg_rt_src" -X -q -v ON_ERROR_STOP=1 -c 'CREATE TABLE public.rt_table_non_classee (id int)'
EXPORT_DIR="$WORK/export-bloque" SUPABASE_DB_URL="$SRC_URL" bash "$SCRIPT_DIR/tenant-export.sh" TSTA >/dev/null 2>"$WORK/bloque.err" \
  && die "l'export a tourné alors qu'une table n'est classée nulle part"
grep -q 'rt_table_non_classee' "$WORK/bloque.err" || die "l'export a échoué, mais sans nommer la table fautive"
[ ! -e "$WORK/export-bloque" ] || die "un export refusé a laissé un dossier derrière lui"
ok "export refusé, table nommée, aucun dossier laissé"

echo
echo "ALLER-RETOUR RÉUSSI : un pays sort de la base partagée et arrive seul, à l'identique."
