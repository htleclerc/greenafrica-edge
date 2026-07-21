# Runbook — Validation en staging du durcissement RGPD (PR #98)

**Objet :** valider en **staging** la branche `fix/rgpd-hardening-p0` (migrations **099→106** + code) AVANT merge vers `develop`. Ces changements touchent l'**accès aux données** (RLS `profiles`/`audit_logs`), le **chiffrement IBAN** (gate + ACL Vault), la **minimisation IP** (triggers) et des **purges automatiques** — d'où une validation dédiée.

**Staging :** projet Supabase existant `dyjolepwxxsedwngkfox` (= env `develop`/staging), app Fly `africgreen`. `<STAGING_DB_URL>` = chaîne pooler du projet staging (secret `SUPABASE_DB_URL` de l'environnement GitHub `staging`).

**Principe :** on applique les migrations au **DB staging** depuis la branche, on valide (SQL + appli), **puis** on merge vers `develop` (le pipeline re-`push` les migrations — déjà appliquées → no-op idempotent). En cas de souci : rollback via les blocs `-- DOWN:` + `cron.unschedule`.

> ⚠️ Faire ceci sur **staging** uniquement. Ne jamais appliquer manuellement en prod hors pipeline.

---

## 0. Pré-vol

```bash
git fetch origin && git checkout fix/rgpd-hardening-p0 && git pull
# Sanity : les 8 migrations RGPD sont là
ls supabase/migrations/09[9]_* supabase/migrations/10[0-6]_*
```

Sauvegarde de sécurité (staging) : déclencher un backup/PITR du projet staging avant d'appliquer (dashboard Supabase → Database → Backups), pour pouvoir restaurer si besoin.

---

## 1. Appliquer les migrations au DB staging

```bash
supabase db push --db-url "<STAGING_DB_URL>" --yes
# attendu : applique 099→106, aucune erreur. (Ré-exécutable : les déjà-appliquées sont ignorées.)
```

Si une migration échoue → NE PAS merger ; lire l'erreur, corriger sur la branche, **re-push** (les migrations sont idempotentes : `db push` reprend là où il s'était arrêté).

> **Résolu (2026-07-21)** : le backfill de `100_audit_logs_jurisdiction_rls.sql` était bloqué par le trigger append-only `audit_logs_no_update` (`SQLSTATE 42501`). Corrigé (commit `cd56414`) : la migration désactive ce trigger précis le temps du backfill puis le rétablit. Après `git pull` de la branche, re-lancer `supabase db push` : 099 est déjà appliquée (ignorée), 100 passe désormais.

---

## 2. Validation SQL (psql sur `<STAGING_DB_URL>`)

### 2.1 RLS `profiles` / `collection_reminders` / `audit_logs` (migs 099/100/101)
```sql
-- policies présentes et scopées
select tablename, policyname from pg_policies
 where tablename in ('profiles','audit_logs','collection_reminders')
   and policyname in ('Admins can read all profiles','Users see relevant audit logs','staff manage collection reminders');

-- audit_logs a bien la colonne + index
select column_name from information_schema.columns
 where table_name='audit_logs' and column_name='jurisdiction_id';
```
Attendu : 3 policies listées ; colonne `jurisdiction_id` présente.

### 2.2 Minimisation IP au write (mig 102)
```sql
-- test sur une insertion d'audit (rollback ensuite)
begin;
insert into public.audit_logs(user_id, action, severity, entity_type, entity_id, ip_address)
 values (null, 'TRANSACTION_UPDATED', 'INFO', 'Test', 't', '203.0.113.77');
select ip_address from public.audit_logs where entity_type='Test';   -- attendu : 203.0.113.0/24
rollback;
```
Attendu : l'IP est tronquée (`…​.0/24`). Idem `profiles.ip_address` à l'`UPDATE`.

### 2.3 ACL des RPC Vault (mig 105) — le point sécurité
```sql
select has_function_privilege('authenticated','public.kyc_vault_retrieve(uuid)','EXECUTE') as auth_can_retrieve,
       has_function_privilege('authenticated','public.kyc_vault_delete(uuid)','EXECUTE')   as auth_can_delete,
       has_function_privilege('service_role','public.kyc_vault_retrieve(uuid)','EXECUTE')  as svc_can_retrieve;
```
Attendu : `auth_can_retrieve = f`, `auth_can_delete = f`, `svc_can_retrieve = t`.

### 2.4 Vault actif (prérequis du gate IBAN, mig… code)
```sql
select extname, extversion from pg_extension where extname in ('supabase_vault','pgsodium');
```
Attendu : `supabase_vault` présent → le gate `encryptIban` NE bloque pas l'onboarding.

### 2.5 Enum audit + consentement + marqueur anonymisation (migs 103/104/105)
```sql
select 'SHIPOWNER_ANONYMIZED'::public.audit_action;                 -- ne doit pas erreur
select column_name from information_schema.columns
 where table_name='shipowners'
   and column_name in ('anonymized_at','cgv_accepted_at','cgv_version','billing_proof_doc_url');
```
Attendu : cast OK ; 4 colonnes présentes.

