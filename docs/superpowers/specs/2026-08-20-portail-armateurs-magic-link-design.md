# Portail armateurs — accès par lien magique, comptes initialisés, flotte auto-gérée

**Date** : 2026-08-20
**Statut** : conception validée, en attente de revue PO
**Périmètre** : maritime uniquement
**Branche prévue** : `feat/portail-armateurs-magic-link`

---

## 1. Le problème

Le 19 août 2026, 32 mises en demeure sont parties vers les débiteurs de Berbera, pour 669 750,80 USD sur un portefeuille total de 1 316 124,00 USD. Aucun destinataire n'a pu ouvrir son dossier. Deux causes distinctes, l'une bête, l'autre grave.

### 1.1 Le bouton des e-mails ne mène nulle part

Tous les modèles d'e-mail destinés aux armateurs pointent sur `/owner/invoices` ou `/owner/wallet`. **Ces routes n'existent pas.** Le portail armateur vit sous `(dashboard)/dashboard/invoices` et `(dashboard)/dashboard/wallet` depuis la convergence des portails. Douze occurrences dans huit modèles de `emailService.ts` : relance pro-forma (678, 688), émission (794, 803), relevé mensuel (830, 836), récapitulatif consolidé (876, 889), litige (597), remboursement (1073, 1082), portefeuille (920, 927).

L'armateur qui clique tombe sur un 404, est redirigé vers `/login`, où l'authentification se fait **par mot de passe uniquement** — or les armateurs ont été importés à l'état `GHOST`, sans mot de passe, par construction. Il n'existe aucun chemin d'entrée.

### 1.2 La plateforme et la campagne sont deux livres comptables différents

La base de production contient le portefeuille importé le 18 juillet : 656 pro-formas, 2 750 890,34 USD, dont 100 maritimes portant les références `PRO-2026-064001` à `PRO-2026-064100`, sur des navires largement anonymes (`VESSEL-W4-*`). Aucune n'a jamais été envoyée.

La campagne réellement expédiée le 19 août est un autre portefeuille : 74 dossiers consolidés, 86 navires nommés, 346 escales, 1 316 124,00 USD. Elle réutilise **la même série de références**, `PRO-2026-064001` à `PRO-2026-064086`.

Les 86 références se télescopent intégralement, sans qu'aucune ne désigne le même navire ni le même montant :

| Référence | Envoyé le 19/08 | En base |
|---|---|---|
| `PRO-2026-064001` | MAYAR — 68 832,00 | RASHA — 28 999,99 |
| `PRO-2026-064002` | UNITED ID — 45 558,00 | GLIMLIT — 28 191,52 |
| `PRO-2026-064009` | HAJH GHSN J — 31 161,60 | MAYAR — 12 298,39 |

Ouvrir les comptes sans traiter ce point serait nuisible : chaque débiteur verrait, sous la référence de sa mise en demeure, une facture pour un autre navire et un autre montant. La créance et la crédibilité tomberaient ensemble.

---

## 2. Décisions

Prises par le PO le 2026-08-20.

| Sujet | Décision |
|---|---|
| **Livre faisant foi** | La campagne du 19/08. Les 100 pro-formas maritimes du seed sont annulées, les 86 réelles importées à leur place. |
| **Périmètre** | Maritime d'abord. L'aérien (556 pro-formas, hors collision) reste en l'état ; chantier miroir ultérieur. |
| **Lien magique** | Armateurs, représentants rattachés et destinataires en copie de facturation. Le personnel garde le mot de passe. Aucune création de compte sur adresse inconnue. |
| **Mise en service** | Création **silencieuse**, aucun e-mail. L'accès passe par la relance suivante. |
| **Retrait d'un navire** | Libre si le navire ne porte aucune pro-forma. Sinon le geste devient « contester » et part en revue du personnel. Jamais d'annulation de facture en libre-service. |
| **Navires** | Ce chantier et l'identification VesselFinder avancent en parallèle, sans dépendance. |
| **Source des adresses** | Le référentiel d'abord. L'export d'escales alimente la table de propositions VesselFinder, revue par le personnel, et n'écrit jamais directement. |

