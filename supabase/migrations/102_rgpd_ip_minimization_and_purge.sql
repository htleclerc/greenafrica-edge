-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 102 : minimisation IP au write (option 2a) + fonctions de purge RGPD
--
-- Suite audit RGPD 2026-07-21 (Art. 5(1)(c) minimisation, 5(1)(e) limitation de
-- conservation). Décisions PO : IP minimisée à l'écriture (option 2a) ; fonctions
-- de purge livrées DÉSACTIVÉES (aucun cron.schedule) + mode dry_run par défaut.
--
-- ── A. Minimisation IP au write (2a) ──
-- audit_logs.ip_address et profiles.ip_address sont de type INET. On zéro les bits
-- hôte (IPv4 → /24, IPv6 → /48) DÈS L'ÉCRITURE : l'IP complète n'est jamais
-- persistée. Idempotent (minimiser une IP déjà minimisée est un no-op).
-- ⚠️ audit_logs étant append-only (mig 018), ceci ne s'applique qu'aux NOUVELLES
-- lignes ; les IP déjà stockées ne peuvent être modifiées par l'application
-- (procédure DBA si besoin de purge rétroactive).
-- Le trigger est BEFORE INSERT (audit_logs) / BEFORE INSERT OR UPDATE (profiles) —
-- pas de conflit avec le trigger append-only (BEFORE UPDATE/DELETE) d'audit_logs.
--
-- ── B. Fonctions de purge (Art. 5(1)(e)) ──
-- Livrées DÉSACTIVÉES : aucune planification pg_cron. Chaque fonction est en
-- dry_run par défaut (retourne le nombre de lignes CANDIDATES sans supprimer) ;
-- passer p_dry_run=false pour supprimer réellement. Durées = valeurs proposées
-- (cf. docs/audits/2026-07-21-retention-policy.md), à VALIDER juridiquement avant
-- activation. collection_reminders volontairement EXCLU (pas de statut de clôture
-- de créance fiable → risque de purger des relances de dettes actives ; à cadrer).
-- ADDITIVE (fonctions + triggers, aucune donnée supprimée par la migration).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A. Minimisation IP ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.minimize_ip(ip inet)
RETURNS inet
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN ip IS NULL THEN NULL
        WHEN family(ip) = 4 THEN network(set_masklen(ip, 24))
        ELSE network(set_masklen(ip, 48))
    END;
$$;

CREATE OR REPLACE FUNCTION public.trg_minimize_ip()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.ip_address := public.minimize_ip(NEW.ip_address);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS minimize_ip_audit_logs ON public.audit_logs;
CREATE TRIGGER minimize_ip_audit_logs
    BEFORE INSERT ON public.audit_logs
    FOR EACH ROW EXECUTE FUNCTION public.trg_minimize_ip();

DROP TRIGGER IF EXISTS minimize_ip_profiles ON public.profiles;
CREATE TRIGGER minimize_ip_profiles
    BEFORE INSERT OR UPDATE OF ip_address ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.trg_minimize_ip();

-- ── B. Fonctions de purge (désactivées, dry_run par défaut) ───────────────────
-- SECURITY DEFINER : réservées à un appel DBA/service-role explicite. Retournent
-- le nombre de lignes candidates (dry_run) ou supprimées (p_dry_run=false).

-- arrival_alerts : données AIS/ADS-B opérationnelles — proposé 12 mois.
CREATE OR REPLACE FUNCTION public.rgpd_purge_arrival_alerts(
    p_days integer DEFAULT 365,
    p_dry_run boolean DEFAULT true
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE n bigint;
BEGIN
    IF p_dry_run THEN
        SELECT count(*) INTO n FROM public.arrival_alerts
          WHERE created_at < now() - make_interval(days => p_days);
    ELSE
        WITH d AS (
            DELETE FROM public.arrival_alerts
              WHERE created_at < now() - make_interval(days => p_days)
            RETURNING 1
        ) SELECT count(*) INTO n FROM d;
    END IF;
    RETURN n;
END;
$$;

-- owner_notifications : notifications transactionnelles — proposé 18 mois.
CREATE OR REPLACE FUNCTION public.rgpd_purge_owner_notifications(
    p_days integer DEFAULT 540,
    p_dry_run boolean DEFAULT true
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE n bigint;
BEGIN
    IF p_dry_run THEN
        SELECT count(*) INTO n FROM public.owner_notifications
          WHERE created_at < now() - make_interval(days => p_days);
    ELSE
        WITH d AS (
            DELETE FROM public.owner_notifications
              WHERE created_at < now() - make_interval(days => p_days)
            RETURNING 1
        ) SELECT count(*) INTO n FROM d;
    END IF;
    RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.rgpd_purge_arrival_alerts(integer, boolean) FROM public, authenticated, anon;
REVOKE ALL ON FUNCTION public.rgpd_purge_owner_notifications(integer, boolean) FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.rgpd_purge_arrival_alerts(integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.rgpd_purge_owner_notifications(integer, boolean) TO service_role;

-- collection_reminders : NON purgé ici (nécessite une définition fiable de
-- « créance close » — sinon risque de supprimer des relances de dettes actives).
-- À implémenter après cadrage métier (jointure transactions.status/settlement).

-- Aucune planification : activer via cron.schedule() SEULEMENT après validation
-- juridique des durées, et de préférence en p_dry_run=true d'abord.

-- DOWN:
-- DROP TRIGGER IF EXISTS minimize_ip_audit_logs ON public.audit_logs;
-- DROP TRIGGER IF EXISTS minimize_ip_profiles ON public.profiles;
-- DROP FUNCTION IF EXISTS public.trg_minimize_ip();
-- DROP FUNCTION IF EXISTS public.minimize_ip(inet);
-- DROP FUNCTION IF EXISTS public.rgpd_purge_arrival_alerts(integer, boolean);
-- DROP FUNCTION IF EXISTS public.rgpd_purge_owner_notifications(integer, boolean);
