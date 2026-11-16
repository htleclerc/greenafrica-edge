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
#   EXPORT_VERIFY_KEY=<clé publique de l'émetteur> \
#     ./scripts/backup/tenant-import.sh <dossier d'export> <code du pays attendu>
#
#   ALLOW_GENERAL_ADMIN_IMPORT=1  accepte qu'un export crée un profil
#     d'administrateur général. Refusé par défaut : ce rôle ouvre tous les pays.
#
# Le dossier reçu n'est jamais utilisé tel quel : le script en prend une copie
# privée et travaille dessus. Un lien ou un fichier spécial fait refuser l'export.
#
# Un export n'est pas cru sur parole. Avant d'écrire quoi que ce soit :
#   1. la signature du manifeste est vérifiée avec EXPORT_VERIFY_KEY ;
#   2. l'empreinte de chaque fichier est recalculée ;
#   3. les tables visées sont confrontées au classement de CETTE base
#      (tenant-tables.conf et colonne jurisdiction_id) : l'export ne décide pas
#      où il écrit ;
#   4. le schéma de la cible est comparé à celui de l'export, clés et
#      contraintes comprises, table par table ;
#   5. chaque ligne est lue dans une zone d'attente, comptée, puis confrontée
#      au pays annoncé : une ligne d'un autre pays fait refuser l'export.
#
# Puis les lignes sont posées, et relues une à une dans la cible. Tout cela dans
# UNE transaction, vérification comprise : au moindre écart rien n'est écrit.
#
# Rejouable : une ligne déjà présente et identique est laissée telle quelle.
# Une ligne déjà présente avec un contenu DIFFÉRENT arrête l'import — l'export
# et la cible ne disent pas la même chose, et ce n'est pas au script de choisir.
# Seule exception, les comptes : un compte déjà présent est conservé tel qu'il
# est (il vit : dernière connexion, mot de passe changé), et le script le dit.
# Un export ne peut pas non plus ajouter un moyen de connexion à un compte qui
# existait avant lui : ces lignes sont écartées, et comptées.
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/backup/tenant-common.sh
source "$SCRIPT_DIR/tenant-common.sh"
CONF="$SCRIPT_DIR/tenant-tables.conf"
FP_SQL="$SCRIPT_DIR/tenant-fingerprint.sql"

[ -n "${TARGET_DB_URL:-}" ] || die "TARGET_DB_URL n'est pas renseignée."
SRC="${1:-}"
[ -n "$SRC" ] && [ -d "$SRC" ] || die "dossier d'export attendu en argument."
# Le pays attendu se dit à la main : l'export ne choisit pas pour l'opérateur.
EXPECT_CODE="${2:-}"
[[ "$EXPECT_CODE" =~ ^[A-Za-z0-9_]{2,16}$ ]] \
  || die "code du pays attendu en second argument (celui que l'export doit porter)."
[ -f "$SRC/manifest.json" ] || die "manifest.json absent : ce dossier n'est pas un export complet."
[ -f "$CONF" ] || die "classement des tables introuvable : $CONF"
[ -f "$FP_SQL" ] || die "calcul de l'empreinte introuvable : $FP_SQL"
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
FINGERPRINT="$(grep -oE '"schema_fingerprint": "[0-9a-f]{64}"' manifest.json | grep -oE '[0-9a-f]{64}' || true)"
[ -n "$JID" ] || die "identifiant du pays introuvable dans le manifeste."
[ -n "$FINGERPRINT" ] || die "empreinte du schéma introuvable dans le manifeste."

# Intégrité des fichiers, avant toute écriture.
check_export_files _expected.tsv

# Le classement des tables vient de CE dépôt, jamais de l'export.
grep -vE '^[[:space:]]*(#|$)' "$CONF" > _conf.psv
cp "$FP_SQL" _fingerprint.sql

# Le compte doit pouvoir suspendre les contrôles le temps du chargement.
"${PSQL[@]}" -c 'BEGIN; SET LOCAL session_replication_role = replica; ROLLBACK;' >/dev/null 2>&1 \
  || die "ce compte ne peut pas suspendre les contrôles de clés étrangères (session_replication_role). Utiliser le compte postgres chez Supabase, ou un superutilisateur sur un PostgreSQL auto-hébergé."

