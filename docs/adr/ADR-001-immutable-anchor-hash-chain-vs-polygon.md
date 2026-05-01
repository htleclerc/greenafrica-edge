# ADR-001 — Ancrage immuable des transactions fiscales : hash-chain Postgres local plutôt que Polygon PoS public

| | |
|---|---|
| **Statut** | ACCEPTED |
| **Date** | 2026-04-24 |
| **Auteur** | Eng review (cf. mig 022 design notes — "eng review 3A") + autoplan T2 |
| **Décideurs** | Eng team + Solide Technology — à co-valider avec MoECC + counsel |
| **Supersedes** | `docs/Decisions_Tranchees_GreenGate_v2026-04-19.md` §D2 (Polygon PoS) |
| **Référence légale** | Décret MoECC Ref. MOE&CC/mi/36/2026 du 31 mars 2026, Article 4 |
| **Implémentation** | Migrations 018 (`audit_logs` append-only) + 022 (NET-30 collections, "no Polygon anchor columns") |

---

## Contexte

Le décret ministériel concédant la collecte de la taxe carbone à Solide Technology stipule à l'**Article 4** des obligations de traçabilité technique. Le plan de développement v1.0 du 2026-04-19 (`docs/Plan_Developpement_GreenGate_v2026-04-19.md`) en a fait deux lectures successives :

1. **§1.2 du plan** : « La blockchain n'est plus un "gimmick marketing" : elle est **obligation contractuelle** (Article 4). »
2. **§D2 du document `Decisions_Tranchees_GreenGate_v2026-04-19.md`** : décision tranchée d'utiliser **Polygon PoS** (chaîne publique EVM-compatible) avec smart contract `AnchorRegistry`, wallet KMS, pattern outbox, monitoring de latence d'ancrage.

Cette interprétation — *« blockchain publique = obligation contractuelle »* — a deux faiblesses :

- **Lecture du décret** : la rédaction de l'Article 4 énonce des obligations de **traçabilité immuable** et de **vérifiabilité par tiers**. Ces objectifs sont compatibles avec plusieurs technologies, dont des chaînes publiques *mais aussi* des registres cryptographiques append-only locaux. La traduction « immuabilité ⇒ blockchain publique » est une lecture *suffisante* pour satisfaire le texte, pas une lecture *nécessaire*. Sans avis juridique formel imposant un ancrage public, choisir Polygon revient à interpréter le texte plus restrictivement que ne l'oblige sa lettre.
- **Conséquences techniques et opérationnelles** :
  - Réversibilité 1/5 (décision quasi-irréversible — re-ancrer rétroactivement = impossible)
  - Dépense d'un *innovation token* sur de la techno hors distribution pour l'équipe
  - Dépendance de fonctionnement à un tiers (Polygon validators, gas MATIC, RPC providers)
  - Coûts récurrents non négligeables (gas budget, monitoring, KMS, audits sécurité du contrat)
  - Risque de souveraineté : exposer l'identité fiscale d'armateurs sur une chaîne publique mondiale est délicat sous décret somaliendais

Pendant la mise en œuvre des Plans 1-5 (MVP carbone), la revue d'ingénierie a tranché la décision opposée :

> *« No Polygon anchor columns here — eng review 3A: drop on-chain V1, use local hash-chain like audit_logs migration 018. »* — `supabase/migrations/022_net30_collections.sql`

Le présent ADR formalise cette inversion et la justifie face au décret.

---

## Décision

**Adopter un hash-chain cryptographique local en Postgres comme primaire mécanisme d'ancrage immuable des transactions fiscales** (factures, événements de collection, rapports MoECC). Polygon PoS et tout autre chaîne publique sont écartés en V1.

### Mécanisme retenu

1. **Table append-only au niveau Postgres** — pattern initié par migration 018 sur `audit_logs` :
   - Triggers `BEFORE UPDATE` et `BEFORE DELETE` qui lèvent `insufficient_privilege` sur toute mutation.
   - Le service_role lui-même ne peut qu'INSERT.
   - Bypass = DDL (DROP TRIGGER), événement auditable au niveau Postgres.
2. **Hash-chain par enregistrement** : chaque ligne contient le hash SHA-256 du payload normalisé + le hash de la ligne précédente. Toute altération d'un enregistrement passé invalide la chaîne en aval.
3. **Compensation explicite via `supersedes_event_id`** (cf. mig 022 § OV10) : pour révoquer une erreur d'admin sans violer l'append-only, on insère une nouvelle ligne qui référence l'événement à neutraliser. La chaîne reste intacte ; l'historique reste lisible.
4. **Endpoint de vérification publique** `/verify/{invoiceId}` : un tiers peut récupérer le payload + chaîne de hashs jusqu'à un point d'ancrage daté/signé pour vérification indépendante. Le trust est porté par la **signature** d'un point d'ancrage périodique, pas par le consensus d'une chaîne tierce.
5. **Backups isolés et signés** : snapshots quotidiens chiffrés signés par une clé dédiée, conservés en stockage cold immutable (S3 Object Lock / équivalent souverain). C'est ce qui rend le hash-chain *vraiment* tamper-evident en cas de compromission complète du primaire.

