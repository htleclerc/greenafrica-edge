# Politique de rétention des données — Green-Gate

**Date :** 2026-07-21
**Statut :** PROPOSITION — durées à valider juridiquement avant activation de tout purge automatique
**Cadre :** RGPD Art. 5(1)(e) « limitation de la conservation » (référentiel cible — cf. [audit RGPD](./2026-07-21-rgpd-compliance-audit.md), applicabilité UE nuancée). Les durées ci-dessous sont des **valeurs proposées** ; elles doivent être arbitrées avec le DPO / conseil juridique (droit somalien/djiboutien + obligations fiscales/comptables) avant toute suppression effective.

## Principes

1. **Minimisation** : ne conserver chaque catégorie que le temps nécessaire à sa finalité.
2. **Conservation légale prioritaire** : les données fiscales/comptables (factures, paiements, transactions de taxe) sont conservées pour la durée légale, même si cela dépasse la « finalité produit ».
3. **Immuabilité vs effacement** : deux mécanismes sont **techniquement bloqués** en l'état et nécessitent une procédure DBA dédiée (pas de purge applicative) :
   - `transactions` : immuables (mig 089).
   - `audit_logs` : append-only anti-altération (mig 018 — UPDATE/DELETE bloqués par trigger).
   Pour ces deux tables, la « purge » = opération DBA ponctuelle hors application (drop de partitions anciennes, ou export→archive→suppression sous contrôle), pas un cron.
4. **Anonymisation > suppression** quand la donnée agrégée reste utile (ex. pseudonymiser l'IP plutôt que supprimer une ligne d'audit).

## Schéma de rétention (proposé)

| Catégorie / table | Contenu PII | Durée proposée | Base / justification | Mécanisme | Contrainte |
|---|---|---|---|---|---|
| **Factures / reçus** (`transactions` doc, `documents` bucket, `payments`) | Nom, montants | **10 ans** après émission | Obligation comptable/fiscale | Aucune purge auto (conservation légale) | `transactions` immuables |
| **`transactions` (taxe)** | vessel/flight, montants | **10 ans** | Fiscal | DBA (drop partitions > durée) | Immuables (mig 089) |
| **KYC identité (`shipowners` : name, address, imo/aoc, proof docs)** | Fort | **Durée relation + 5 ans** | Contractuel + anti-fraude | Anonymisation champs non-fiscaux à l'effacement (cf. Art. 17) | — |
| **KYC bancaire (`shipowners.iban` chiffré, swift, bank, `billing_proof`)** | Fort (bancaire) | **Durée relation + 1 an** après dernier paiement | Nécessité paiement/remboursement | Effacement de l'IBAN (Vault) + purge du proof storage | IBAN chiffré (Vault) |
| **`collection_reminders`** (relances) | Emails, montants dus | **3 ans** après clôture de la créance | Preuve de recouvrement / prescription | Purge auto possible (cron) une fois la créance close | Lié à transaction (immuable) mais la relance elle-même est purgeable |
| **`audit_logs`** | user, IP, action | **Journal : 3 ans** ; **`ip_address` : 90 jours** | Accountability (Art. 5(2)) / sécurité | IP : anonymisation ; journal : DBA (append-only) | Append-only → pas d'UPDATE/DELETE applicatif |
| **`profiles`** (staff & owners : email, full_name, ip_address) | Fort | Staff : durée emploi + 1 an ; Owner : = KYC identité | Gestion des accès | Anonymisation à l'effacement | — |
| **`arrival_alerts` / données AIS-ADSB** | Faible (navire/aéronef) | **12 mois** | Opérationnel | Purge auto (cron) | — |
| **Notifications (`owner_notifications`)** | Contenu transactionnel | **18 mois** | Opérationnel | Purge auto (cron) | — |
| **Sessions / rate-limit / tokens éphémères** | IP, user | **≤ 30 jours** | Sécurité | Purge auto (cron) | — |

## Mécanisme technique (à activer APRÈS validation des durées)

Trois classes de traitement :