### Hors périmètre, explicitement

- **Les 35 dossiers sans adresse** — 486 709,20 USD, 37 % du portefeuille. Aucun compte n'est possible sans adresse. Leur voie reste « recherche de coordonnées / courrier P&I ». Le portail ne les couvre pas, et il ne faut pas laisser croire l'inverse.
- **Les 3 dossiers sous sanctions** — 148 110,80 USD. Morgan Navigation (UN), Petrofleet et Barbara/Yassin (OFAC). Jamais de contact direct, saisie *in rem* via Me Eidle Omer.
- **L'aérien**, la ré-identification des navires, la refonte du modèle multi-armateur.

---

## 3. Architecture

Trois notions maintenues séparées, parce que leur confusion est à l'origine de la situation actuelle.

| Notion | Question | Support |
|---|---|---|
| **Référentiel** | qui doit de l'argent, et à quelle adresse on l'atteint | `shipowners`, `owner_agent_mappings`, `shipowner_billing_cc` |
| **Porte d'entrée** | cette adresse ouvre quel compte | action `requestLoginLink` |
| **Libre-service** | ce que l'armateur peut corriger une fois entré | écran de flotte + actions auditées |

Cinq incréments, chacun déployable seul.

| | Incrément | Migration | Risque |
|---|---|---|---|
| ⓪ | Rebascule du livre comptable | oui | élevé — donnée fiscale |
| ① | Réparation des liens d'e-mail | non | nul |
| ② | Lien magique | non | moyen — surface d'authentification |
| ③ | Mise en service des comptes | non | moyen |
| ④ | Écran de flotte | non | moyen |

Une seule migration sur tout le chantier, celle de la rebascule.

L'incrément ① est livrable immédiatement et indépendamment. C'est la réparation la moins chère du symptôme signalé, et elle profite aux 32 relances déjà parties.

---

## 4. Incrément ⓪ — Rebascule du livre comptable

### 4.1 Le verrou

Trois garde-fous de la migration 089, vérifiés en base :

- `status` est **librement modifiable**, et l'énumération `transaction_status` contient `VOID`. Annuler une pro-forma est un simple `UPDATE`.
- `invoice_ref` est **en écriture unique** : `IF OLD.invoice_ref IS NOT NULL AND NEW.invoice_ref IS DISTINCT FROM OLD.invoice_ref THEN RAISE`. On ne peut ni le changer ni le remettre à `NULL`. La trappe de reprise n'ouvre que le passage `NULL → valeur`.
- `idx_txn_invoice_ref` est un index **unique partiel** `WHERE invoice_ref IS NOT NULL`. L'annulation ne libère donc pas la référence.
- `transactions_no_delete` et `transactions_no_truncate` interdisent toute suppression : *« fiscal rows are permanent »*.

Passer les 100 lignes à `VOID` ne suffit pas : `PRO-2026-064001` resterait occupée par RASHA et l'insertion de MAYAR échouerait sur l'index.

### 4.2 La sortie

Une migration qui restreint l'unicité aux lignes vivantes :

```sql
DROP INDEX public.idx_txn_invoice_ref;
CREATE UNIQUE INDEX idx_txn_invoice_ref
  ON public.transactions (invoice_ref)
  WHERE invoice_ref IS NOT NULL AND status <> 'VOID';
```

Puis, dans l'ordre : annulation des 100 maritimes du seed (`UPDATE … SET status = 'VOID'`, autorisé), puis insertion des 86 réelles avec leurs références authentiques.

Aucune ligne fiscale n'est détruite. La piste d'audit reste entière. Le portail affiche exactement le document que le débiteur détient.

### 4.3 Pourquoi le motif du QR ne s'y oppose pas

La migration 089 gèle `invoice_ref` au motif que « les PDF distribués portent cette référence dans leur QR ». Deux faits le neutralisent ici :