### 2.6 Purges planifiées (mig 106)
```sql
select jobname, schedule, active from cron.job where jobname like 'rgpd-%';
-- Contrôle des VOLUMES avant la 1re suppression réelle (dimanche 03:00) :
select public.rgpd_purge_arrival_alerts(90, true)      as arrival_candidates;
select public.rgpd_purge_owner_notifications(90, true) as notif_candidates;
```
Attendu : 2 jobs `active=t`. **Regarder les compteurs candidates** — s'ils sont anormalement élevés, `select cron.unschedule('rgpd-purge-arrival-alerts');` (idem notifs) et rediscuter la durée avant de laisser tourner.

---

## 3. Validation applicative (frontend staging)

Déployer la branche en preview (Vercel preview du projet staging) OU merge→develop après §2. Puis, connecté :

| # | En tant que | Vérifier | Attendu |
|---|-------------|----------|---------|
| 3.1 | SUPERADMIN | `/admin/armateurs`, `/admin/airlines`, `/admin/invoices` chargent | pas de 500, listes OK (RLS non cassée) |
| 3.2 | PORT_OFFICER | `/admin/owner-agent-mappings` (dropdown owners), `/audit` | profils owners visibles, lecture d'audit OK (scoping n'a pas tout masqué) |
| 3.3 | Owner | `/owner/onboarding/billing` → soumettre KYC-C (Vault actif) | pas d'erreur « IBAN sans chiffrement fort » ; `cgv_accepted_at`/`cgv_version` posés |
| 3.4 | Owner | `/owner/profile` : IBAN affiché masqué ; **Exporter mes données** | JSON téléchargé, IBAN masqué, aucune autre donnée |
| 3.5 | SUPERADMIN | fiche armateur → carte « Zone RGPD » visible ; non-SUPERADMIN → **absente** | bouton gaté correctement |
| 3.6 | SUPERADMIN | (sur un **shipowner de test jetable**) anonymiser via le dialogue type-to-confirm | contact/bancaire nullés, `anonymized_at` posé, audit `SHIPOWNER_ANONYMIZED`, secret Vault supprimé |

### Vérif post-anonymisation (SQL, sur le shipowner de test)
```sql
select name, iban, official_email, anonymized_at from public.shipowners where id='<test-id>';
-- attendu : name conservé, iban null, official_email null, anonymized_at renseigné
select action, details_json->>'event' from public.audit_logs
 where entity_id='<test-id>' order by created_at desc limit 1;    -- SHIPOWNER_ANONYMIZED
```

---

## 4. Isolation cross-tenant (RLS) — note

En prod/staging **mono-juridiction** (tout Somaliland), le scoping juridiction est fonctionnellement transparent (chacun ne voit que « sa » juridiction = la seule). Le vrai test multi-tenant nécessite ≥2 juridictions avec un staff scopé sur l'une : à rejouer si/quand une 2ᵉ juridiction est activée (créer un staff Djibouti, vérifier qu'il ne voit pas les `profiles`/`audit_logs`/`collection_reminders` de Somaliland). Documenté ici pour ne pas l'oublier.

---

## 5. Go / No-Go → merge

**GO** si : migrations appliquées sans erreur (§1), tous les checks SQL §2 attendus, tous les checks appli §3 verts, volumes de purge §2.6 raisonnables.

```bash
# depuis la PR #98 : merge vers develop (le pipeline develop re-push les migrations = no-op)
gh pr merge 98 --squash   # ou via l'UI, selon la convention du repo
```

**NO-GO** → rollback staging (§6), corriger sur la branche, reprendre en §1.

---

## 6. Rollback staging (si nécessaire)

Chaque migration porte un bloc `-- DOWN:` (exécuter manuellement en sens inverse **106 → 099**). Points clés :

```sql
-- 106 : arrêter les purges
select cron.unschedule('rgpd-purge-arrival-alerts');
select cron.unschedule('rgpd-purge-owner-notifications');

-- 105 : rendre les RPC Vault de nouveau exécutables (si le gate d'accès pose problème)
--        (voir DOWN de 105 ; la valeur d'enum ajoutée ne se retire pas — inoffensif)

-- 102 : retirer les triggers de minimisation IP
drop trigger if exists minimize_ip_audit_logs on public.audit_logs;
drop trigger if exists minimize_ip_profiles on public.profiles;

-- 101/100/099 : restaurer les policies d'origine (voir les DOWN respectifs)
```
Sinon, restaurer le backup/PITR pris en §0.

> Note : les triggers de minimisation IP et les colonnes ajoutées sont **additifs et sans perte** ; le seul élément « actif » à surveiller est le **cron de purge** (§6, `unschedule`).

---

## Annexe — récap des 8 migrations

| Mig | Contenu | Risque runtime |
|-----|---------|----------------|
| 099 | RLS collection_reminders (juridiction) | accès staff |
| 100 | RLS audit_logs + col jurisdiction_id | lecture audit |
| 101 | RLS profiles (staff+owner) | visibilité profils |
| 102 | trigger minimisation IP + fonctions purge | écritures audit/profiles |
| 103 | shipowners.anonymized_at | — (additif) |
| 104 | shipowners.cgv_* (consentement) | — (additif) |
| 105 | enum SHIPOWNER_ANONYMIZED + kyc_vault_delete + **ACL Vault service_role** | chiffrement IBAN |
| 106 | **cron.schedule purges 90 j (suppression réelle)** | suppression données opérationnelles |
