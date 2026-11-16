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
#   4. rejouer l'import ne duplique rien, quel que soit le search_path ;
#   5. un export modifié après coup est refusé ;
#   6. un export non signé, ou signé par un autre, est refusé ;
#   7. un export forgé — ligne d'un autre pays, table détournée — est refusé
#      même si l'on saute la signature ;
#   8. une ligne déjà présente avec un autre contenu arrête l'import, et rien
#      de ce qu'il avait commencé à écrire ne reste ;
#   9. une contrainte en plus dans la cible fait refuser l'import ;
#  10. une valeur JSON null reste une valeur JSON null.
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
export PGCLIENTENCODING=UTF8

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

# Une paire de clés jetable : l'export est signé avec la première, les
# chargements le vérifient avec la seconde. Une autre paire joue l'inconnu.
command -v openssl >/dev/null || die "openssl introuvable."
new_keypair() {
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out "$WORK/$1.key" 2>/dev/null
  openssl pkey -in "$WORK/$1.key" -pubout -out "$WORK/$1.pub" 2>/dev/null
}
new_keypair emetteur || die "impossible de créer la paire de clés d'essai"
new_keypair inconnu || die "impossible de créer la seconde paire de clés d'essai"
export EXPORT_VERIFY_KEY="$WORK/emetteur.pub"

# Un attaquant soigneux recalcule l'empreinte du fichier qu'il a touché.
resum() {  # <dossier d'export> <chemin du fichier>
  local sum
  sum="$(sha256sum "$1/$2" | cut -d' ' -f1)"
  sed -i -E "s#(\"path\": \"$2\", \"rows\": [0-9]+, \"sha256\": \")[0-9a-f]+#\1$sum#" "$1/manifest.json"
}
# Lance un chargement qui DOIT échouer, et vérifie qu'il dit pourquoi.
must_refuse() {  # <libellé> <motif attendu> <commande…>
  local label="$1" pattern="$2"
  shift 2
  if "$@" >/dev/null 2>"$WORK/refus.err"; then
    die "$label : accepté alors qu'il devait être refusé"
  fi
  grep -qE "$pattern" "$WORK/refus.err" \
    || die "$label : refusé, mais pas pour la raison attendue — $(head -c 300 "$WORK/refus.err")"
}
import_into_dst() { TARGET_DB_URL="$DST_URL" CONFIRM_TARGET_DB=gg_rt_dst bash "$SCRIPT_DIR/tenant-import.sh" "$1" "${2:-TSTA}"; }

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
INSERT INTO auth.identities (id, user_id, provider, provider_id, identity_data) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'email', 'aaaaaaaa-0000-4000-8000-000000000001', '{"sub": "aaaaaaaa-0000-4000-8000-000000000001"}'::jsonb);
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

-- La première transaction de A porte la valeur JSON null, la seconde aucune
-- valeur : les deux doivent arriver telles quelles, sans se confondre.
INSERT INTO public.transactions (id, vessel_id, vessel_name, vessel_imo, transaction_type,
                                 emissions_tco2, tax_amount_usd, status, shipowner_id, jurisdiction_id, breakdown_json) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000030', 'aaaaaaaa-0000-4000-8000-000000000020', 'Navire A', '9990000001', 'ENTRY_TAX', 10.0, 100.0, 'PENDING', 'aaaaaaaa-0000-4000-8000-000000000010', 'aaaaaaaa-0000-4000-8000-00000000000a', 'null'::jsonb),
  ('aaaaaaaa-0000-4000-8000-000000000031', 'aaaaaaaa-0000-4000-8000-000000000020', 'Navire A', '9990000001', 'ENTRY_TAX', 11.0, 110.0, 'PENDING', 'aaaaaaaa-0000-4000-8000-000000000010', 'aaaaaaaa-0000-4000-8000-00000000000a', NULL),
  ('bbbbbbbb-0000-4000-8000-000000000030', 'bbbbbbbb-0000-4000-8000-000000000020', 'Navire B', '9990000002', 'ENTRY_TAX', 20.0, 200.0, 'PENDING', 'bbbbbbbb-0000-4000-8000-000000000010', 'bbbbbbbb-0000-4000-8000-00000000000b', NULL);

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
EXPORT_DIR="$WORK/export" SUPABASE_DB_URL="$SRC_URL" EXPORT_SIGNING_KEY="$WORK/emetteur.key" \
  bash "$SCRIPT_DIR/tenant-export.sh" TSTA >/dev/null
