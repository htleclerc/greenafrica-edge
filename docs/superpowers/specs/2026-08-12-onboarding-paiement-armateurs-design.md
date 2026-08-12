# Onboarding paiement armateurs — accueil, consultation par IMO/MMSI, tutoriel

**Date :** 2026-08-12
**Statut :** Design approuvé — prêt pour writing-plans
**Branche de départ :** `develop`

## Objectif

Un armateur qui doit une taxe carbone n'a aujourd'hui **aucun chemin** entre « j'ouvre greengate.africa » et « j'ai payé ». La page d'accueil s'adresse aux institutions et aux partenaires ; les deux appels à l'action (`Sign in`, `Request access`) ne disent pas qu'on peut régler une taxe ici ; et rien n'explique la marche à suivre.

Ce chantier construit cet entonnoir, de bout en bout :

1. **L'accueil** pose la question de l'armateur au-dessus de la ligne de flottaison : *votre navire a-t-il une taxe à régler ?*, avec un champ IMO/MMSI.
2. **Une page de consultation publique** confirme le navire et la pression (combien d'avis, quelle échéance) — **sans jamais divulguer de montant**.
3. **Un rattachement par code e-mail** ouvre le compte le jour même, sans intervention staff, sans ouvrir de faille.
4. **Un tutoriel public** et **une checklist in-app** accompagnent avant et après la création du compte.

Contrainte forte : **étendre l'existant, ne rien reconstruire.** Zéro nouvelle table. On réutilise le patron `verify_invoice_lookup` (mig 019/038) pour la lecture publique, `enforceRateLimit` pour l'anti-énumération, l'OTP Supabase déjà câblé (`auth/sl/route.ts`, `owner/auth/callback/route.ts`), la file `admin/registrations` pour le repli, et le shell `/dashboard` opérateur-aware pour la checklist.

## Décisions de conception (approuvées PO 2026-08-12)

1. **Consultation en teaser, jamais en clair.** Le visiteur non connecté voit le nom du navire, l'IMO, le port d'escale, le **nombre** d'avis en attente, l'échéance la plus proche et le fait qu'un avis soit échu. Il ne voit **ni montant, ni référence de pro-forma, ni nom d'armateur**. Le montant n'est pas masqué côté client : il est **absent de la réponse serveur**.
   *Pourquoi :* un IMO fait 7 chiffres — l'espace est entièrement énumérable. Publier les montants par IMO rendrait le portefeuille (2,75 M USD, 656 pro-formas) scannable par n'importe quel concurrent, courtier ou journaliste. Le nom du navire et l'IMO, eux, sont déjà publics (AIS, Equasis) : les afficher ne divulgue rien et sert de signal de reconnaissance (« c'est bien mon navire »).

2. **Rattachement par code envoyé à l'adresse déjà connue.** Quand l'armateur du navire porte un `shipowners.official_email`, on envoie un code à **cette** adresse — jamais à une adresse saisie par le visiteur. Accès le jour même, aucune attente staff. Sans e-mail connu : repli sur le formulaire de demande validé par le staff.

3. **Les trois sources d'e-mail ouvrent l'accès direct**, `AGENT_CLAIM` compris. Décision PO explicite (voir « Risques acceptés » §R1 pour le compromis et le contrôle compensatoire).

4. **L'accueil devient armateur-first.** Le champ IMO/MMSI est l'élément central du hero. Les sections `CapabilitiesSection`, `AboutTeaserSection`, `SimulationSection`, `GreenGateTeaserSection`, `SovereignSection` restent **strictement inchangées** en dessous : le récit souverain descend d'un cran, il n'est pas amputé.