"${PSQL[@]}" -v jid="$JID" -v fingerprint="$FINGERPRINT" -v code="$EXPECT_CODE" \
  -v allow_ga="${ALLOW_GENERAL_ADMIN_IMPORT:-0}" <<'SQL'
\pset tuples_only on
\pset format unaligned
\pset fieldsep '\t'

-- Une seule transaction, du premier contrôle à la dernière vérification.
BEGIN;
\i _fingerprint.sql

-- La description des tables tient sur une ligne : on la lit comme un champ brut.
CREATE TEMP TABLE _schema (doc jsonb);
\copy _schema FROM 'schema.json' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
CREATE TEMP TABLE _tables AS
SELECT t ->> 'file' AS file, t ->> 'section' AS section, t ->> 'schema' AS sch,
       t ->> 'table' AS tbl, t -> 'columns' AS columns, t -> 'foreign_keys' AS fks,
       t ->> 'fingerprint' AS fp,
       -- Zone d'attente de la table : les lignes y sont lues et contrôlées
       -- avant de toucher la vraie table.
       CASE WHEN t ->> 'section' = 'accounts' THEN '_a_' ELSE '_s_' END || (t ->> 'table') AS stg
  FROM _schema, jsonb_array_elements(doc -> 'tables') AS t;

CREATE TEMP TABLE _expected (path text, n bigint);
\copy _expected FROM '_expected.tsv' WITH (FORMAT text)
CREATE TEMP TABLE _conf (tbl text PRIMARY KEY, class text NOT NULL, predicate text);
\copy _conf FROM '_conf.psv' WITH (FORMAT csv, DELIMITER '|')
CREATE TEMP TABLE _l (doc jsonb);
CREATE TEMP TABLE _exp_people (id uuid PRIMARY KEY);
CREATE TEMP TABLE _report (
  file text PRIMARY KEY, section text NOT NULL, staged bigint NOT NULL,
  inserted bigint NOT NULL DEFAULT 0,  -- lignes posées par cet import
  present  bigint NOT NULL DEFAULT 0,  -- lignes déjà là avant lui
  kept     bigint NOT NULL DEFAULT 0,  -- comptes déjà là, différents, conservés
  extra    bigint NOT NULL DEFAULT 0   -- lignes du pays dans la cible, absentes de l'export
);
SELECT set_config('import.jid', :'jid', false) AS _jid,
       set_config('import.fingerprint', :'fingerprint', false) AS _fp,
       set_config('import.code', :'code', false) AS _code,
       set_config('import.allow_general_admin', :'allow_ga', false) AS _ga \gset

-- ── 1. Forme de schema.json ──────────────────────────────────────────────────
-- Les noms qu'il porte servent à écrire le script de chargement ; un nom forgé
-- (saut de ligne, guillemet, chemin) y glisserait des commandes. Tout ce qui
-- n'a pas la forme attendue, ou n'a pas été vérifié par son empreinte, fait
-- refuser l'export.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM _tables t
     WHERE t.file IS NULL OR t.tbl IS NULL OR t.sch IS NULL OR t.section IS NULL
        OR t.file !~ '^(tenant|accounts|globals)/[a-z0-9_]+\.jsonl$'
        OR t.tbl !~ '^[a-z0-9_]{1,55}$'
        OR t.file <> t.section || '/' || t.tbl || '.jsonl'
        OR t.sch <> CASE WHEN t.section = 'accounts' THEN 'auth' ELSE 'public' END
        OR (t.section <> 'accounts' AND coalesce(t.fp, '') !~ '^[0-9a-f]{64}$')
        OR NOT EXISTS (SELECT 1 FROM _expected e WHERE e.path = t.file)
        OR jsonb_typeof(t.columns) IS DISTINCT FROM 'array'
        OR jsonb_typeof(t.fks) IS DISTINCT FROM 'array'
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(t.columns) = 'array' THEN t.columns ELSE '[]'::jsonb END) c
                    WHERE coalesce(c ->> 'name', '') !~ '^[a-z0-9_]+$')
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(t.fks) = 'array' THEN t.fks ELSE '[]'::jsonb END) k
                    WHERE jsonb_typeof(k -> 'columns') IS DISTINCT FROM 'array'
                       OR coalesce(k -> 'columns' ->> 0, '') !~ '^[a-z0-9_]+$'
                       OR NOT t.columns @> jsonb_build_array(jsonb_build_object('name', k -> 'columns' ->> 0)))
  ) OR (SELECT count(*) FROM _tables) <> (SELECT count(DISTINCT file) FROM _tables)
  THEN
    RAISE EXCEPTION 'schema.json : nom de fichier, de table ou de colonne inattendu, table en double, ou fichier absent du manifeste — export refusé.';
  END IF;