### Conditions d'évolution vers blockchain publique

L'ADR s'engage à ouvrir une révision (ADR-001-rev) si **au moins une** des conditions suivantes est remplie :

- **Avis juridique formel** d'un counsel mandaté par MoECC ou Solide Technology établissant que l'Article 4 *exige* spécifiquement un ancrage sur chaîne publique.
- **Demande explicite du MoECC** lors de la co-signature des rapports mensuels (D6) ou d'un audit annuel.
- **Litige réel** où un armateur conteste l'authenticité d'une facture en alléguant une manipulation côté serveur, et où un tribunal somalien indique préférer une preuve sur chaîne publique.
- **Mandat international** (sanctions IMO, accord régional) qui impose une vérifiabilité cross-pays.

Si l'une de ces conditions se réalise, le chemin de migration est documenté en `Conséquences > Migration path`.

---

## Conséquences

### Positives

- **Réversibilité** : 4/5 (vs. 1/5 pour Polygon). Tant qu'on conserve les payloads + chaîne de hashs, on peut ré-ancrer ailleurs sans réécrire les transactions.
- **Boring tech** : Postgres triggers + SHA-256 sont tier-1. Aucun innovation token consommé.
- **Souveraineté** : aucune exposition publique non sollicitée d'identité fiscale d'armateur. Cohérent avec D7 (souveraineté des données, opérationnel UE + réplique Somaliland).
- **Coût opérationnel** : ~$0 marginal vs. ~$500-2000/an gas budget + monitoring blockchain.
- **Time-to-compliance** : la 1ère livraison MoECC mensuelle (avril 2026) tient sans dépendre d'un déploiement contrat + provisionnement wallet.
- **Surface d'attaque réduite** : pas de smart contract à auditer, pas de wallet privé à protéger contre le vol, pas de RPC provider à surveiller.

### Négatives / risques résiduels

- **Trust = signature d'opérateur, pas consensus tiers**. Un attaquant qui compromet *à la fois* la base primaire ET la procédure de signature des snapshots peut, en théorie, réécrire l'historique. Mitigation : séparation des rôles, KMS pour la clé de signature, snapshots chiffrés en cold storage immutable, rotation et co-détention de la clé (Solide + MoECC une fois D6 implémenté).
- **Vérification publique moins immédiate** : un tiers doit faire confiance à `/verify` plutôt que de lire un block explorer. Mitigation : publication mensuelle du *root hash* de la chaîne dans un canal public (par exemple un PDF signé déposé sur le portail MoECC), ce qui donne un point de référence externe vérifiable sans dépendre d'une infrastructure blockchain.
- **Désaccord possible avec interprétation du décret** : si MoECC interprète Article 4 comme imposant strictement une chaîne publique, l'ADR doit être révisé. Cf. conditions d'évolution.
- **Dette technique différée** : si un litige tranche en faveur d'une preuve blockchain *ex post*, ré-ancrer rétroactivement les transactions historiques sera coûteux (mais possible — chaque transaction a son hash, on peut anchore en batch).

### Migration path (au cas où)

Si l'ADR doit être révisé pour réintroduire un ancrage public :

1. Ne **pas** retirer le hash-chain Postgres — il devient le *primary*, la chaîne publique l'*aval*.
2. Ajouter table `blockchain_anchor` (initialement prévue par plan §7.1 et déjà nommée par §D2) avec FK vers `transactions.id` et colonnes `chain`, `tx_id`, `block_number`, `anchored_at`.
3. Pattern outbox sur insert dans la chaîne primaire → enqueue d'un job d'ancrage.
4. Backfill optionnel : ancrage en batch des transactions historiques par lots de N, avec coût gas budgété.
5. Endpoint `/verify` étendu pour exposer le `tx_id` quand disponible, fallback sur le hash-chain seul sinon.

Coût estimé re-introduction : ~1 sprint dev + budget gas pour backfill (variable selon volume).

---

## Évidences en code

- `supabase/migrations/018_audit_tamper_resistance.sql` — pattern append-only retenu (triggers, error handling)
- `supabase/migrations/022_net30_collections.sql` — décision explicite « no Polygon anchor columns » + `collections_event.supersedes_event_id` pour compensation propre
- (À venir Phase 2) endpoint `/verify/{invoiceId}` exposant le hash-chain pour vérification tierce
- (À venir Phase 2) cron de publication mensuelle du root hash signé

---

## Open items

- [ ] **Avis counsel** sur l'interprétation Article 4 — input attendu avant le 1er rapport MoECC machine-signé
- [ ] **D6 co-signature MoECC** : intégration de la clé MoECC dans la procédure de signature des snapshots root-hash
- [ ] **Documentation du `/verify`** : spécifier le format du payload exposé (Phase 2)
- [ ] **Procédure de rotation** des clés de signature des snapshots
- [ ] **Test de récupération** : exercice annuel de tamper-evidence détectable sur la chaîne primaire à partir d'un snapshot signé