[ -f "$WORK/export/manifest.json" ] || die "pas de manifeste"
[ -s "$WORK/export/manifest.sig" ] || die "l'export n'est pas signé"
if grep -rl 'bbbbbbbb-0000-4000-8000' "$WORK/export/tenant" "$WORK/export/accounts" >/dev/null 2>&1; then
  die "l'export de TSTA contient des lignes de TSTB : $(grep -rl 'bbbbbbbb-0000-4000-8000' "$WORK/export/tenant" "$WORK/export/accounts" | tr '\n' ' ')"
fi
ok "aucune ligne de TSTB dans l'export"
grep -q 'staff-a@roundtrip.test' "$WORK/export/accounts/users.jsonl" || die "le compte du personnel de TSTA manque à l'export"
ok "les comptes cités par TSTA sont dans l'export"

echo "4. Import dans la base neuve"
TARGET_DB_URL="$DST_URL" bash "$SCRIPT_DIR/tenant-import.sh" "$WORK/export" TSTA >/dev/null 2>&1 \
  && die "l'import a accepté de tourner sans confirmation de la cible"
ok "import refusé sans confirmation de la cible"
EXPORT_VERIFY_KEY="" must_refuse "import sans clé de vérification" 'EXPORT_VERIFY_KEY' import_into_dst "$WORK/export"
EXPORT_VERIFY_KEY="$WORK/inconnu.pub" must_refuse "import avec la clé d'un autre" 'signature' import_into_dst "$WORK/export"
cp -r "$WORK/export" "$WORK/nonsigne" && rm "$WORK/nonsigne/manifest.sig"
must_refuse "export non signé" 'non signé' import_into_dst "$WORK/nonsigne"
ok "import refusé sans clé, avec la clé d'un autre, et pour un export non signé"
must_refuse "pays attendu différent de celui de l'export" 'autre pays' import_into_dst "$WORK/export" TSTB
ok "import refusé quand l'opérateur attend un autre pays"
import_into_dst "$WORK/export" >/dev/null
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

JNULL="$(psql "$DST_URL" -X -q -tA -c "SELECT coalesce(breakdown_json::text, 'VIDE') FROM public.transactions WHERE id = 'aaaaaaaa-0000-4000-8000-000000000030'")"
JVOID="$(psql "$DST_URL" -X -q -tA -c "SELECT coalesce(breakdown_json::text, 'VIDE') FROM public.transactions WHERE id = 'aaaaaaaa-0000-4000-8000-000000000031'")"
[ "$JNULL" = "null" ] || die "la valeur JSON null est arrivée altérée : $JNULL"
[ "$JVOID" = "VIDE" ] || die "l'absence de valeur JSON est arrivée altérée : $JVOID"
ok "valeur JSON null et absence de valeur arrivées distinctes"

