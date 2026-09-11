# Contexte projet — application de gestion d'argent personnelle

Document de référence pour l'implémentation. Toutes les décisions ci-dessous ont été arbitrées et ne sont pas à re-débattre, sauf mention explicite.

---

## 1. Objectif et contraintes

Application web de suivi de finances personnelles, **à usage strictement personnel** (un seul utilisateur, deux appareils : téléphone et ordinateur).

Contraintes structurantes :

- **Aucune connexion bancaire.** Toutes les données sont saisies à la main.
- **Aucun serveur.** Pas de backend, pas de base distante, pas d'authentification.
- **Local-first.** Les données vivent dans le navigateur de l'appareil.
- **Aucun service externe en phase 1.** Le seul compte requis est GitHub, pour l'hébergement.
- Non lucratif, non distribué. Le RGPD ne s'applique pas (usage domestique).

---

## 2. Stack

| Élément | Choix |
|---|---|
| Build | Vite + React + TypeScript |
| Stockage | IndexedDB via Dexie |
| PWA | `vite-plugin-pwa` (installable sur écran d'accueil) |
| Hébergement | GitHub Pages, dépôt **public** |
| Graphiques | Recharts |

Pas de Next.js : il n'y a pas de partie serveur à servir.

**GitHub Pages n'est disponible que sur les dépôts publics avec un compte gratuit.** Le dépôt de code est donc public, et ne doit contenir **aucun secret**. Toute clé éventuelle (phase 2) est saisie par l'utilisateur au premier lancement et stockée localement, jamais dans le build.

---

## 3. Décisions d'architecture non négociables

1. **Les montants sont des entiers, en centimes.** Jamais de nombre flottant sur de l'argent.
2. **La source de vérité est un journal d'événements append-only.** L'état applicatif est dérivé en repliant le journal. Rien n'est modifié ou supprimé en place : une correction est un nouvel événement.
3. **Les occurrences futures ne sont jamais stockées — seules leurs exceptions le sont.** Les occurrences se calculent à la volée depuis la règle, puis on applique par-dessus les corrections enregistrées, identifiées par le couple (récurrence, date théorique). C'est le modèle d'iCalendar : une règle, plus une liste d'exceptions. Une occurrence ne devient une transaction qu'une fois réellement passée.
4. **Les dates de récurrence stockées sont les dates théoriques.** Le décalage jour ouvré se calcule à l'affichage. Stocker la date décalée fait dériver la règle de mois en mois.
5. **Un virement entre comptes est une entité distincte**, pas deux transactions. Il est exclu par construction de tous les calculs de dépenses.
6. **Les instantanés de solde sont quotidiens et par compte.** C'est la seule source de l'historique : sans eux, modifier une valeur réécrit rétroactivement tout le passé.
7. **Appeler `navigator.storage.persist()` au premier lancement.** Safari purge IndexedDB après quelques jours d'inactivité ; l'installation en PWA plus cette demande sont la seule protection. À vérifier au moment de coder.

---

## 4. Modèle de données

### 4.1 Journal

```ts
type Event = {
  id: string        // uuid v4
  ts: number        // epoch ms
  device: string    // identifiant d'appareil, pour le diagnostic
  type: EventType
  payload: unknown
}
```

L'état est reconstruit en triant par `ts`, avec `id` comme départage. Deux appareils fusionnent par simple union sur `id` — il n'y a aucun conflit possible, donc aucun code d'arbitrage à écrire.

Types d'événements : `account.created` · `account.updated` · `account.archived` · `account.balance_set` · `transaction.created` · `transaction.updated` · `transaction.deleted` · `transfer.created` · `subscription.created` · `subscription.updated` · `subscription.price_changed` · `subscription.ended` · `label.created` · `label.renamed` · `label.budget_set` · `holding.created` · `holding.updated` · `snapshot.recorded`

### 4.2 Entités dérivées

**Account**

| Champ | Type | Note |
|---|---|---|
| `id` | string | |
| `nom` | string | |
| `type` | `courant` \| `livret` \| `pea` \| `cto` \| `av` \| `or` \| `autre` | |
| `groupe` | `bancaire` \| `investissement` | pilote le regroupement à l'écran |
| `mode` | `saisi` \| `calcule` | voir ci-dessous |
| `solde_cents` | int | uniquement si `mode = saisi` |
| `archived_at` | date? | un compte clôturé s'archive, ne se supprime pas |

Le **mode de valorisation** est la notion centrale :

- `saisi` — l'utilisateur tape le solde (courant, Livret A, LDDS, PEL).
- `calcule` — le solde est la somme des positions rattachées (PEA, CTO, or physique).

Une seule table, un seul champ, et tous les écrans fonctionnent identiquement pour les deux.

**BalanceEntry** — historique des relevés pour les comptes `saisi`

`account_id` · `date` · `solde_cents`

**Transaction**

`id` · `account_id` · `date` · `montant_cents` (signé, négatif = dépense) · `label_id?` · `note` · `subscription_id?` · `origine` (`manuel` \| `csv` \| `recurrence` \| `reconciliation`)

**Transfer**

`id` · `date` · `from_account_id` · `to_account_id` · `montant_cents` · `note`

**Label**

`id` · `nom` · `nom_normalise` (minuscules, sans accents — garantit l'unicité) · `couleur` · `budget_mensuel_cents?` · `archived_at?`

Les labels s'appliquent aussi aux abonnements, pour que le total d'un label inclue les prélèvements récurrents sans double saisie.

**Subscription**

| Champ | Valeurs |
|---|---|
| `nom` | |
| `account_id` | compte d'où sort le prélèvement, ou sur lequel arrive la rentrée |
| `label_id?` | |
| `sens` | `depense` \| `rentree` |
| `montant_mode` | `fixe` \| `estime` |
| `estimation_fenetre` | int, défaut 6 — occurrences réalisées prises en compte |
| `frequence` | `mensuel` \| `trimestriel` \| `annuel` \| `personnalise` |
| `intervalle` | int, défaut 1 |
| `jour_du_mois` | 1–31 |
| `regle_weekend` | `exact` \| `jour_ouvre_suivant` \| `jour_ouvre_precedent` |
| `regle_mois_court` | `dernier_jour` \| `ignorer` |
| `date_debut` | |
| `date_fin?` | |
| `rappel_jours` | int |
| `actif` | bool |

**SubscriptionPrice** — historisation des montants

`subscription_id` · `montant_cents` · `valide_du` · `valide_au?`

Indispensable : sans cela, une hausse tarifaire recalcule rétroactivement toutes les dépenses passées au nouveau tarif.

**OccurrenceOverride** — exception sur une occurrence précise

`subscription_id` · `date_theorique` · `montant_cents` · `statut` (`previsionnel` \| `realise`) · `exclu_de_estimation` (bool)

C'est la seule chose stockée à propos d'une occurrence. La clé est le couple (`subscription_id`, `date_theorique`).

**Snapshot**

`date` · `account_id` · `valeur_cents`

**Instrument** *(phase 2)*

`id` · `type` (`action` \| `etf` \| `piece` \| `lingot`) · `nom` · `ticker?` · `isin?` · `devise` · `poids_or_fin_g?` · `poids_brut_g?` · `prime_pct?`

**Holding** *(phase 2)*

`id` · `account_id` · `instrument_id` · `quantite` · `pru_cents` · `date_achat` · `reference_facture?`

---

## 5. Règles métier

### 5.1 Projection de solde

Calculée **par compte**, pas globalement. Un solde global laisse l'épargne masquer un découvert sur le courant.

```
solde(J) = solde_actuel
         + Σ rentrées récurrentes entre aujourd'hui et J
         − Σ échéances entre aujourd'hui et J
```

- Le montant d'un abonnement est celui valide **à la date de l'échéance**, pas le montant courant.
- Le montant d'une récurrence à montant estimé suit la résolution décrite en 5.6.
- Retourner la série jour par jour, plus le **point bas** et sa date.

**La certitude n'est pas uniforme dans le temps.** Tant qu'aucune occurrence à montant estimé n'a été franchie, la projection ne dépend d'aucune estimation. Retourner donc aussi la date de la première occurrence estimée, et une borne basse et haute au-delà. L'interface marque cette frontière : trait plein avant, trait pointillé et fourchette après. Une courbe d'apparence homogène sur tout le mois ment sur ce qu'elle sait.

La projection reste une prédiction. L'interface doit toujours montrer de quoi elle est composée (« 7 échéances connues »). Un chiffre faussement précis est pire qu'une fourchette honnête.

### 5.2 Reste à vivre

```
reste_a_vivre = solde_courant_actuel
              − Σ échéances jusqu'à la prochaine rentrée
              − réserve (paramétrée par l'utilisateur)
```

C'est le chiffre principal de l'accueil : le seul qui sera consulté quotidiennement.

**Utiliser la borne basse pour toute rentrée estimée, jamais l'estimation centrale.** Le sens de l'erreur compte : surestimer un salaire dans un chiffre censé répondre à « combien je peux dépenser » pousse exactement vers la mauvaise décision. Le patrimoine et les graphiques peuvent, eux, afficher l'estimation centrale.

### 5.3 Décalage jour ouvré

1. Calculer la date théorique depuis la règle.
2. Si elle tombe un samedi, un dimanche ou un jour férié, appliquer `regle_weekend`.
3. **Stocker la théorique, afficher la décalée.**

Jours fériés français : les calculer, pas les embarquer en table. Onze jours — 1er janvier, lundi de Pâques, 1er mai, 8 mai, Ascension, lundi de Pentecôte, 14 juillet, 15 août, 1er novembre, 11 novembre, 25 décembre. Pâques via l'algorithme de Meeus, puis Ascension à +39 jours et lundi de Pentecôte à +50. Une trentaine de lignes, zéro dépendance, fonctionne hors ligne et pour toutes les années.

### 5.4 Mois trop court

Un abonnement au 31 dans un mois de 30 jours applique `regle_mois_court`. Le comportement par défaut est `dernier_jour`.

### 5.5 Réconciliation hebdomadaire

Mécanisme central : il remplace la saisie exhaustive, qui est la raison pour laquelle ce type d'application est abandonné au bout de trois semaines.

1. L'utilisateur saisit le solde réel de son compte.
2. `écart = solde_réel − solde_calculé`
3. Créer une transaction de cet écart, label « Non catégorisé », `origine = reconciliation`.
4. Le solde est recalé.

Labelliser une dépense devient un bonus, plus une condition de validité de l'ensemble.

### 5.6 Montants estimés et régularisation

Concerne toute récurrence en `montant_mode = estime` : salaire variable, électricité, gaz, revenus irréguliers. Un seul mécanisme, pas de traitement spécifique au salaire.

**Résolution du montant d'une occurrence**, par priorité décroissante :

1. **Réalisé** — un `OccurrenceOverride` de statut `realise` existe. Il gagne toujours.
2. **Prévisionnel saisi** — un `OccurrenceOverride` de statut `previsionnel` existe pour cette date.
3. **Estimation automatique** — calculée sur les `estimation_fenetre` dernières occurrences réalisées.

**Calcul de l'estimation**

- Utiliser la **médiane, pas la moyenne**. Un treizième mois ou une prime exceptionnelle tire la moyenne vers le haut et rend les six mois suivants trop optimistes ; la médiane l'absorbe.
- Ignorer les occurrences marquées `exclu_de_estimation`.
- S'il existe moins d'occurrences réalisées que la fenêtre, calculer sur ce qui existe.
- S'il n'en existe aucune, ne rien estimer : demander une saisie manuelle. Le cas se produit au premier mois, et l'onboarding la demande déjà.
- Retourner aussi le **min et le max** de la fenêtre : ce sont les bornes utilisées par la projection et par le reste à vivre.

**Régularisation de fin de mois**

Quand le montant réel est connu, l'utilisateur le saisit et l'occurrence passe en statut `realise`.

**Cette opération remplace le montant de l'occurrence, elle ne crée pas de seconde ligne.** C'est la différence avec la réconciliation hebdomadaire (5.5), qui crée bien une transaction parce qu'elle représente des dépenses réellement non saisies. Ici il n'existe qu'un salaire, donc une seule ligne. Afficher l'écart entre l'estimation et le réel à titre d'information, sans le matérialiser en écriture.

La valeur réalisée entre ensuite dans la fenêtre glissante et affine les estimations suivantes.

### 5.7 Valorisation de l'or *(phase 2)*

```
valeur = spot_eur_par_gramme × poids_or_fin_g × quantite × (1 + prime_pct)
```

| Pièce | Poids brut | Titre | Or fin |
|---|---|---|---|
| Souverain (George V) | 7,98805 g | 916,7 ‰ | **7,3224 g** |
| Napoléon 20 F | 6,4516 g | 900 ‰ | **5,806 g** |

Toujours valoriser sur l'**or fin**, jamais sur le poids brut : l'écart est de 9 % sur un souverain. Le poids brut ne sert qu'au contrôle à la balance.

La prime est stockée par type de pièce et modifiable par l'utilisateur. Elle évolue lentement (5 à 15 % en temps normal, jusqu'à 80 % en période de crise) et ne doit jamais être figée dans le code. Afficher « valeur indicative ».

---

## 6. Écrans

1. **Accueil** — reste à vivre en gros, solde projeté du courant, alerte de point bas, prochaines échéances.
2. **Comptes** — patrimoine total, comptes groupés bancaire / investissement, accès au virement.
3. **Calendrier** — grille mensuelle avec pastilles d'échéance, courbe de solde projeté en dessous.
4. **Ajout rapide** — montant d'abord, bascule entrée / sortie / virement, compte, label, raccourcis fréquents en un tap.
5. **Abonnements** — coût mensuel et annuel cumulé, liste triée, alerte sur changement de tarif.
6. **Formulaire d'abonnement** — règle de récurrence complète, avec aperçu des trois prochaines échéances (dates décalées incluses).
7. **Dépenses par label** — total du mois, barres proportionnelles, suivi de budget.
8. **Détail de compte** — relevés pour un compte `saisi`, positions pour un compte `calculé`.

Plus un écran **Réglages** : PIN, réserve du reste à vivre, export, import, gestion des labels.

Navigation : cinq onglets maximum en barre basse.

---

## 7. Verrouillage local

Ce n'est pas une authentification, c'est un verrou d'appareil : empêcher quelqu'un qui emprunte le téléphone de lire les données.

- Code PIN à l'ouverture.
- Clé dérivée du PIN via WebCrypto (PBKDF2 ou Argon2), sel stocké en clair localement.
- Contenu d'IndexedDB chiffré avec cette clé.

Sans chiffrement, le PIN est un rideau qu'on contourne en ouvrant les outils de développement. **Conséquence assumée : PIN perdu, données perdues, sans récupération.** Le prévenir clairement à la configuration.

---

## 8. Sauvegarde

Sans serveur, l'export est le seul filet. Téléphone cassé égale tout perdu.

- Bouton d'export produisant un JSON — **qui est le journal d'événements lui-même**.
- Import par fusion, jamais par écrasement : union sur `id` d'événement.
- Rappel mensuel dans l'application.

---

## 9. Phase 1 / Phase 2

### Phase 1 — à livrer

Comptes en mode `saisi` uniquement · transactions · virements · labels et budgets · abonnements avec récurrence complète · projection par compte · reste à vivre · calendrier · réconciliation hebdomadaire · PIN et chiffrement · export / import manuel · PWA installable.

Le PEA et l'or existent dès la phase 1, en mode `saisi` : l'utilisateur tape ce que son courtier affiche une fois par mois. **Aucun service externe, aucune clé API, aucun compte à créer.**

### Phase 2 — ensuite

- **Mode `calculé`** : instruments, positions, cours via Twelve Data (plan gratuit : 8 crédits/minute, 800/jour), cache partagé par ticker, TTL d'une heure en séance uniquement. Enfermer l'appel derrière une unique fonction `getPrice(instrument)` pour rendre le fournisseur remplaçable. Vérifier en premier que les appels depuis un navigateur ne sont pas bloqués.
- **Synchronisation automatique** via un second dépôt GitHub **privé**, journal chiffré écrit par l'API contents, jeton à portée restreinte saisi par appareil. Passer du manuel à l'automatique revient à remplacer un bouton par un appel réseau : le format ne change pas.
- Import CSV de relevés bancaires, avec détection de doublons.
- Suivi fiscal : enregistrer date d'achat, prix payé et référence de facture nominative. Ne pas calculer l'impôt, seulement capter la donnée — sans facture nominative, l'option pour le régime de la plus-value réelle devient impossible à exercer plus tard.
- Vue à douze mois, pour faire apparaître les charges annuelles (taxe foncière, assurances, régularisations).

---

## 10. Pièges connus

- **IndexedDB peut être purgé** par Safari. PWA installée + `navigator.storage.persist()`.
- **Jamais de flottant** sur les montants.
- **Ne pas matérialiser** les échéances futures.
- **Les virements sortent des totaux de dépenses.** L'erreur classique du multi-comptes.
- **Normaliser la casse des labels** à l'enregistrement, sinon « courses », « Courses » et « course » deviennent trois lignes.
- `inputmode="decimal"` sur les champs montant, pour ouvrir le pavé numérique.
- **Ne pas coder l'information uniquement par la couleur.** Le rouge et le vert doivent être doublés d'un signe ou d'une icône.
- **Aucun secret dans le dépôt de code**, qui est public.
- **Sans cron**, les instantanés se déclenchent à l'ouverture de l'application. La courbe aura des trous les semaines sans ouverture : relier les points existants, ne pas inventer de valeurs.

---

## 11. Démarrage à froid

Le jour 1, l'application est vide et donc inutile. Ne rien demander d'exhaustif. L'onboarding minimal :

1. Créer le compte courant et saisir son solde.
2. Saisir le salaire en tant que rentrée récurrente. Proposer le mode `estime` et demander un montant de départ, puisqu'aucun historique n'existe encore.
3. Saisir trois abonnements.

La projection et le reste à vivre fonctionnent déjà avec ça. Tout le reste vient progressivement.
