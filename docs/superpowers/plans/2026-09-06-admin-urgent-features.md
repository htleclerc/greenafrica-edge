# Plan — quatre chantiers urgents côté admin / staff / manager

> Demande PO du 2026-09-06. Quatre points : (1) listes des utilisateurs et des navires,
> (2) « voir comme l'armateur » en lecture seule, depuis un navire ou depuis un utilisateur,
> (3) choix de l'adresse qui reçoit le code de connexion sur le chemin IMO,
> (4) refonte de `/admin/tax-settings`.
>
> Ce document pose l'existant, les décisions de conception et l'ordre de livraison.
> Les hypothèses à trancher sont regroupées en fin de document.

---

## 0. Ce qui existe déjà (et qu'on réutilise)

| Besoin | Existant | Limite |
|---|---|---|
| Liste armateurs | `/admin/armateurs` — cockpit recouvrement sur `v_armateur_recouvrement` (nom, pays, statut, âge, pro-formas, encours, actions relancer / arbitrer / inviter) | Orienté recouvrement, pas « qui a accès » |
| Liste navires | `/admin/navires` — `v_navire_recouvrement` (navire, armateur, état, encours, facturé, ouvert, prochaine échéance) ; `/dashboard/vessels` (legacy staff) | Pas de recherche IMO/MMSI, pas de lien vers « ce que voit l'armateur » |
| Personnes | `/admin/staff` (staff + droits), membres dans `/owner/profile` (`owner_members_with_identity`, mig 141), représentants dans `/admin/owner-agent-mappings` | Quatre populations, quatre écrans ; aucun annuaire |
| Vue armateur | `/admin/armateurs/[ref]/portail` — résumé serveur lecture seule (encours, compte, bloqueurs d'accès) | Un résumé, pas **l'écran** de l'armateur ; pas de portée navire |
| Connexion IMO | `requestLoginLink` : IMO/MMSI → armateur → envoi à `official_email` + un indice masqué | Une seule adresse possible |
| Réglages | `/admin/tax-settings` = KPIs legacy + « les taux ont déménagé » + journal + alertes + exemptions + tendance, puis un éditeur à plat de 25 clés `app_config` ; `/admin/jurisdictions` (barèmes, répartition, règlement, copies, profil émetteur) ; `/admin/payments` (fournisseurs) | Trois écrans, une page qui n'est pas un réglage |

Principes tenus partout : références opaques dans les URL (mig 144 / 147), jamais de session
ouverte au nom d'un débiteur, réponse invariable sur le chemin connexion, trace `audit_logs`.

---

## 1. Annuaire des utilisateurs et liste des navires

### 1.1 `/admin/users` — un annuaire, quatre populations

Une vue `v_platform_users` (mig 150, `security_invoker`, lecture staff) qui unit :

| Population | Source | Colonnes propres |
|---|---|---|
| Staff | `profiles` (rôles staff) | rôle, juridictions, `can_settle_payments` |
| Titulaires | `shipowners.official_email` ↔ `profiles` | compte (`arm_` ref), état du compte, KYC |
| Membres | `owner_members` actifs ↔ `profiles` | compte, 4 drapeaux, invité par |
| Représentants | `owner_agent_mappings` actifs | compte(s) représenté(s) |

Colonnes communes : nom, e-mail, type, compte(s), dernière connexion (`auth.sessions`, déjà
lu par la page Sécurité), état. Recherche unique nom / e-mail / IMO (par les navires du
compte). Filtres : type, état, sans connexion depuis N jours, sanctionné.

Actions par ligne, selon le rôle :
- **Voir comme** → §2 (lecture seule) ;
- **Envoyer un accès** → `requestLoginLink` sur l'adresse (réutilise le chemin existant) ;
- **Ouvrir le dossier** → `/admin/armateurs/[ref]` ;
- révoquer un membre / un représentant (actions existantes).

Pas de nouvelle table : la vue lit ce qui existe. Aucune écriture nouvelle.

### 1.2 `/admin/navires` — recherche et rattachements

- Recherche par nom, IMO, MMSI, armateur (la vue 143 porte déjà `imo_number`).
- Colonne « Accès » : titulaire actif ? nombre de membres actifs ? (jointure légère sur
  `owner_members`), pour voir d'un coup d'œil qui pourra payer.
- Actions : **Voir comme (ce navire)** → §2.2 ; **Dossier armateur** ; **Identité** (→
  `/admin/vessel-identity` pour les navires « à identifier »).
- Filtres : sans armateur, à identifier (`arm-014`), sanctionné, en retard.
- `/dashboard/vessels` (legacy staff) : ajout d'un lien vers `/admin/navires`, pas de
  refonte — on ne maintient pas deux listes.

---

## 2. « Voir comme l'armateur » — lecture seule, exacte

### 2.1 Principe

Rendre **les mêmes composants** que le portail (`InvoicesTable`, `InvoiceDetailPanel`,
`FleetBoard`, `StatementDownload`, relevés) avec :

- une **portée explicite** `OwnerViewScope { shipownerId, jurisdictionId, vesselId? }` passée
  aux fonctions de lecture, sur un client tenant borné par `shipowner_id` — jamais la RLS
  du staff (qui montrerait toute la plateforme sous un seul nom) ;
- **les mêmes droits que la personne regardée** : `privileges` et `isMember` sont ceux du
  titulaire (tout) ou du membre (ses drapeaux réels). Ce qu'elle ne peut pas faire est
  **caché**, exactement comme sur son écran — un membre sans « payer » n'a pas de bouton
  Payer, et on le constate ;
- un drapeau `readOnly` qui **grise** tout bouton d'action visible (payer, contester,
  émettre, joindre, renommer, inviter) au lieu de le retirer : le staff voit précisément ce
  que la personne peut déclencher, sans pouvoir le déclencher à sa place. Survol : « Action
  réservée à l'armateur ». Les liens de téléchargement restent actifs (documents déjà émis,
  lien signé) ;