END $$;

-- ── 2. La cible peut-elle recevoir cet export ? ──────────────────────────────
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(format('%s.%s', sch, tbl), ', ' ORDER BY sch, tbl) INTO v_bad
    FROM _tables
   WHERE section <> 'accounts' AND to_regclass(format('%I.%I', sch, tbl)) IS NULL;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'table(s) absente(s) de la base cible : %. Créer d''abord le schéma de la plateforme, ou charger l''export avec tenant-load-plain.sh.', v_bad;
  END IF;

  -- L'export ne choisit pas ses tables. Une table n'est acceptée que là où le
  -- classement de cette base la range : les comptes, les référentiels communs,
  -- et les données d'un pays (colonne jurisdiction_id, ou filtre écrit dans
  -- tenant-tables.conf). Sans cela, un export forgé écrirait où il veut.
  SELECT string_agg(t.file, ', ' ORDER BY t.file) INTO v_bad
    FROM _tables t
   WHERE NOT CASE t.section
               WHEN 'accounts' THEN t.tbl IN ('users', 'identities')
               WHEN 'globals'  THEN EXISTS (SELECT 1 FROM _conf f WHERE f.tbl = t.tbl AND f.class = 'GLOBAL')
               ELSE EXISTS (SELECT 1 FROM _conf f WHERE f.tbl = t.tbl AND f.class = 'DERIVED')
                    OR (NOT EXISTS (SELECT 1 FROM _conf f WHERE f.tbl = t.tbl)
                        AND EXISTS (SELECT 1 FROM pg_attribute a
                                     WHERE a.attrelid = format('%I.%I', t.sch, t.tbl)::regclass
                                       AND a.attname = 'jurisdiction_id' AND NOT a.attisdropped))
             END;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'l''export vise des tables que cette base ne range pas ainsi : % — export refusé.', v_bad;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM _tables WHERE file = 'tenant/jurisdictions.jsonl') THEN
    RAISE EXCEPTION 'l''export ne porte pas la fiche du pays (tenant/jurisdictions.jsonl) — export refusé.';
  END IF;

  -- Table par table : colonnes, clés et contraintes doivent être les mêmes.
  SELECT string_agg(t.tbl, ', ' ORDER BY t.tbl) INTO v_bad
    FROM _tables t
   WHERE t.section <> 'accounts'
     AND pg_temp.table_fingerprint(format('%I.%I', t.sch, t.tbl)::regclass) IS DISTINCT FROM t.fp;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'le schéma de la cible diffère de celui de l''export (colonnes, clés ou contraintes) pour : %. Aligner ces tables avant d''importer.', v_bad;
  END IF;
  IF pg_temp.schema_fingerprint((SELECT array_agg(format('%I.%I', sch, tbl)::regclass)
                                   FROM _tables WHERE section <> 'accounts'))
     IS DISTINCT FROM current_setting('import.fingerprint') THEN
    RAISE EXCEPTION 'l''empreinte du schéma inscrite au manifeste ne correspond pas aux tables décrites par schema.json — export refusé.';
  END IF;

  -- Comptes : hors empreinte (leur forme appartient au service
  -- d'authentification), mais chaque colonne doit exister dans la cible.
  SELECT string_agg(format('%s.%s.%s', t.sch, t.tbl, c ->> 'name'), ', ') INTO v_bad
    FROM _tables t, jsonb_array_elements(t.columns) c
   WHERE to_regclass(format('%I.%I', t.sch, t.tbl)) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = format('%I.%I', t.sch, t.tbl)::regclass
                        AND a.attname = c ->> 'name'
                        AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity <> 'a');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'colonne(s) de l''export absente(s) de la cible : %', v_bad;
  END IF;

  -- Et l'inverse, pour les tables de la plateforme : un export qui tairait une
  -- colonne la laisserait à sa valeur par défaut, hors de toute relecture.
  SELECT string_agg(format('%s.%s', t.tbl, a.attname), ', ') INTO v_bad
    FROM _tables t
    JOIN pg_attribute a ON a.attrelid = format('%I.%I', t.sch, t.tbl)::regclass
                       AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity <> 'a'
   WHERE t.section <> 'accounts'
     AND NOT t.columns @> jsonb_build_array(jsonb_build_object('name', a.attname));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'colonne(s) de la cible que l''export ne décrit pas : % — export refusé.', v_bad;
  END IF;

  -- Sans clé primaire, impossible de dire si une ligne est déjà là.
  SELECT string_agg(format('%s.%s', t.sch, t.tbl), ', ') INTO v_bad
    FROM _tables t
   WHERE to_regclass(format('%I.%I', t.sch, t.tbl)) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_index i
        WHERE i.indrelid = format('%I.%I', t.sch, t.tbl)::regclass AND i.indisprimary
          AND NOT EXISTS (
            SELECT 1 FROM unnest(i.indkey::int2[]) AS k(attnum)
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
             WHERE NOT t.columns @> jsonb_build_array(jsonb_build_object('name', a.attname))));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'table(s) sans clé primaire, ou dont la clé n''est pas dans l''export : %', v_bad;
  END IF;