echo "6. Rejouer l'import ne duplique rien"
# Rejoué avec un autre search_path : l'empreinte du schéma ne doit pas dépendre
# de la session qui la calcule.
# Un fichier de travail pré-placé dans le dossier reçu ne doit être ni lu ni
# écrasé : le script travaille sur sa propre copie.
printf 'piège\n' > "$WORK/export/_gen_stage.sql"
PGOPTIONS='-c search_path=auth' import_into_dst "$WORK/export" > "$WORK/replay.out"
grep -q ' 0 ligne(s) posée(s)' "$WORK/replay.out" || die "le second import a posé des lignes : $(cat "$WORK/replay.out")"
[ "$(cat "$WORK/export/_gen_stage.sql")" = "piège" ] || die "l'import a écrit dans le dossier d'export reçu"
rm "$WORK/export/_gen_stage.sql"
[ -z "$(find "$WORK/export" -maxdepth 1 -name '_*')" ] || die "l'import a laissé des fichiers de travail dans le dossier reçu"
ok "le dossier reçu n'est ni modifié ni utilisé comme espace de travail"
fingerprint "$DST_URL" > "$WORK/dst2.fp"
diff "$WORK/dst.fp" "$WORK/dst2.fp" >/dev/null || die "un second import a changé le contenu"
ok "second import sans effet, sous un autre search_path"

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
EXPORT_VERIFY_KEY="$WORK/inconnu.pub" must_refuse "chargement nu avec la clé d'un autre" 'signature' \
  env TARGET_DB_URL="$PLAIN_URL" CONFIRM_TARGET_DB=gg_rt_plain bash "$SCRIPT_DIR/tenant-load-plain.sh" "$WORK/export" refus_signature
TARGET_DB_URL="$PLAIN_URL" CONFIRM_TARGET_DB=gg_rt_plain bash "$SCRIPT_DIR/tenant-load-plain.sh" "$WORK/export" >/dev/null
ok "tables créées depuis schema.json et lignes chargées, nombres vérifiés"
JNULL="$(psql "$PLAIN_URL" -X -q -tA -c "SELECT coalesce(breakdown_json::text, 'VIDE') FROM greengate_export.transactions WHERE id = 'aaaaaaaa-0000-4000-8000-000000000030'")"
JVOID="$(psql "$PLAIN_URL" -X -q -tA -c "SELECT coalesce(breakdown_json::text, 'VIDE') FROM greengate_export.transactions WHERE id = 'aaaaaaaa-0000-4000-8000-000000000031'")"
[ "$JNULL$JVOID" = "nullVIDE" ] || die "JSON null ou absence de valeur altérés dans la base nue : $JNULL / $JVOID"
ok "valeur JSON null et absence de valeur distinctes dans la base nue"
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
TARGET_DB_URL="$PLAIN_URL" CONFIRM_TARGET_DB=gg_rt_plain bash "$SCRIPT_DIR/tenant-import.sh" "$WORK/export" TSTA >/dev/null 2>"$WORK/plain.err" \
  && die "l'import de la plateforme a accepté une base sans ses tables"
grep -q 'absente' "$WORK/plain.err" || die "refus attendu pour tables absentes, obtenu : $(head -c 200 "$WORK/plain.err")"
ok "l'import de la plateforme refuse une base sans ses tables, et le dit"

echo "6 ter. Un export forgé, aux empreintes pourtant cohérentes, est refusé"
# Un nom de table contenant un saut de ligne ferait écrire une commande de plus
# dans le script de chargement. On forge schema.json, puis on recalcule son
# empreinte dans le manifeste, comme le ferait un attaquant soigneux.
cp -r "$WORK/export" "$WORK/forged"
sed -i 's/"table": "vessels"/"table": "vessels\nPWNED"/' "$WORK/forged/schema.json"
NEWSUM="$(sha256sum "$WORK/forged/schema.json" | cut -d' ' -f1)"
sed -i -E "s/(\"path\": \"schema.json\", \"rows\": 1, \"sha256\": \")[0-9a-f]+/\1$NEWSUM/" "$WORK/forged/manifest.json"
grep -q 'PWNED' "$WORK/forged/schema.json" || die "le jeu d'essai forgé n'a pas été fabriqué"
must_refuse "schema.json forgé, signature d'origine" 'signature' import_into_dst "$WORK/forged"
ALLOW_UNSIGNED_EXPORT=1 TARGET_DB_URL="$DST_URL" CONFIRM_TARGET_DB=gg_rt_dst bash "$SCRIPT_DIR/tenant-import.sh" "$WORK/forged" TSTA >/dev/null 2>"$WORK/forged1.err" \
  && die "l'import a accepté un schema.json forgé"