1. **Purge auto (cron)** — catégories clairement purgeables (`collection_reminders` closes, `arrival_alerts`, notifications, éphémères). À implémenter comme fonctions SQL `SECURITY DEFINER` + `pg_cron`, **livrées désactivées** (pas de `cron.schedule` tant que les durées ne sont pas validées). Chaque fonction supporte un mode `dry_run` (compte les lignes candidates sans supprimer).
2. **Anonymisation `audit_logs.ip_address`** — l'append-only interdit un UPDATE. Deux options à trancher :
   - (a) **Minimisation au write** : ne plus stocker l'IP complète (tronquer IPv4 à /24, ou hasher) dès l'écriture — perte de forensique fine, mais conforme minimisation. *Changement de code, pas de purge rétroactive.*
   - (b) **Colonne anonymisable hors append-only** : sortir `ip_address` de la table append-only vers une table satellite purgeable. Plus lourd.
   → **Recommandation : (a) au write**, + accepter la conservation du journal (sans IP) 3 ans.
3. **Procédure DBA** (documentée, non automatisée) pour `transactions`/`audit_logs` : export→archive chiffré→drop partitions anciennes, sous contrôle, une fois la durée fiscale/accountability écoulée.

## Effacement / anonymisation (Art. 17) — lien

Une demande d'effacement d'un owner ne peut pas supprimer les `transactions` (fiscal/immuable), mais anonymise les champs non-fiscaux : `shipowners.address`, `ops_email`, `finance_email`, `phone_e164`, `iban`/`swift`/`bank`→effacés (+ **secret Vault de l'IBAN supprimé**), proof docs→supprimés du storage, `profiles.email`/`full_name`→pseudonymisés ; `name`/`billing_legal_name`/`imo`/sanctions **conservés** (obligation légale). **IMPLÉMENTÉ** (action `anonymizeOwner`, mig 103/105) — pendant « suppression » de cette politique.

## Implémenté (mig 102)

- **Minimisation IP au write (option 2a)** : trigger `BEFORE INSERT` sur `audit_logs` et `BEFORE INSERT/UPDATE OF ip_address` sur `profiles` → l'IP est tronquée à `/24` (IPv4) / `/48` (IPv6) dès l'écriture (`192.168.44.55` → `192.168.44.0/24`). L'IP complète n'est plus jamais persistée. (Les lignes `audit_logs` existantes ne sont pas rétro-minimisées — append-only ; procédure DBA si nécessaire.)
- **Fonctions de purge DÉSACTIVÉES + dry_run** : `rgpd_purge_arrival_alerts(p_days, p_dry_run)` et `rgpd_purge_owner_notifications(p_days, p_dry_run)` (service_role uniquement, dry_run par défaut, **aucun `cron.schedule`**). `collection_reminders` volontairement exclu (pas de statut « créance close » fiable).
- **Effacement Art. 17** (mig 103/105 + action `anonymizeOwner`) : efface contact + bancaire (IBAN + **secret Vault supprimé** via `kyc_vault_delete`) + anonymise le profil, conserve l'identité fiscale + sanctions ; audité `SHIPOWNER_ANONYMIZED`. Bouton UI SUPERADMIN (confirmation type-to-confirm).

## Purges — ACTIVÉES (durées validées PO 2026-07-21 : 90 jours)

`mig 106` planifie les 2 purges via `pg_cron` (hebdo, dimanche 03:00, **suppression réelle**) à **90 jours** :
- `rgpd_purge_arrival_alerts(90, false)` · `rgpd_purge_owner_notifications(90, false)`.

Inspection à blanc à tout moment (compte, ne supprime pas) :
```sql
select public.rgpd_purge_arrival_alerts(90, true);
select public.rgpd_purge_owner_notifications(90, true);
```
Désactivation : `select cron.unschedule('rgpd-purge-arrival-alerts');` (idem owner-notifications).

⚠️ Concernent uniquement des données **opérationnelles/transitoires** (AIS/ADS-B, notifications). `transactions`/`audit_logs` restent **hors** purge automatique (fiscal/immuable/append-only → procédure DBA).

## Décisions PO (2026-07-21)

- **Rétention purges = 90 jours** → purges activées (mig 106). ✅
- **`swift_bic`/`bank_name` : GARDÉS EN CLAIR** (pas de chiffrement Vault) — affichés au staff pour opérer les virements, donc chiffrement au repos = valeur marginale (protège seulement un dump brut) vs coût élevé, contrairement à l'IBAN (jamais affiché → chiffré). Protégés par RLS + chiffrement disque Supabase. ✅ (rappel : ils SONT effacés à l'anonymisation Art. 17.)

## Reste (non bloquant)

1. Définir « créance close » pour `collection_reminders` puis ajouter sa fonction de purge.
2. Documenter la procédure DBA pour `transactions`/`audit_logs` (immuables/append-only).