END $$;

-- ── 3. Lecture de chaque fichier dans sa zone d'attente ──────────────────────
-- Chaque ligne du fichier est un objet JSON, réparti dans les colonnes de la
-- table. Dans une colonne de type JSON, un champ présent et valant null est la
-- valeur JSON null ; un champ absent, l'absence de valeur.
CREATE FUNCTION pg_temp.stage(p_file text) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  v_t record;
  v_cols text[];
  v_select text;
  v_stray text;
  v_rows bigint;
BEGIN
  SELECT * INTO STRICT v_t FROM _tables WHERE file = p_file;
  SELECT array_agg(c ->> 'name' ORDER BY ord) INTO v_cols
    FROM jsonb_array_elements(v_t.columns) WITH ORDINALITY AS x(c, ord);

  IF EXISTS (SELECT 1 FROM _l WHERE jsonb_typeof(doc) IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION '% : ligne qui n''est pas un objet JSON — export refusé.', p_file;
  END IF;
  SELECT k INTO v_stray FROM _l, jsonb_object_keys(doc) AS k WHERE k <> ALL (v_cols) LIMIT 1;
  IF v_stray IS NOT NULL THEN
    RAISE EXCEPTION '% : champ « % » absent de schema.json — export refusé.', p_file, left(v_stray, 40);
  END IF;

  SELECT string_agg(
           CASE WHEN a.atttypid IN ('json'::regtype, 'jsonb'::regtype)
                THEN format('CASE WHEN l.doc -> %L = ''null''::jsonb THEN ''null''::%s ELSE r.%I END AS %I',
                            a.attname, a.atttypid::regtype, a.attname, a.attname)
                ELSE format('r.%I', a.attname) END,
           ', ' ORDER BY x.ord) INTO v_select
    FROM unnest(v_cols) WITH ORDINALITY AS x(name, ord)
    JOIN pg_attribute a ON a.attrelid = format('%I.%I', v_t.sch, v_t.tbl)::regclass
                       AND a.attname = x.name AND a.attnum > 0 AND NOT a.attisdropped;

  EXECUTE format('CREATE TEMP TABLE %I AS SELECT %s FROM _l l, jsonb_populate_record(NULL::%I.%I, l.doc) AS r',
                 v_t.stg, v_select, v_t.sch, v_t.tbl);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  INSERT INTO _report (file, section, staged) VALUES (p_file, v_t.section, v_rows);
END $fn$;

\o _gen_stage.sql
SELECT format(
  E'TRUNCATE _l;\n\\copy _l FROM %L WITH (FORMAT csv, QUOTE E''\\x01'', DELIMITER E''\\x02'')\nSELECT pg_temp.stage(%L) AS _staged \\gset',
  t.file, t.file)
  FROM _tables t
 WHERE t.section <> 'accounts' OR to_regclass(format('%I.%I', t.sch, t.tbl)) IS NOT NULL
 ORDER BY t.file;
\o
\i _gen_stage.sql

-- ── 4. Les lignes lues sont-elles celles annoncées, et celles du pays ? ──────
DO $$
DECLARE
  v_jid text := current_setting('import.jid');
  v_bad text;
  v_t record;
  v_pred text;
  v_n bigint;
BEGIN
  SELECT string_agg(format('%s (annoncé %s, lu %s)', r.file, e.n, r.staged), ', ' ORDER BY r.file) INTO v_bad
    FROM _report r JOIN _expected e ON e.path = r.file
   WHERE e.n <> r.staged;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'nombre de lignes différent de celui du manifeste : % — export refusé.', v_bad;
  END IF;

  -- Tables qui portent leur pays : chaque ligne doit être du pays annoncé.
  FOR v_t IN
    SELECT t.* FROM _tables t JOIN _report r USING (file)
     WHERE t.section = 'tenant' AND NOT EXISTS (SELECT 1 FROM _conf f WHERE f.tbl = t.tbl)
     ORDER BY t.file
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE jurisdiction_id IS DISTINCT FROM %L::uuid', v_t.stg, v_jid) INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION '% : % ligne(s) n''appartiennent pas au pays annoncé (%) — export refusé.', v_t.file, v_n, v_jid;
    END IF;
  END LOOP;

  -- Personnes citées par ces lignes : les seules dont l'export peut apporter
  -- le profil et le compte. Même règle qu'à l'export.
  FOR v_t IN
    SELECT t.stg, k -> 'columns' ->> 0 AS col
      FROM _tables t JOIN _report r USING (file), jsonb_array_elements(t.fks) AS k
     WHERE t.section = 'tenant' AND NOT EXISTS (SELECT 1 FROM _conf f WHERE f.tbl = t.tbl)
       AND k ->> 'references' IN ('public.profiles', 'auth.users')
  LOOP
    EXECUTE format('INSERT INTO _exp_people SELECT DISTINCT %I FROM %I WHERE %I IS NOT NULL ON CONFLICT DO NOTHING',
                   v_t.col, v_t.stg, v_t.col);
  END LOOP;

  -- Données d'un pays sans la colonne, et comptes : le filtre qui a servi à
  -- l'export est rejoué sur les lignes lues. Il vient du classement de cette
  -- base, pas de l'export.
  FOR v_t IN
    SELECT t.*, f.predicate
      FROM _tables t JOIN _report r USING (file) LEFT JOIN _conf f ON f.tbl = t.tbl AND t.section = 'tenant'
     WHERE t.section = 'accounts' OR f.class = 'DERIVED'
     ORDER BY t.file
  LOOP
    v_pred := CASE
                WHEN v_t.section = 'accounts' AND v_t.tbl = 'users' THEN 'id IN (SELECT id FROM _exp_people)'
                WHEN v_t.section = 'accounts' THEN 'user_id IN (SELECT id FROM _exp_people)'
                ELSE regexp_replace(replace(v_t.predicate, ':jid', quote_literal(v_jid)),
                                    '\mpublic\.([a-z0-9_]+)', '_s_\1', 'g')
              END;
    BEGIN
      EXECUTE format('SELECT count(*) FROM %I WHERE (%s) IS NOT TRUE', v_t.stg, v_pred) INTO v_n;
    EXCEPTION WHEN undefined_table THEN
      RAISE EXCEPTION '% : son appartenance au pays se lit dans une table que l''export ne porte pas — export refusé.', v_t.file;
    END;
    IF v_n > 0 THEN
      RAISE EXCEPTION '% : % ligne(s) n''appartiennent pas au pays annoncé (%) — export refusé.', v_t.file, v_n, v_jid;
    END IF;
  END LOOP;

  IF (SELECT staged FROM _report WHERE file = 'tenant/jurisdictions.jsonl') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'l''export doit porter la fiche du pays annoncé, et elle seule — export refusé.';
  END IF;

  -- Le pays porté par l'export doit être celui que l'opérateur attend.
  EXECUTE 'SELECT count(*) FROM _s_jurisdictions WHERE upper(code) = upper($1)'
    INTO v_n USING current_setting('import.code');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'l''export porte un autre pays que celui attendu (%) — export refusé.', current_setting('import.code');
  END IF;

  -- ── Comptes : un export ne distribue pas de pouvoirs ───────────────────────
  -- Un profil d'administrateur général ouvre tous les pays : un export n'en
  -- crée pas, sauf demande explicite de l'opérateur.
  IF to_regclass('_s_profiles') IS NOT NULL AND current_setting('import.allow_general_admin') <> '1' THEN
    EXECUTE $q$SELECT count(*) FROM _s_profiles s
                WHERE s.role::text = 'SUPERADMIN'
                  AND NOT EXISTS (SELECT 1 FROM public.profiles d WHERE d.id = s.id)$q$ INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'l''export créerait % profil(s) d''administrateur général. Refusé ; pour l''accepter en connaissance de cause, relancer avec ALLOW_GENERAL_ADMIN_IMPORT=1.', v_n;
    END IF;
  END IF;
  IF to_regclass('_a_users') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('_a_users') AND attname = 'is_super_admin') THEN
    EXECUTE 'SELECT count(*) FROM _a_users WHERE is_super_admin IS TRUE' INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'accounts/users.jsonl : % compte(s) marqués super-administrateur du service d''authentification — export refusé.', v_n;
    END IF;
  END IF;
  -- Un moyen de connexion n'arrive qu'avec son compte. S'il vise un compte que
  -- la cible portait déjà, il est écarté : sinon un export donnerait à un tiers
  -- la connexion d'une personne existante.
  IF to_regclass('_a_identities') IS NOT NULL THEN
    IF to_regclass('_a_users') IS NULL THEN
      RAISE EXCEPTION 'accounts/identities.jsonl sans accounts/users.jsonl — export refusé.';
    END IF;
    EXECUTE 'SELECT count(*) FROM _a_identities s WHERE NOT EXISTS (SELECT 1 FROM _a_users u WHERE u.id = s.user_id)' INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'accounts/identities.jsonl : % moyen(s) de connexion pour un compte que l''export ne porte pas — export refusé.', v_n;
    END IF;
    EXECUTE $q$DELETE FROM _a_identities s
                WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.user_id)
                  AND NOT EXISTS (SELECT 1 FROM auth.identities d WHERE d.id = s.id)$q$;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE _report SET kept = v_n WHERE file = 'accounts/identities.jsonl';
  END IF;