5. **Tutoriel public + checklist in-app dérivée.** Une page `/how-to-pay` en quatre étapes (indexable, imprimable, partageable par l'agent maritime), et un bandeau de progression sur `/dashboard` dont les quatre items sont **calculés depuis l'état réel** — jamais depuis un drapeau « tutoriel vu ».

## Périmètre

**Inclus :** migration 118 (RPC teaser + index `vessels(mmsi)` + colonne `shipowners.is_placeholder` et son backfill) ; hero d'accueil refondu ; page `/pay` (consultation) ; parcours `/pay/claim` (code e-mail + repli staff) ; page `/how-to-pay` ; bandeau checklist `/dashboard` ; deux buckets de rate-limit ; i18n 6 locales ; tests unitaires, RPC, sécurité et E2E.

**Exclus, explicitement :**
- **L'aviation.** IMO/MMSI est maritime. Les compagnies aériennes ont `aircraft.icao24` / immatriculation ; la forme du parcours est identique et la RPC est extensible, mais ce chantier ne la livre pas.
- **Le paiement sans compte.** Consulter est public, payer exige un compte. Aucun rail n'est exposé hors session.
- **La vidéo** du tutoriel (production hors chantier logiciel, 6 locales).
- **Toute modification des rails de paiement**, de la tarification, ou du moteur de calcul.

## Architecture & fichiers

### Migration — `supabase/migrations/118_vessel_payment_teaser.sql`

Le seul choix d'architecture structurant est la façon dont une page publique lit des données protégées. Trois options ont été pesées :

| Approche | Verdict |
|---|---|
| **RPC `SECURITY DEFINER` appelée avec la clé anon** | **Retenue.** La projection est figée dans SQL : la clé anon ne *peut pas* sur-lire, même si le code applicatif se trompe. Reprend le patron éprouvé de `verify_invoice_lookup`. |
| Route API + client service-role à colonnes whitelistées | Écartée. C'est ce que fait `fetchVerifiedReceipt`, déjà commenté comme dette : une clé service-role sur un chemin public ne tient que par une whitelist maintenue à la main. |
| Policy RLS de lecture publique sur `vessels`/`transactions` | Écartée. Ouvre les tables en lecture pour de bon, montants compris. |

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 118 : consultation publique par IMO/MMSI (teaser sans montant)
-- ─────────────────────────────────────────────────────────────────────────────

-- vessels n'a d'index que sur imo_number (mig 003). La recherche accepte aussi
-- le MMSI ; sans index, un balayage séquentiel sur un chemin public non
-- authentifié est un levier de déni de service.
CREATE INDEX IF NOT EXISTS idx_vessels_mmsi ON public.vessels(mmsi) WHERE mmsi IS NOT NULL;

-- Marqueur explicite d'armateur de regroupement (« placeholder »). Voir §G2 :
-- ces lignes ne représentent aucune entité réelle et ne doivent jamais ouvrir
-- un accès par code. Aujourd'hui « À identifier » n'a pas d'official_email et
-- se trouve exclu de fait — ce drapeau rend la protection intentionnelle plutôt
-- qu'accidentelle, et la maintient si une adresse de repli y est un jour saisie.
ALTER TABLE public.shipowners
  ADD COLUMN IF NOT EXISTS is_placeholder BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.shipowners.is_placeholder IS
'TRUE pour les armateurs de regroupement ne correspondant à aucune entité réelle
(ex. « À identifier - IMO lookup en cours », seed arm-014 : 83 pro-formas,
1,63 M USD en attente d''appariement). Exclut la ligne du rattachement public
par code — voir vessel_payment_teaser et spec 2026-08-12.';

-- Backfill unique, au moment de la migration, plutôt qu'un filtre par motif
-- rejoué à chaque requête. Le libellé provient du seed 01_armateurs.json
-- (arm-014.nom_legal). Le staff peut ensuite basculer le drapeau à la main.
UPDATE public.shipowners
   SET is_placeholder = TRUE
 WHERE name ILIKE 'À identifier%'
    OR name ILIKE 'A identifier%';

-- Statuts « à régler » : PENDING, PARTIALLY_PAID, OVERDUE.
-- Exclus volontairement : PAID, EXEMPT, VOID, CREDIT_NOTE_ISSUED (rien à devoir)
-- et DISPUTED (avis sous contestation — le compter comme dû contredirait la
-- procédure de contestation publiée sur /legal-basis).
CREATE OR REPLACE FUNCTION public.vessel_payment_teaser(p_identifier TEXT)
RETURNS TABLE (
    vessel_name       TEXT,
    imo_number        TEXT,
    port_call         TEXT,
    outstanding_count INT,
    earliest_due_date TIMESTAMPTZ,
    has_overdue       BOOLEAN,
    claimable         BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH v AS (
        SELECT ve.id, ve.name, ve.imo_number, ve.port_call
        FROM public.vessels ve
        WHERE ve.imo_number = p_identifier
           OR ve.mmsi       = p_identifier
        LIMIT 1
    ),
    t AS (
        SELECT tx.*
        FROM public.transactions tx
        JOIN v ON v.id = tx.vessel_id
        WHERE tx.status IN ('PENDING', 'PARTIALLY_PAID', 'OVERDUE')
    )
    SELECT
        v.name,
        v.imo_number,
        v.port_call,
        (SELECT COUNT(*)::INT              FROM t),
        (SELECT MIN(t.due_date)            FROM t),
        (SELECT COALESCE(BOOL_OR(t.status = 'OVERDUE'), FALSE) FROM t),
        -- claimable : l'armateur du dernier avis porte-t-il un e-mail
        -- exploitable ? Booléen seul — ni l'adresse ni le nom ne sortent d'ici.
        -- COALESCE : un navire sans avis en attente n'a pas d'armateur résolu
        -- ici ; on renvoie FALSE, jamais NULL, pour que l'appelant n'ait qu'un
        -- seul cas à traiter.
        COALESCE((
            SELECT s.official_email IS NOT NULL
               AND s.official_email <> ''
               AND s.is_placeholder = FALSE
            FROM t
            JOIN public.shipowners s ON s.id = t.shipowner_id
            ORDER BY t.created_at DESC
            LIMIT 1
        ), FALSE)
    FROM v;
$$;

-- Verrou : révoquer d'abord de PUBLIC, n'accorder qu'à anon/authenticated.
REVOKE ALL ON FUNCTION public.vessel_payment_teaser(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vessel_payment_teaser(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.vessel_payment_teaser(TEXT) IS
'Consultation publique par IMO/MMSI. NE JAMAIS ajouter de montant, de référence
de pro-forma, de nom d''armateur ni d''e-mail à cette projection : elle est
appelée avec la clé anon depuis une page publique, sur un espace d''identifiants
entièrement énumérable. Voir spec 2026-08-12.';
```

Le commentaire SQL n'est pas décoratif : c'est le garde-fou qui survit au départ de celui qui a écrit la migration. Il est doublé d'un test (§Tests).

### Résolution de l'armateur — hors RPC anon

`vessel_payment_teaser` retourne `claimable` (booléen), **jamais** l'e-mail ni le nom de l'armateur. La résolution de l'adresse et l'envoi du code vivent dans une **server action** exécutée côté serveur avec le client plateforme ; le client ne reçoit que l'indice masqué.

**Nouveaux fichiers :**

| Fichier | Rôle |
|---|---|
| `frontend/src/lib/vessels/identifier.ts` | Normalisation d'un identifiant saisi → IMO ou MMSI canonique, ou `null`. Pur, testable. |
| `frontend/src/services/vesselTeaserService.ts` | Appel RPC + mise en forme de l'état d'affichage (`OUTSTANDING` / `CLEAR` / `UNKNOWN`). |
| `frontend/src/actions/requestVesselAccessCode.ts` | Résout l'armateur, applique les gardes, envoie l'OTP, retourne l'indice masqué. |
| `frontend/src/actions/verifyVesselAccessCode.ts` | `verifyOtp`, lie `profile_id`, passe `account_state` à `ACTIVE`, horodate `email_verified_at`, écrit l'audit. |
| `frontend/src/lib/onboarding/checklist.ts` | Dérive les 4 items de la checklist depuis l'état réel. Pur, testable. |

**Normalisation de l'identifiant** (`identifier.ts`) — l'armateur copie-colle depuis un e-mail, un PDF ou un site AIS. On accepte : `9284531`, `IMO 9284531`, `IMO9284531`, `imo-9284531`, avec espaces parasites. Règle : retirer tout caractère non numérique après avoir supprimé un préfixe `IMO` optionnel ; **7 chiffres → IMO**, **9 chiffres → MMSI**, toute autre longueur → `null` (rejet côté client, sans appel serveur, sans consommer de quota).

### Rate limiting — `frontend/src/lib/rateLimit.ts`

Deux clés ajoutées à `LimiterKey` et à `LIMITS` :

```ts
// Consultation publique par IMO/MMSI. Un armateur vérifie sa flotte : quelques
// navires, quelques rechargements. Généreux pour l'humain, dur pour le balayage
// des 7 chiffres d'IMO.
'vessel-lookup': { perMinute: 20, perHour: 120 },

// Envoi d'un code d'accès. Doublement plafonné (voir §Sécurité G3) : par IP ici,
// et par armateur dans l'action — sinon la page devient un bouton
// « spammer la boîte de mon concurrent ».
'vessel-claim': { perMinute: 3, perHour: 10, perDay: 15 },
```

### Pages et composants

| Chemin | Fichier | Nature |
|---|---|---|
| `/` (hero) | `frontend/src/components/landing/HeroSection.tsx` | **Modifié** — titre armateur, champ IMO/MMSI, liens *Comment ça marche* et *Se connecter*. |
| `/pay` | `frontend/src/app/pay/page.tsx` | **Nouveau** — Server Component, lit `?q=`, rend les 4 états. `noindex`. |
| `/pay` (formulaire) | `frontend/src/components/pay/VesselLookupForm.tsx` | **Nouveau** — partagé avec le hero, une seule implémentation du champ. |
| `/pay/claim` | `frontend/src/app/pay/claim/page.tsx` | **Nouveau** — envoi et saisie du code, ou formulaire de repli. `noindex`. |
| `/how-to-pay` | `frontend/src/app/how-to-pay/page.tsx` | **Nouveau** — tutoriel 4 étapes. **Indexable.** |
| `/dashboard` | `frontend/src/components/onboarding/OnboardingChecklist.tsx` | **Nouveau** — bandeau, monté dans le shell opérateur. |

Le champ de recherche est **un seul composant** monté à deux endroits (hero et `/pay`). Le dupliquer garantirait qu'une correction de normalisation ne s'applique qu'à moitié.

## Le parcours, état par état

### 1. Accueil `/`

Hero : titre orienté armateur, `VesselLookupForm`, exemple de saisie (`ex. 9284531`), lien *Comment ça marche* → `/how-to-pay`, lien discret *Se connecter* → `/login`. Soumission → `/pay?q=<identifiant normalisé>`.

### 2. Consultation `/pay?q=…`

Quatre états, et seulement quatre :

| État | Condition | Rendu |
|---|---|---|
| **OUTSTANDING** | navire trouvé, `outstanding_count > 0` | nom, IMO, port d'escale, « N avis en attente », échéance la plus proche, mention *échu* si `has_overdue`. CTA *Voir et payer*. |
| **CLEAR** | navire trouvé, `outstanding_count = 0` | « Aucun avis en attente » + invitation à créer un compte pour suivre. |
| **UNKNOWN** | aucune ligne, ou identifiant invalide | « Nous n'avons pas d'avis pour ce numéro » + contact. |
| **Rate-limité** | quota dépassé | **rendu identique à UNKNOWN**, même statut HTTP. |

Cette dernière ligne est la règle qu'applique déjà `/verify` : un scanner ne doit pas pouvoir distinguer « throttlé » de « rien ici », sinon le throttling lui-même devient un oracle.

`/pay` est en `noindex` — on ne veut pas de pages de dette indexées par navire. `/how-to-pay` est indexable : c'est la page qu'on veut voir remonter sur « somaliland carbon tax pay ».

### 3. Rattachement `/pay/claim?q=…`

L'armateur est résolu via le `shipowner_id` du **dernier** avis du navire (`ORDER BY created_at DESC`) — la pro-forma porte l'attribution faisant foi.

**Branche A — e-mail exploitable (`claimable = true`) :** écran « Nous envoyons un code à l'adresse enregistrée pour cet armateur », indice masqué, bouton d'envoi. OTP à **6 chiffres** (`signInWithOtp` puis `verifyOtp({ type: 'email' })`) — pas un lien magique : l'armateur consulte souvent sa boîte sur un autre appareil que celui où il a fait la recherche.

À la vérification réussie :
- `shipowners.profile_id` lié au compte (créé si absent),
- `account_state` : `GHOST`/`INVITED` → `ACTIVE`,
- `email_verified_at` horodaté,
- écriture `audit_logs` (voir §R1),
- redirection `/dashboard`.

**Branche B — pas d'e-mail exploitable (`claimable = false`) :** formulaire de demande (société, e-mail, téléphone, pièce justificative) → file `admin/registrations`, e-mail de confirmation à la validation.

**Masquage de l'indice.** On révèle assez pour que l'armateur sache quelle boîte surveiller, pas assez pour identifier l'entreprise : première lettre de la partie locale, première lettre du domaine, TLD conservé — `c••••t@h••••g.com`. L'indice est calculé **côté serveur** ; l'adresse complète ne traverse jamais la frontière réseau.

## Sécurité

Le modèle tient sur quatre gardes. Chacune a un test dédié.

- **G1 — La projection ne peut pas fuir.** La RPC est la seule voie de lecture publique, sa signature de retour ne contient aucun champ financier ni nominatif. Un ajout de colonne bien intentionné casse le test avant d'atteindre la production.
- **G2 — Un armateur de regroupement ne déclenche jamais d'envoi de code.** La ligne « À identifier - IMO lookup en cours » (seed `arm-014`) porte 83 pro-formas et 1,63 M USD en attente d'appariement, appartenant à des armateurs **distincts** : un code envoyé depuis cette ligne donnerait à son porteur la clé des 83 avis. Elle est exclue de `claimable` **dans le SQL** (pas seulement dans le code applicatif) et rebascule sur la branche B.
  *Note de conception :* cette ligne n'a aujourd'hui **aucun `official_email`** (le seed porte `email_principal: null`), donc la condition `official_email IS NOT NULL` l'exclut déjà. Cette protection est **accidentelle** : elle disparaîtrait en silence le jour où une adresse de repli y serait saisie. D'où la colonne `is_placeholder` — la garde doit être intentionnelle, pas une coïncidence de données.
- **G3 — L'envoi de code est plafonné deux fois** : par IP (bucket `vessel-claim`) et par armateur sur fenêtre glissante (dans l'action). Sans le second plafond, faire varier l'IP suffirait à inonder une boîte.
- **G4 — Le code part uniquement vers `official_email`.** Aucune adresse fournie en entrée n'est utilisée pour l'envoi, y compris si le formulaire en propose une pour la branche B.

**Portée de l'accès.** Le code ouvre le **compte armateur entier** — tous ses navires, tout son portefeuille — et non le seul navire recherché. C'est cohérent avec le modèle : c'est l'armateur légitime qui lit sa boîte. Cela signifie que la qualité de `shipowners.official_email` **porte à elle seule** le modèle de sécurité du rattachement.

## Risques acceptés

**R1 — `AGENT_CLAIM` ouvre l'accès direct.** Décision PO du 2026-08-12. `official_email_source` a trois valeurs : `EQUASIS_VERIFIED` (source tierce), `PORT_OFFICER` (saisie par un agent de l'État), `AGENT_CLAIM` (adresse déclarée par un agent maritime). La troisième est la moins fiable : si un agent a déclaré sa propre adresse comme e-mail officiel de l'armateur, le code lui donne accès au portefeuille complet de son client.

Le PO a tranché pour l'accès direct dans les trois cas — la friction d'une validation staff sur une part significative du portefeuille coûte plus que le risque résiduel. **Contrôle compensatoire retenu :** toute activation par code écrit une ligne `audit_logs`, au niveau `WARNING` quand la source est `AGENT_CLAIM`, avec l'armateur, l'IMO recherché et l'horodatage. La décision reste ainsi révisable a posteriori sans bloquer personne a priori.

**R2 — Le nombre d'avis est une divulgation mineure.** Savoir qu'un navire a « 3 avis en attente » sans en connaître le montant reste une information. Assumé : c'est précisément le signal qui fait cliquer, et il ne permet pas de reconstituer un portefeuille chiffré.

## Tutoriel et checklist

### `/how-to-pay`

Quatre étapes en prose fixe : *Trouvez votre navire* → *Recevez votre code* → *Consultez vos avis* → *Payez*.

**L'étape 4 rend la liste des rails réellement actifs** au lieu de les réciter. Il existe 11 rails (`STRIPE`, `WIRE_TRANSFER`, `CASH`, `CHEQUE`, `LETTER_OF_CREDIT`, `NETTING`, `THIRD_PARTY`, `MOBILE_MONEY`, `BANK_GUARANTEE`, `WALLET`, plus `PAYPAL` livré mais flag encore OFF), et l'activation varie par juridiction. Une prose figée mentirait le jour où un rail bascule — **et elle mentirait dans six langues à la fois**. Une phrase générique traduite une fois, une liste alimentée par la configuration : la page suit sans retoucher les traductions. C'est aussi la seule version honnête, puisque promettre la carte bancaire à un armateur dont la juridiction ne l'accepte pas fabrique un litige.

La page reprend deux valeurs déjà tranchées et publiées sur `/legal-basis` — le délai de contestation de **10 jours ouvrés depuis l'émission** et l'adresse `st.operations@greengate.africa`. Elle les **cite**, elle ne les redéfinit pas.

### Checklist `/dashboard`

Bandeau opérateur, quatre items **dérivés**, jamais stockés :

| Item | Source de vérité |
|---|---|
| Compte activé | `shipowners.account_state = 'ACTIVE'` |
| Navire rattaché | au moins un `transactions.shipowner_id` pointant sur l'armateur |
| Coordonnées de facturation | complétude au sens de `BillingWizard` |
| Premier paiement | un `payments` en `CONFIRMED` |

Dérivée plutôt que persistée, la checklist ne peut pas mentir : elle se décoche si l'état régresse, elle ne nécessite aucune migration, et elle disparaît d'elle-même une fois complète. Renvoyable manuellement pour la session, sans persistance du rejet — c'est un bandeau, pas un tunnel.

## i18n

Environ **85 clés nouvelles × 6 locales** (`fr`, `en`, `pt`, `sw`, `ar`, `so`) : ~40 pour le hero et `/pay`, ~35 pour `/how-to-pay`, ~10 pour la checklist.

`fr` et `en` sont rédigées proprement. `pt`, `sw`, `ar`, `so` partent en baseline automatique **marquée pour relecture native** — ce chantier alimente une dette déjà identifiée et assumée au niveau projet, il n'en ouvre pas une nouvelle.

`ar` est RTL, et le champ IMO devient le **premier élément réellement interactif de la page d'accueil** : son rendu et sa soumission doivent être vérifiés en RTL, pas seulement traduits.

## Tests

Les tests qui comptent sont ceux qui gardent les décisions de sécurité — pas ceux qui comptent les `<div>`.

**Sécurité (les quatre gardes) :**
- `vessel_payment_teaser` ne retourne aucun champ financier ni nominatif — assertion sur les **clés de la projection**, pas sur le rendu (G1).
- Un armateur `is_placeholder = TRUE` retourne `claimable = false` et ne déclenche aucun envoi — **y compris quand un `official_email` lui est renseigné**. C'est précisément ce cas qui distingue la garde intentionnelle de la coïncidence de données (G2).
- L'envoi de code est refusé au-delà du plafond par armateur, même en changeant d'IP (G3).
- Une adresse fournie en entrée est ignorée : le code part vers `official_email` (G4).
- `UNKNOWN` et rate-limité produisent une réponse identique (corps + statut).

**Unitaires :**
- `identifier.ts` : `9284531`, `IMO 9284531`, `IMO9284531`, `imo-9284531`, MMSI 9 chiffres, longueurs invalides, saisies bruitées.
- Sélection de l'échéance la plus proche et calcul de `has_overdue`.
- Masquage de l'indice e-mail : ne restitue jamais le domaine complet.
- Dérivation des 4 items de checklist, y compris la régression d'état.

**E2E :** accueil → saisie IMO → teaser → envoi du code → saisie → `/dashboard` avec checklist partiellement cochée.

## Déploiement

1. Appliquer la migration **118** (après 117 — non encore exécutée sur l'hébergé au 2026-08-12, comme 115 et 116 : vérifier la chaîne avant de dérouler).
2. **Vérifier le backfill `is_placeholder`** : `SELECT id, name, official_email FROM shipowners WHERE is_placeholder;` doit renvoyer la ligne « À identifier » et elle seule. Un backfill à zéro ligne signifie que le libellé a changé — la garde G2 serait alors inopérante.
3. Aucune variable d'environnement nouvelle. `enforceRateLimit` exige Upstash en production — déjà provisionné.
4. Vérifier que `/pay` et `/pay/claim` sortent bien en `noindex` et que `/how-to-pay` est indexable.
5. Contrôle post-déploiement : un IMO en `UNKNOWN`, un en `OUTSTANDING`, et un navire rattaché à l'armateur de regroupement qui doit atterrir sur le formulaire staff.