grep -qE 'export refusé|invalid input syntax' "$WORK/forged1.err" || die "refus attendu pour schema.json forgé, obtenu : $(head -c 200 "$WORK/forged1.err")"
ALLOW_UNSIGNED_EXPORT=1 TARGET_DB_URL="$PLAIN_URL" CONFIRM_TARGET_DB=gg_rt_plain bash "$SCRIPT_DIR/tenant-load-plain.sh" "$WORK/forged" forge_test >/dev/null 2>"$WORK/forged2.err" \
  && die "le chargement dans une base nue a accepté un schema.json forgé"
grep -qE 'export refusé|invalid input syntax' "$WORK/forged2.err" || die "refus attendu pour schema.json forgé (base nue), obtenu : $(head -c 200 "$WORK/forged2.err")"
[ ! -e "$WORK/forged/pwned.txt" ] || die "la commande glissée dans l'export a été exécutée"
ok "noms contrôlés avant toute génération, aucune commande exécutée"

echo "6 quater. Un export forgé est refusé même sans contrôle de signature"
# Les refus qui suivent sautent la signature exprès (ALLOW_UNSIGNED_EXPORT=1) :
# ils prouvent que l'import ne s'en remet pas à elle seule.
unsigned_import() { ALLOW_UNSIGNED_EXPORT=1 import_into_dst "$1"; }

# a) Une ligne d'un autre pays glissée dans le fichier d'une table du pays.
cp -r "$WORK/export" "$WORK/forged_pays"
sed -i 's/aaaaaaaa-0000-4000-8000-00000000000a/bbbbbbbb-0000-4000-8000-00000000000b/' "$WORK/forged_pays/tenant/shipowners.jsonl"
resum "$WORK/forged_pays" tenant/shipowners.jsonl
must_refuse "ligne d'un autre pays" 'pays annoncé' unsigned_import "$WORK/forged_pays"
ok "ligne d'un autre pays refusée"

# b) Un fichier renvoyé vers une table que la cible ne range pas parmi les
#    données d'un pays : ici un référentiel commun présenté comme tel.
cp -r "$WORK/export" "$WORK/forged_table"
(
  cd "$WORK/forged_table"
  psql "$DST_URL" -X -q -tA -v ON_ERROR_STOP=1 > schema.new <<'SQL'
CREATE TEMP TABLE s (doc jsonb);
\copy s FROM 'schema.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
SELECT jsonb_build_object('tables', (
         SELECT jsonb_agg(CASE WHEN t ->> 'table' = 'fx_rates'
                               THEN t || '{"file": "tenant/fx_rates.jsonl", "section": "tenant"}'::jsonb
                               ELSE t END)
           FROM jsonb_array_elements(doc -> 'tables') AS t))::text
  FROM s;
SQL
  mv schema.new schema.json
  mv globals/fx_rates.jsonl tenant/fx_rates.jsonl
  sed -i 's#"path": "globals/fx_rates.jsonl"#"path": "tenant/fx_rates.jsonl"#' manifest.json
)
resum "$WORK/forged_table" schema.json
grep -q '"file": "tenant/fx_rates.jsonl"' "$WORK/forged_table/schema.json" || die "le jeu d'essai « table détournée » n'a pas été fabriqué"
must_refuse "table détournée" 'ne range pas ainsi' unsigned_import "$WORK/forged_table"
ok "table détournée refusée : c'est la cible qui classe ses tables"