END $$;

-- ── 5. Écriture, puis relecture ligne à ligne — toujours avant de valider ────
SET LOCAL session_replication_role = replica;
DO $$
DECLARE
  v_jid text := current_setting('import.jid');
  v_t record;
  v_target text;
  v_cols text;
  v_dcontent text;
  v_key text;
  v_present bigint;
  v_differing bigint;
  v_inserted bigint;
  v_missing bigint;
  v_extra bigint;
BEGIN
  FOR v_t IN
    SELECT t.*, r.staged,
           (t.section = 'tenant' AND NOT EXISTS (SELECT 1 FROM _conf f WHERE f.tbl = t.tbl)) AS has_country
      FROM _tables t JOIN _report r USING (file)
     ORDER BY t.file
  LOOP
    v_target := format('%I.%I', v_t.sch, v_t.tbl);
    SELECT string_agg(quote_ident(c ->> 'name'), ', ' ORDER BY ord),
           format('(SELECT to_jsonb(x) FROM (SELECT %s) AS x)',
                  string_agg('d.' || quote_ident(c ->> 'name'), ', ' ORDER BY ord))
      INTO v_cols, v_dcontent
      FROM jsonb_array_elements(v_t.columns) WITH ORDINALITY AS x(c, ord);
    SELECT string_agg(format('d.%1$I = s.%1$I', a.attname), ' AND ') INTO v_key
      FROM pg_index i
      CROSS JOIN LATERAL unnest(i.indkey::int2[]) AS k(attnum)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
     WHERE i.indrelid = v_target::regclass AND i.indisprimary;

    -- Ce qui est déjà là. Identique : rien à faire. Différent : on s'arrête,
    -- sauf pour un compte, conservé tel qu'il est.
    EXECUTE format('SELECT count(*), count(*) FILTER (WHERE %s IS DISTINCT FROM to_jsonb(s)) FROM %I s JOIN %s d ON %s',
                   v_dcontent, v_t.stg, v_target, v_key)
      INTO v_present, v_differing;
    IF v_differing > 0 AND v_t.section <> 'accounts' THEN
      RAISE EXCEPTION '% : % ligne(s) existent déjà dans la cible avec un contenu différent de celui de l''export. Rien n''a été écrit.',
        v_t.file, v_differing;
    END IF;

    -- Pas de « ON CONFLICT » : une autre contrainte d'unicité qui refuse une
    -- ligne doit arrêter l'import, pas la faire disparaître en silence.
    EXECUTE format('INSERT INTO %s (%s) SELECT %s FROM %I s WHERE NOT EXISTS (SELECT 1 FROM %s d WHERE %s)',
                   v_target, v_cols, v_cols, v_t.stg, v_target, v_key);
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    -- Relecture : chaque ligne de l'export doit se retrouver dans la cible,
    -- valeur pour valeur (pour un compte conservé : au moins sa clé).
    EXECUTE format('SELECT count(*) FROM %I s WHERE NOT EXISTS (SELECT 1 FROM %s d WHERE %s AND (%s OR %s IS NOT DISTINCT FROM to_jsonb(s)))',
                   v_t.stg, v_target, v_key,
                   CASE WHEN v_t.section = 'accounts' THEN 'true' ELSE 'false' END, v_dcontent)
      INTO v_missing;
    IF v_missing > 0 THEN
      RAISE EXCEPTION '% : % ligne(s) de l''export ne se retrouvent pas à l''identique dans la cible. Rien n''a été écrit.',
        v_t.file, v_missing;
    END IF;

    -- Lignes du pays que la cible porte et que l'export ne connaît pas.
    v_extra := 0;
    IF v_t.has_country THEN
      EXECUTE format('SELECT count(*) FROM %s d WHERE d.jurisdiction_id = %L::uuid', v_target, v_jid) INTO v_extra;
      v_extra := v_extra - v_t.staged;
    END IF;

    UPDATE _report SET inserted = v_inserted, present = v_present, kept = kept + v_differing, extra = v_extra
     WHERE file = v_t.file;
  END LOOP;