1. **Les 100 pro-formas du seed n'ont jamais été envoyées** (`sent_at` vide). Aucun document portant ces références n'a circulé depuis la plateforme.
2. **Les 86 PDF officiels ne contiennent aucun QR ni aucune URL.** Vérifié en décompressant les flux de `PRO-2026-064001-MAYAR.pdf` : aucune occurrence de `http`, `verify` ou `greengate`. Ils ont été produits hors plateforme.

Conséquence à assumer : les documents en circulation **ne sont pas vérifiables** par `/verify/[ref]`, dont la page exige une signature HMAC dans l'URL du QR. Réémettre des PDF signés portant les mêmes références est un chantier distinct, rendu possible — et non empêché — par le fait de conserver la numérotation `PRO-2026-064NNN`.

### 4.4 Correction obligatoire de la page de vérification

`/verify/[ref]` résout par égalité sur `transactions.invoice_ref`. Avec deux lignes partageant une référence, la résolution devient ambiguë. La requête doit être restreinte à `status <> 'VOID'`, et une ligne annulée retrouvée par un autre chemin doit s'afficher comme telle plutôt que comme authentique.

### 4.5 Entrée de l'import

**`ProFormas_OFFICIEL_19aout2026/cons_refs_mapping.csv`** — 74 lignes, UTF-8 propre, colonnes `cons_ref, fleet_manager, n_vessels, total_usd, contact_email, contact_phone, contact_address, contact_country, owner_name, owner_email, owner_phone, owner_address, owner_country, pi_club, vessels`.

C'est l'entrée canonique, pas le classeur : même contenu, encodage sain, et il porte le lien dossier ↔ navires. Le détail par navire (référence, IMO, MMSI, pavillon, jauge, escales, tCO2, montant) vient de la feuille « Détail Navires » du classeur.

### 4.6 Forme des 74 dossiers consolidés

`transactions` porte des factures **par navire** ; il n'existe pas d'objet « facture consolidée », et il n'en sera pas créé. Chaque `PRO-CONS-2026-NNN` devient un `shipowners`, ses navires deviennent des `vessels` rattachés, ses pro-formas des `transactions`. Le montant consolidé se recalcule à l'affichage.

Cette règle — **jamais de table parallèle** — est posée depuis le début de la mission et n'est pas rediscutée.

### 4.7 Qualité du référentiel — mesurée

**Inversion manager / ISM — mesurée sur les 74 dossiers.** En rapprochant `fleet_manager` du rôle réel dans l'export d'escales (parsing par index, colonnes dupliquées) :

| Le « Fleet Manager » du dossier correspond au… | Dossiers |
|---|---|
| MANAGER de l'export — conforme à la cascade | 43 |
| **ISM — inversé** | **21** |
| OWNER | 9 |
| aucune correspondance (`PRO-CONS-2026-071`, UNKNOWN) | 1 |

Les 21 inversions sont en majorité **bénignes** : dans 18 cas, le manager réel n'a aucune adresse, et l'auteur du fichier est descendu sur l'ISM parce que c'était le seul joignable — la cascade a fonctionné. Quatre cas seulement sont discutables, le manager étant joignable et pourtant relégué :

| Dossier | Nommé (ISM) | Manager réel joignable |
|---|---|---|
| `PRO-CONS-2026-012` | H&P Ship Management | Gulf Coast — `gulf.coastshpg@mail.example`, qui est **l'adresse ayant reçu la lettre** |
| `PRO-CONS-2026-025` | Brook Ocean Shipping | B B M Shipping — `bbm@bbmshipping.example` |
| `PRO-CONS-2026-055` | Success Shipping | Neel Shipping — `operations@neelshipping.example` |
| `PRO-CONS-2026-057` | Paradise Navigation | Gasmare Synergy — `gasmare@gasmare.example` |

(`PRO-CONS-2026-062` n'est qu'une variante de suffixe : « Friends Shipping Co SA » contre « Friends Shipping Co ».)