echo "6 quinquies. Un écart avec la cible arrête l'import, sans rien laisser"
# Une exonération manque à la cible, et un navire y a changé de nom. L'import
# poserait la première avant de buter sur le second : rien ne doit rester.
psql "$DST_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
SET session_replication_role = replica;
DELETE FROM public.exemptions WHERE jurisdiction_id = 'aaaaaaaa-0000-4000-8000-00000000000a';
UPDATE public.vessels SET name = 'Navire renommé' WHERE id = 'aaaaaaaa-0000-4000-8000-000000000020';
SQL
must_refuse "ligne présente avec un autre contenu" 'contenu différent' import_into_dst "$WORK/export"
LEFT="$(psql "$DST_URL" -X -q -tA -c "SELECT count(*) FROM public.exemptions WHERE jurisdiction_id = 'aaaaaaaa-0000-4000-8000-00000000000a'")"
[ "$LEFT" = "0" ] || die "l'import refusé a laissé $LEFT ligne(s) derrière lui"
ok "écart de contenu signalé, et rien d'écrit"
psql "$DST_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
SET session_replication_role = replica;
UPDATE public.vessels SET name = 'Navire A, "le premier"' WHERE id = 'aaaaaaaa-0000-4000-8000-000000000020';
SQL
import_into_dst "$WORK/export" >/dev/null
fingerprint "$DST_URL" > "$WORK/dst3.fp"
diff "$WORK/dst.fp" "$WORK/dst3.fp" >/dev/null || die "après correction de l'écart, l'import n'a pas rétabli le contenu"
ok "écart corrigé : l'import complète ce qui manquait, à l'identique"

# Une contrainte de plus dans la cible : les colonnes sont les mêmes, pas ce que
# la table accepte.
psql "$DST_URL" -X -q -v ON_ERROR_STOP=1 -c 'ALTER TABLE public.vessels ADD CONSTRAINT rt_derive CHECK (gross_tonnage_dwt >= 0)'
must_refuse "contrainte en plus dans la cible" 'diffère.*vessels' import_into_dst "$WORK/export"
psql "$DST_URL" -X -q -v ON_ERROR_STOP=1 -c 'ALTER TABLE public.vessels DROP CONSTRAINT rt_derive'
ok "schéma qui diffère par une contrainte : import refusé, table nommée"

echo "6 sexies. Un export ne distribue pas de pouvoirs"
# Le compte existe dans la cible, son moyen de connexion non : l'export ne doit
# pas le lui greffer. C'est par là qu'un export forgé donnerait à un tiers la
# connexion d'une personne existante.
psql "$DST_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
SET session_replication_role = replica;
DELETE FROM auth.identities WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
SQL
import_into_dst "$WORK/export" >/dev/null 2>"$WORK/ident.err"
GRAFT="$(psql "$DST_URL" -X -q -tA -c "SELECT count(*) FROM auth.identities WHERE user_id = 'aaaaaaaa-0000-4000-8000-000000000001'")"
[ "$GRAFT" = "0" ] || die "l'import a ajouté un moyen de connexion à un compte déjà présent"
grep -q 'écartés' "$WORK/ident.err" || die "moyen de connexion écarté sans que l'import le dise"
ok "moyen de connexion non greffé sur un compte déjà présent, et signalé"

# Un profil d'administrateur général que la cible ne connaît pas.
cp -r "$WORK/export" "$WORK/forged_admin"
psql "$DST_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
SET session_replication_role = replica;
DELETE FROM public.profiles WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
SQL
sed -i 's/"role": "PORT_OFFICER"/"role": "SUPERADMIN"/' "$WORK/forged_admin/tenant/profiles.jsonl"
resum "$WORK/forged_admin" tenant/profiles.jsonl
grep -q 'SUPERADMIN' "$WORK/forged_admin/tenant/profiles.jsonl" || die "le jeu d'essai « administrateur général » n'a pas été fabriqué"
must_refuse "profil d'administrateur général" 'administrateur général' unsigned_import "$WORK/forged_admin"
ok "création d'un administrateur général refusée par défaut"

echo "7. Un export altéré est refusé"
printf 'x' >> "$WORK/export/tenant/vessels.jsonl"
TARGET_DB_URL="$DST_URL" CONFIRM_TARGET_DB=gg_rt_dst bash "$SCRIPT_DIR/tenant-import.sh" "$WORK/export" TSTA >/dev/null 2>&1 \
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