END $$;

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

\o _imported.tsv
SELECT file, section, staged, inserted, present, kept, extra FROM _report ORDER BY file;
\o
COMMIT;
SQL

# Compte rendu. Tout a déjà été vérifié dans la transaction : ici on ne fait que dire.
sum_col() { awk -F'\t' -v c="$1" '{ gsub(/\r/, "", $c); s += $c } END { print s + 0 }' _imported.tsv; }
TABLES="$(wc -l < _imported.tsv | tr -d ' ')"
echo "Import terminé dans « $TARGET_DB » : $(sum_col 4) ligne(s) posée(s), $(sum_col 5) déjà présente(s), sur $TABLES table(s). Chaque ligne a été relue dans la cible avant validation."
KEPT="$(sum_col 6)"
if [ "$KEPT" != "0" ]; then
  echo "ATTENTION : $KEPT ligne(s) de comptes non reprises : comptes déjà présents avec un autre contenu (conservés tels quels), ou moyens de connexion visant un compte déjà présent (écartés)." >&2
fi
EXTRA="$(awk -F'\t' '{ gsub(/\r/, "", $7) } $7 + 0 > 0 { printf "%s%s (%s)", sep, $1, $7; sep = ", " }' _imported.tsv)"
if [ -n "$EXTRA" ]; then
  echo "ATTENTION : la cible porte pour ce pays des lignes que l'export ne connaît pas : $EXTRA." >&2
fi
if [ "$("${PSQL[@]}" -tA -c "SELECT to_regclass('auth.users') IS NOT NULL" | tr -d '\r')" != "t" ]; then
  echo "Comptes NON chargés : la cible n'a pas de tables d'authentification. Ils restent dans accounts/, à reprendre dans le système d'identité de la cible."
fi
echo "Reste à faire à la main : les fichiers du stockage, qui ne font pas partie de l'export."