**Traitement retenu** : les lettres étant parties, renommer le débiteur contredirait le document détenu par le destinataire. On importe **tel qu'envoyé**. Le manager réel est enregistré comme **contact supplémentaire** de l'armateur — jamais comme un débiteur substitué. Le libellé du dossier reste celui de la mise en demeure.

**`PRO-CONS-2026-071` = « UNKNOWN »**, navire VENIZ 1, 2 653,20 USD. Sans nom de débiteur, il n'est ni contactable ni rattachable. Traité comme les 35 sans adresse, et attribué à la main par le personnel s'il est identifié.

---

## 5. Incrément ① — Réparation des liens

Remplacement des douze occurrences de `${appUrl()}/owner/invoices` et `${appUrl()}/owner/wallet` par les routes réelles. Aucune migration, aucune donnée touchée.

Deux garde-fous pour que la panne ne revienne pas :

- Les chemins passent par des **constantes nommées** (`OWNER_INVOICES_PATH`, `OWNER_WALLET_PATH`) plutôt que par des littéraux répétés.
- Un **test** parcourt les modèles rendus, extrait les chemins internes et vérifie que chacun correspond à une route existante du fichier de routes. Un lien mort casse la suite au lieu de partir en production.

---

## 6. Incrément ② — Lien magique

### 6.1 Réutilisation

`requestVesselAccessCode` fait déjà l'essentiel : minage du jeton par `generateLink` plutôt que par les modèles GoTrue non configurés, envoi par Resend, double plafond de débit par IP et par armateur, refus des armateurs fictifs, adresse lue en base et jamais reprise de l'entrée. La nouvelle action `requestLoginLink(email)` reprend cette mécanique et n'en change que la résolution : au lieu de *navire → armateur*, c'est *adresse → liste d'autorisation*.

### 6.2 Liste d'autorisation

Une adresse est reconnue si elle figure parmi :

- `shipowners.official_email` d'un armateur non fictif ;
- `profiles.email` d'un représentant actif de `owner_agent_mappings` ;
- `shipowner_billing_cc` — les copies de facturation.

### 6.3 Réserve sur les copies de facturation

Un destinataire en copie est souvent un comptable ou un tiers. Lui ouvrir le portail complet lui donne accès aux litiges, au dossier de conformité et aux moyens de paiement, bien au-delà de la copie de facture qu'il reçoit. La décision du PO est appliquée, mais **la session issue d'une copie de facturation est restreinte à la lecture des factures** : ni litige, ni conformité, ni paiement, ni gestion de flotte. Recevoir un double n'est pas détenir le compte.

### 6.4 Une adresse, un armateur

`current_shipowner_id()` fait `SELECT id FROM shipowners WHERE profile_id = auth.uid() LIMIT 1`, **sans `ORDER BY`**, et porte les policies RLS. Côté applicatif, `requirePrincipal` fait `.eq('profile_id', user.id).maybeSingle()`, qui **échoue** dès qu'il y a deux lignes.

Toute la plateforme suppose donc *un profil = un armateur*. Rattacher un même profil à deux armateurs casserait le portail et rendrait le RLS non déterministe. **Aucun sélecteur multi-armateurs dans ce chantier** : ce serait une refonte du modèle de sécurité.

La règle retenue : **le profil possède un dossier ; tout dossier supplémentaire joignable à la même adresse lui est rattaché comme représentation** via `owner_agent_mappings`.

Le cas réel est `faros@farosshipping.example`, qui couvre `PRO-CONS-2026-008` (Faros Shipping, TRUST 1, 36 675,60) et `PRO-CONS-2026-021` (Leaders for Trading, LEADER, 19 843,20). Le rattachement est sémantiquement exact : l'adresse postale de Leaders for Trading est littéralement *« C/O: Faros Shipping Co Sarl »*.

L'autre cas, `info@petrofleetenergy.example` sur `022` et `042`, est sans objet : les deux dossiers sont sous sanctions et n'ouvrent aucun compte.