- un bandeau permanent « Vous voyez ce compte comme <nom> — lecture seule », avec la
  référence, et le rôle regardé (titulaire, membre avec ses droits, gestionnaire du navire).

Aucune session n'est ouverte au nom de l'armateur. Chaque ouverture écrit une entrée
`audit_logs` `OWNER_VIEW_AS` (acteur, compte, navire éventuel) — c'est une consultation de
données personnelles, elle doit être traçable.

### 2.2 Deux entrées, une seule vue

| Entrée | Route | Portée |
|---|---|---|
| Depuis un utilisateur / un compte | `/admin/armateurs/[ref]/portail` (remplace le résumé actuel) + `/…/portail/fleet`, `/…/portail/vessel/[vref]` | tout le compte |
| Depuis un navire | `/admin/navires/[vref]/portail` | **ce navire seulement** : factures dont `vessel_id` = navire, relevé consolidé `?vessel=`, détail navire — exactement ce que voit un gestionnaire dont l'accès est limité à ce navire |

Trois personnes possibles derrière « voir comme », et la vue suit celle qu'on regarde :

| Regardé | Droits appliqués | Effet à l'écran |
|---|---|---|
| Titulaire | tous | tous les boutons présents, grisés |
| Membre | ses drapeaux (`privilegesFromMember`) | les boutons qu'il n'a pas sont absents, les autres grisés, sa ligne « certaines actions ne sont pas incluses » s'affiche comme chez lui |
| Depuis un navire | ceux du titulaire, portée navire | factures, relevé et détail du seul navire ; boutons présents, grisés |

Le double mécanisme est ce qui rend la vue fidèle : la **visibilité** vient des droits (même
code que le portail), l'**inaction** vient de `readOnly` (une seule prop, posée par la vue
admin, jamais par le portail).

### 2.3 Travail de fond

Les pages du portail lisent aujourd'hui via `principal.supabase` (RLS). Il faut extraire
leurs lectures en fonctions `load*(db, scope)` (factures, flotte, relevés, portefeuille) que
le portail appelle avec `{ shipownerId: principal.shipowner.id }` et la vue admin avec la
portée explicite. C'est le gros du chantier, et c'est ce qui garantit « exactement ce dont il
dispose » : un seul chemin de données, deux appelants.

Côté composants, une prop `readOnly` traverse `InvoicesTable`, `InvoiceDetailPanel`,
`FleetBoard` / `OwnerFleetPanel`, le portefeuille et la section Membres : elle pose
`disabled` + l'info-bulle sur chaque bouton d'action, et neutralise les modales (paiement,
litige, justificatif). Les conditions d'affichage existantes (`privileges.canPay`,
`isMember`…) ne bougent pas — c'est ce qui garantit la fidélité. Le portail ne passe jamais
`readOnly` ; seule la vue admin le fait.

Rôles : `PORT_OFFICER`, `FINANCE_ADMIN`, `SUPERADMIN`, et `MANAGER` (lecture seule par
nature). Le montant de facturation reste soumis au droit existant `canViewBilling`.

---

## 3. Chemin IMO : choisir l'adresse qui reçoit le code

### 3.1 Aujourd'hui

IMO ou MMSI → armateur → envoi à `official_email`, un indice masqué en retour. Un
gestionnaire qui n'a pas la main sur la boîte officielle est bloqué.

### 3.2 Proposition

Un parcours en deux temps, derrière le même champ :

1. `requestLoginLink(imo)` ne renvoie plus un envoi, mais **la liste des boîtes admises**,
   masquées (`c••••t@h••••g.com`), chacune sous un **jeton opaque** :
   `{ via: 'vessel-choice', vesselName, choices: [{ token, hint }] }`.
   Boîtes admises : `official_email` (titulaire), membres actifs, représentants actifs.
   **Jamais** les copies de facturation (une copie n'est pas un accès — règle existante).
   Une seule boîte → envoi direct comme aujourd'hui, sans étape.
2. `sendLoginLinkTo({ imo, token })` re-résout l'armateur, vérifie le jeton, envoie.
   Le jeton est `HMAC(secret, shipownerId · email · fenêtre horaire)` : il ne se devine pas,
   ne se rejoue pas hors fenêtre, et ne transporte jamais l'adresse.

Une adresse de membre ouvre la session **du membre** (son profil, ses drapeaux) — le scope
`MEMBER` existe déjà. Un représentant, la sienne (scope `REPRESENTATIVE`).

### 3.3 Ce que ça coûte en exposition, assumé et borné

Le chemin IMO est déjà un oracle assumé (l'IMO est public ; un indice masqué sort). On
passe d'un indice à N indices masqués, plafonnés à 5, derrière les mêmes gardes : somme de
contrôle IMO, double quota (IP + armateur), sanctions (réponse « navire inconnu »). Les
indices masqués ne permettent pas de reconstituer une adresse. Journalisé.

Écran : après saisie de l'IMO, une liste radio d'indices, « Envoyer le code », puis la
confirmation existante avec l'indice choisi. Six locales.

---

## 4. `/admin/tax-settings` — découpage fonctionnel et structurel

### 4.1 Le diagnostic

La page mélange trois natures : un **tableau de bord** legacy (KPIs de recettes, journal des
transactions, alertes, tendance) qui n'est pas un réglage ; un **avis** « les taux ont
déménagé » ; et un **éditeur à plat** de 25 clés `app_config` sans regroupement ni aide,
où un seuil de réconciliation côtoie un secret de file d'attente et un flag Stripe. Les
vrais réglages fiscaux sont ailleurs (`/admin/jurisdictions`), les fournisseurs ailleurs
encore (`/admin/payments`).

### 4.2 Structure cible : un hub `/admin/settings`, six volets par intention

| Volet | Contenu | Vient de | Qui édite |
|---|---|---|---|
| **Fiscalité** | barèmes versionnés, exemptions, règles de répartition, règlement | `AdminJurisdictions` | SUPERADMIN, FINANCE_ADMIN |
| **Documents** | profil émetteur : délai (30 j), pénalité, contestation, signataire, IBAN, copies | `IssuerProfilePanel`, copies CC | SUPERADMIN, FINANCE_ADMIN |
| **Relance & recouvrement** | `owner_escalation.*`, paliers, copie huissier | éditeur pipeline (sous-ensemble) + CC huissier | FINANCE_ADMIN, SUPERADMIN |
| **Détection & rapprochement** | `arrival.*`, `reconciliation.*`, flags AIS / Equasis / détention | éditeur pipeline | SUPERADMIN |
| **Portail & paiements** | flags portail, self-service, Stripe, PayPal, portefeuille, rails ; fournisseurs | éditeur pipeline + `PaymentProvidersPanel` | SUPERADMIN, FINANCE_ADMIN |
| **Système** | `queue.*`, secrets, SMS | éditeur pipeline | SUPERADMIN seul |

`/admin/tax-settings`, `/admin/jurisdictions` et `/admin/payments` deviennent des redirections
vers le volet correspondant ; la navigation garde une seule entrée « Réglages ». Les KPIs,
le journal et la tendance partent vers `/admin/revenue` (ils y sont déjà pour l'essentiel).

### 4.3 Affichage cohérent

- `OsPageHeader` + rail de volets à gauche (les onglets `OsFilterTabs` existants sur mobile).
- Dans chaque volet, des **cartes par sujet** ; chaque réglage = libellé lisible, contrôle
  adapté au type (bascule, nombre avec unité et bornes, liste, secret masqué), une ligne
  d'aide, et « modifié le … par … » quand `app_config` le porte.
- Une **zone rouge** en bas du volet Système pour les secrets, confirmation à l'enregistrement.
- Garde « modifications non enregistrées » à la sortie d'un volet.
- Lecture seule pour `PORT_OFFICER` (règle RBAC existante), contrôles grisés avec la raison.

### 4.4 En deux temps

1. **Structure** (1 j) : le hub, les volets, les redirections, le déménagement des panneaux
   existants sans les réécrire, le retrait du tableau de bord legacy.
2. **Ergonomie** (1 j) : libellés / aides / unités / bornes par clé, zone rouge, garde de
   sortie, traçabilité.

---

## 4bis. État d'avancement

- **2026-09-06 — §2 livré** (étapes 1 et 2 fusionnées). Plutôt qu'extraire chaque lecture en
  `load*(db, scope)`, on fabrique un **principal opérateur synthétique** dont le client est
  borné en code (`lib/supabase/ownerScope.ts` : `shipowner_id` / `operator_id` injectés sur
  chaque `select`, portée navire optionnelle, fermé par défaut, écritures et `rpc` refusés).
  Les pages du portail ne changent pas de chemin de données : c'est ce qui garantit
  l'« exactement ». `requireViewAsOwner` (`lib/auth/viewAsOwner.ts`) résout compte ou navire
  par référence opaque, trace `OWNER_VIEW_AS` (mig 150), et pose `viewAs` sur le principal ;
  `portalPaths` en déduit liens et `readOnly` / `hideAmounts`. Routes :
  `/admin/armateurs/[ref]/portail{,/invoices,/fleet,/fleet/[vref],/wallet}` et
  `/admin/navires/[vref]/portail{,/invoices}`. Bandeau + volets, volets finance grisés pour
  `PORT_OFFICER`, montants masqués sur flotte et fiche navire. Lien « Voir comme ce navire »
  sur `/admin/navires` (la vue 143 porte `vessel_public_ref`, mig 150).
- **Reporté au §1** : « voir comme ce membre » (`?as=mbr_…`, colonne posée par la mig 150).
- **2026-09-06 — §3 livré.** `listLoginRecipients` (titulaire, membres actifs, représentants
  actifs, jamais les copies, plafond 5), jetons `HMAC(secret · compte · boîte · fenêtre
  horaire)` (`lib/auth/recipientToken.ts`, secret `LOGIN_RECIPIENT_SECRET` ou repli
  `INVOICE_SIGNING_SECRET`), `requestLoginLink` répond `vessel-choice` sans rien envoyer quand
  plusieurs boîtes existent, `sendLoginLinkTo` re-résout tout et envoie à la boîte désignée,
  `verifyLoginCode` → `verifyVesselAccessCode` vérifie le code sur la boîte choisie ; un
  membre ou un représentant ouvre SA session, le dossier n'est jamais rattaché à son profil.
  Écran : liste radio d'indices masqués, six locales.
- **2026-09-06 — §1.1 livré, sans vue SQL.** `/admin/users` (`services/platformUsersService.ts`) :
  les comptes viennent de la session (RLS), membres et représentants sont joints avec le
  client plateforme **bornés à ces comptes**, le staff n'apparaît qu'au SUPERADMIN ; dernière
  connexion par `profile_last_sign_in()` (mig 151, SECURITY DEFINER réservée au staff).
  Recherche nom / e-mail / compte / IMO, filtres type et état (dont « dormant » à 90 j),
  actions « voir comme » (titulaire, ou membre via `?as=mbr_…` — livré avec, les pages
  posent le bandeau elles-mêmes puisqu'un layout ne lit pas la requête), « envoyer un accès »
  (chemin public, réponse invariable), dossier. Entrée de navigation `users`.
- **§1.2 (navires)** : recherche déjà présente ; « voir comme ce navire » livré au §2.
  Colonne « qui a accès » et filtres supplémentaires : non faits, l'annuaire y répond.
- **2026-09-06 — §4.4 (1) livré.** `/admin/settings?tab=` (`lib/admin/settingsTabs.ts` : chaque
  clé `app_config` a un volet et un seul, testé contre `PIPELINE_KEY_ORDER`). Fiscalité =
  `AdminJurisdictions` ; Documents = `IssuerProfilePanel` + langues des pro-formas ; Relance,
  Détection, Portail (+ `PaymentProvidersPanel` pour la finance), Système (SUPERADMIN) =
  éditeur borné au volet. `/admin/tax-settings` et `/admin/jurisdictions` redirigent ;
  `/admin/payments` garde la résolution des paiements seule. `CarbonTaxSettingsPage`
  (KPIs legacy) supprimée. Entrée de menu unique `admin-settings`, lecture seule PORT_OFFICER.
- **2026-09-06 — §4.4 (2) livré.** `lib/admin/settingsKeyMeta.ts` (unité, bornes larges,
  entier attendu, danger) ; l'éditeur affiche l'aide par clé (`AdminTaxPipeline.hints`), l'unité
  à côté du champ, refuse hors bornes avant l'appel serveur avec la borne dans le message,
  confirme les clés dangereuses (cadre rouge), n'allume Enregistrer que sur une valeur
  modifiée, garde de sortie `beforeunload` tant qu'une saisie n'est pas enregistrée, et date
  de dernière modification. Traductions : fr + en réelles, baseline anglaise ailleurs.

## 5. Ordre de livraison proposé

| # | Chantier | Effort | Dépend de |
|---|---|---|---|
| 1 | §2.3 extraction des lectures du portail en `load*(db, scope)` | 1 j | — |
| 2 | §2 « voir comme » depuis un compte, puis depuis un navire | 1,5 j | 1 |
| 3 | §3 choix de l'adresse sur le chemin IMO | 1 j | — |
| 4 | §1 annuaire `/admin/users` + recherche / actions sur `/admin/navires` | 1,5 j | 2 (pour l'action « voir comme ») |
| 5 | §4.4 (1) structure des réglages | 1 j | — |
| 6 | §4.4 (2) ergonomie des réglages | 1 j | 5 |

Chaque étape est livrable seule et testée (unitaire + SQL pour la vue 150).

---

## 6. Arbitrages PO (2026-09-06)

1. **Rôles « voir comme »** : `PORT_OFFICER`, `FINANCE_ADMIN`, `SUPERADMIN` et `MANAGER`.
   Les montants facturés restent soumis à `canViewBilling` : **cachés à `PORT_OFFICER`**,
   y compris dans cette vue.
2. **Chemin IMO** : représentants (`owner_agent_mappings`) proposés, **oui** ; copies de
   facturation, **non**.
3. **Annuaire** : e-mails des membres visibles à tout le staff ayant accès aux armateurs,
   `PORT_OFFICER` compris — **oui**.
4. **Réglages** : les trois anciennes URL redirigent, les KPIs de l'ancienne page sont
   retirés au profit de `/admin/revenue` — **oui**.