**À vérifier pendant la réalisation** : que le portail expose bien les dossiers rattachés par `owner_agent_mappings`, et non le seul dossier possédé. Si ce n'est pas le cas, l'exposer fait partie de l'incrément.

### 6.5 Sécurité

- **Réponse invariable**, que l'adresse soit reconnue ou non — sans quoi le formulaire devient un révélateur de débiteurs.
- **Aucune création de compte** sur adresse inconnue. Le lien magique ouvre un compte existant ; il n'inscrit personne.
- **Double plafond** par IP et par adresse, repris de `requestVesselAccessCode`.
- **Le personnel reste au mot de passe.** L'allocation `role: 'SHIPOWNER'` ne s'applique qu'à la création ; un compte existant n'est jamais rétrogradé. Le filtre `.eq('role', 'SHIPOWNER')` sur la réactivation empêche qu'un membre du personnel dont l'adresse serait aussi celle d'un armateur soit activé par un appel public.
- **Garde sanctions** avant tout envoi, et journalisation `SANCTIONS_CONTACT_BLOCKED` en gravité critique.

---

## 7. Incrément ③ — Mise en service des comptes

### 7.1 Le script

`scripts/provision-owner-accounts.ts` — simulation par défaut, `--execute` explicite, idempotent, rejouable.

Entrée : les 36 dossiers joignables de `cons_refs_mapping.csv` (32 envoyés, 4 en attente). Pour chacun : création de `auth.users`, de `profiles` au rôle `SHIPOWNER`, pose de `shipowners.profile_id` et passage de `account_state` de `GHOST` à `ACTIVE`.

**Aucun e-mail n'est envoyé.** L'accès passe par la relance suivante, dont le lien fonctionnera enfin.

`assertContactAllowed` s'exécute **avant toute écriture**. Les trois dossiers sous sanctions sont refusés et journalisés.

### 7.2 Déblocage des représentants

`owner_agent_mappings.agent_profile_id` est `NOT NULL`, et le sélecteur de rattachement ajouté le 20/08 choisit parmi les profils **existants**. Un représentant sans compte n'est donc pas rattachable, et sans rattachement il n'a pas de lien magique. La boucle est fermée.

Elle s'ouvre en faisant que **saisir l'adresse d'un représentant sur la fiche armateur crée son compte au passage** — même chemin que le script, appliqué à l'unité, réservé au personnel et journalisé.

Premier cas réel : `gavaksh.b@rafflescommercial.com`, représentant de `marine@succshipping.example` / `PRO-CONS-2026-055` (Success Shipping, SNARTH, 7 018,80 USD). Cette adresse ne figure dans aucune des trois sources ; elle vient d'une réponse à la campagne. C'est le cas d'usage nominal.

---

## 8. Incrément ④ — Écran de flotte

`/dashboard/my-fleet` fonctionne aujourd'hui sur `useVessels` et `useTransactions`, des données de démonstration. Il passe sur les données réelles, restreintes à l'armateur de la session.

Trois gestes :

| Geste | Condition | Effet |
|---|---|---|
| **Renommer** | toujours | Correction du nom sur `vessels.name`. Ancien nom versé dans `previous_names`. Journalisé. |
| **Retirer** | aucune pro-forma sur le navire | `vessels.shipowner_id` passe à `NULL`. Le navire quitte la flotte. Réversible par le personnel. |
| **Contester** | au moins une pro-forma | Aucune modification. Ouvre un litige par transaction. La facture reste due et visible. |

**Aucun geste de l'armateur ne modifie une transaction.** L'immutabilité fiscale n'est ni contournée ni assouplie. Une contestation est une demande, pas une annulation.

### 8.1 Aucune table nouvelle

La contestation réutilise `disputes`, qui porte déjà tout le nécessaire : `transaction_id`, `vessel_id`, `submitted_by`, `reason` — dont la valeur **`VESSEL_DATA`**, qui dit exactement « ce navire n'est pas le mien » —, `description`, `evidence_urls`, `status`, `reviewer_id`, `review_note`, `original_amount_usd`, `revised_amount_usd`. La politique RLS de la migration 039 restreint déjà l'insertion d'un armateur aux transactions dont le `shipowner_id` résout vers son propre `profile_id`. `createOwnerDispute` est réutilisée telle quelle, appelée depuis l'écran de flotte plutôt que depuis l'écran des factures.

Retirer et renommer sont de simples `UPDATE` sur `vessels`, table non figée. **L'incrément ④ ne porte donc aucune migration.**

### 8.2 « Réclamer un navire » est retiré du périmètre

Le geste se justifiait dans l'ancien livre, où le dossier `arm-014` « À identifier » retenait 83 navires et 1 625 990,91 USD : il fallait un moyen pour que les armateurs se reconnaissent dans ce sac.

Dans le livre du 19 août, les 86 navires sont tous attribués **sauf un** — VENIZ 1, dossier `PRO-CONS-2026-071`, 2 653,20 USD. Construire un parcours de revendication en libre-service, avec sa file de revue et ses gardes anti-usurpation, pour une seule ligne à 2 653 USD ne se défend pas. Le personnel l'attribuera à la main s'il l'identifie.

Le besoin réapparaîtra si l'identification VesselFinder fait surgir de nouveaux navires non attribués ; il sera alors traité pour ce qu'il est, avec son propre arbitrage.

---

## 9. Tests

- **Migration** : `supabase/tests/migrations/` — un test vérifie que deux lignes peuvent partager une `invoice_ref` dès lors que l'une est annulée, et qu'elles ne le peuvent pas si les deux sont vivantes.
- **Liens d'e-mail** : test de non-régression appariant les chemins internes des modèles rendus aux routes réelles.
- **Lien magique** : adresse inconnue, adresse de personnel, adresse sous sanctions, plafonds de débit, invariance de la réponse.
- **Mise en service** : simulation sans écriture, idempotence sur double exécution, refus des trois dossiers sanctionnés, absence totale d'envoi.
- **Flotte** : retrait refusé sur navire facturé, contestation créant bien un litige `VESSEL_DATA` sans toucher à la transaction, renommage versant l'ancien nom dans `previous_names`, isolation entre armateurs.

---

## 10. Déploiement

Migrations écrites et jouées **en local** — Docker Desktop à démarrer, les ports 54321-54324 sont libres. Poussée en production à la livraison, **après** les migrations 109 à 127 encore non appliquées.

Ordre impératif : ⓪ avant ③. Ouvrir un compte sur un livre non rebasculé exposerait le débiteur à des chiffres contredisant sa mise en demeure.

**Accès production requis** : `SUPABASE_DB_PASSWORD` du projet `tvvvsysyiugrkrottczt`, dans un fichier ignoré par git — jamais dans une conversation. Deux secrets de production ont déjà été exposés le 18/07 et restent à faire tourner.

---

## 11. Risques

| Risque | Portée | Traitement |
|---|---|---|
| L'état réel de la production n'est pas vérifié | tout l'incrément ⓪ | Bloquant. Une requête tranche, dès l'obtention du mot de passe. |
| L'inversion manager/ISM désigne de mauvais débiteurs | créance | **Mesuré** : 21/74, dont 18 par simple absence d'adresse du manager. Import tel qu'envoyé, manager réel enregistré en contact supplémentaire. Les 4 cas discutables (012, 025, 055, 057) sont signalés au PO sans bloquer. |
| Les PDF en circulation ne sont pas vérifiables | confiance | Assumé. Réémission signée en chantier distinct, rendue possible par la conservation des références. |
| 37 % du portefeuille reste hors d'atteinte | recouvrement | Hors périmètre, énoncé sans ambiguïté plutôt que masqué. |
| Le portail n'expose peut-être pas les dossiers rattachés | Faros, Gavaksh | À vérifier tôt ; l'exposer entre dans l'incrément le cas échéant. |
