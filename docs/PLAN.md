# Plan d'action — application de gestion d'argent personnelle

Ce document découpe l'implémentation décrite dans `docs/CONTEXTE.md`. Il ne
re-débat aucune décision arbitrée : il les ordonne, comble les trous du modèle
et fixe ce qui manquait pour pouvoir coder sans ambiguïté.

---

## 0. État des lieux

- Dépôt `SanjethanSellappah/Ingenious` : **vide**, aucun commit, aucune branche distante.
- Branche de travail : `claude/webapp-action-plan-0d67q9`.
- Toolchain disponible : Node 22.22, npm 10.9, pnpm 10.33.

---

## 1. Principes d'exécution

1. **Le noyau avant l'écran.** Tout ce qui est arithmétique (montants, dates,
   récurrences, projection, estimation) est écrit en TypeScript pur, sans React
   et sans IO, et couvert par des tests unitaires **avant** qu'un composant
   n'existe. C'est là que se logent les bugs coûteux : un décalage de jour ouvré
   faux se voit six mois plus tard.
2. **Un lot = un commit vérifiable.** Chaque lot se termine par un livrable
   qu'on peut constater (tests verts, page déployée, écran utilisable).
3. **L'export existe avant la première vraie saisie.** Tant que le bouton
   d'export n'est pas livré, ne pas entrer de données réelles : sans filet,
   la perte est totale.
4. **Vocabulaire du contexte conservé tel quel** (`solde_cents`, `jour_du_mois`,
   `regle_weekend`…). Traduire les champs en anglais introduirait une couche de
   correspondance mentale et donc des bugs ; le code parle français sur le
   domaine, anglais sur la technique.

---

## 2. Découpage en lots

### Lot 0 — Fondations et déploiement (livrable : page blanche installable en ligne)

- Vite + React + TypeScript, ESLint + Prettier, Vitest.
- `base: '/Ingenious/'` dans la config Vite (dépôt de projet, pas de domaine).
- `vite-plugin-pwa` : `registerType: 'autoUpdate'`, `start_url` et `scope`
  alignés sur la base, manifeste, icônes.
- Routage en **HashRouter** : GitHub Pages ne sait pas réécrire les URL vers
  `index.html`, et un `404.html` de contournement casse le partage de lien.
- Workflow GitHub Actions `deploy-pages` sur push de la branche par défaut.
- **Definition of done** : l'URL Pages répond, l'app s'installe sur l'écran
  d'accueil du téléphone, `npm run test` passe (à vide).

### Lot 1 — Noyau pur, entièrement testé (livrable : `src/core/` vert)

Aucun React, aucun IO. Chaque module a son `*.test.ts`.

- `money.ts` — entiers centimes, parsing FR (`12,50` et `12.50`), formatage,
  un unique `roundCents` utilisé partout.
- `civilDate.ts` — dates métier en chaînes `YYYY-MM-DD`, jamais d'objet `Date`
  ni d'epoch (voir §4). Arithmétique mois/jours, fin de mois, comparaisons.
- `holidaysFR.ts` — les 11 jours fériés, Pâques par Meeus, Ascension +39,
  lundi de Pentecôte +50. Zéro dépendance, toutes années.
- `recurrence.ts` — génération des occurrences théoriques entre deux dates
  (`mensuel`/`trimestriel`/`annuel`/`personnalise`, `intervalle`,
  `jour_du_mois`, `regle_mois_court`), puis `dateAffichee()` appliquant
  `regle_weekend`. **La théorique est la clé, la décalée est un affichage.**
- `estimation.ts` — médiane sur la fenêtre glissante des occurrences réalisées,
  exclusions respectées, retour `{ median, min, max, echantillon }`.
- `projection.ts` — série jour par jour **par compte**, point bas et sa date,
  date de la première occurrence estimée, bornes basse et haute au-delà.
- `resteAVivre.ts` — solde courant − échéances jusqu'à la prochaine rentrée −
  réserve, **avec la borne basse sur toute rentrée estimée**.

**Definition of done** : cas limites couverts — 31 février, abonnement au 31 en
février, échéance un 1er mai, année bissextile, fenêtre d'estimation vide,
fenêtre de taille paire, changement de tarif à cheval sur une échéance.

### Lot 2 — Persistance et chiffrement (livrable : un journal qui survit au rechargement)

- `events.ts` — union discriminée de tous les types d'événements, avec
  validation à l'écriture **et à la lecture** (un import corrompu ne doit pas
  faire planter le pliage).
- Dexie : deux tables seulement. `events` (blobs chiffrés, clé `id`) et `meta`
  (sel, paramètres de dérivation, DEK enveloppée, identifiant d'appareil).
  Le journal n'est jamais interrogé par contenu, donc le chiffrement ne coûte
  aucun index : on déchiffre tout au démarrage et on plie en mémoire.
- `crypto.ts` — **chiffrement à enveloppe** (voir §3.1) : PBKDF2-SHA256 sur le
  PIN → clé de chiffrement de clé, qui enveloppe une clé de données aléatoire.
  AES-GCM, IV aléatoire par enregistrement.
- Chiffreur « identité » tant qu'aucun PIN n'est configuré : c'est le
  comportement réel avant l'onboarding, et ça garde le débogage lisible.
- `navigator.storage.persist()` au premier lancement, résultat journalisé et
  affiché dans Réglages (voir §5 pour le cas iOS).
- `repository.ts` — `append()`, `loadAll()`, `exportJson()`, `importJson()`
  (union sur `id`, jamais d'écrasement).

**Definition of done** : on ajoute des événements, on recharge, tout est là ;
on exporte, on vide la base, on réimporte, l'état est identique.

### Lot 3 — État dérivé (livrable : sélecteurs testés sur journal synthétique)

- Pliage du journal trié par `ts` puis `id` → comptes, transactions, virements,
  labels, abonnements, historique de prix, exceptions, instantanés.
- Résolution du montant d'une occurrence : réalisé > prévisionnel > estimation.
- Prix d'abonnement valide **à la date de l'échéance**, pas le prix courant.
- Invariants du §4 vérifiés par tests.

### Lot 4 — Coquille applicative (livrable : navigation et verrou)

- Cinq onglets en barre basse : Accueil · Calendrier · Ajout · Comptes · Réglages.
- Écran de verrouillage PIN, re-verrouillage sur `visibilitychange` après délai.
- Jetons de design, composants `Montant` (signe + icône, jamais la couleur
  seule), `SaisieMontant` (`inputmode="decimal"`, virgule acceptée).
- Onboarding en 3 étapes : compte courant + solde, salaire en rentrée estimée
  avec montant de départ, trois abonnements.

### Lot 5 — Écrans, par ordre d'utilité quotidienne

1. **Accueil** — reste à vivre en gros, solde projeté du courant, alerte point
   bas, prochaines échéances, et **de quoi le chiffre est composé**
   (« 7 échéances connues »), frontière trait plein / pointillé.
2. **Ajout rapide** — montant d'abord, bascule entrée/sortie/virement.
3. **Réconciliation hebdomadaire** — saisie du solde réel, écart matérialisé en
   transaction « Non catégorisé », `origine = reconciliation`.
4. **Comptes** — patrimoine, regroupement bancaire/investissement, virement.
5. **Abonnements** + formulaire complet avec aperçu des trois prochaines
   échéances en dates décalées.
6. **Calendrier** — grille mensuelle, pastilles, courbe en dessous.
7. **Dépenses par label** — total du mois, barres, suivi de budget.
8. **Détail de compte** — relevés d'un compte `saisi`.
9. **Réglages** — PIN, réserve, export, import, labels, état du stockage.

### Lot 6 — Filet et automatismes

- Instantané quotidien par compte déclenché à l'ouverture ; trous reliés, jamais
  comblés par des valeurs inventées.
- Rappel mensuel de sauvegarde.
- Régularisation de fin de mois : le réel **remplace** le montant de
  l'occurrence, l'écart est affiché sans être écrit.

### Lot 7 — Finitions

Accessibilité (aucune information par la couleur seule, tailles de cible,
contrastes), comportement hors ligne, performance du pliage, `README`.

---

## 3. Décisions techniques à acter

Elles complètent le contexte sans le contredire. Recommandation par défaut
retenue sauf avis contraire.

### 3.1 Chiffrement à enveloppe dès la phase 1 — *recommandé*

Dériver directement la clé de chiffrement depuis le PIN pose deux problèmes qui
n'apparaissent qu'au moment où il est coûteux de les résoudre : changer de PIN
imposerait de re-chiffrer toute la base, et la synchronisation entre deux
appareils (phase 2) exigerait le même PIN **et** le même sel, ce qui n'est pas
tenable. Une clé de données aléatoire, enveloppée par la clé dérivée du PIN,
coûte vingt lignes de plus aujourd'hui et rend les deux cas triviaux : changer
le PIN ré-enveloppe la clé, et un second appareil reçoit la clé de données par
un code de récupération affiché à l'écran.

### 3.2 Paramètres de dérivation

PBKDF2-SHA256, WebCrypto, pas d'Argon2 (qui imposerait un WASM). Itérations
calibrées à ~500 ms sur le téléphone, plancher 600 000. **À dire franchement à
la configuration** : un PIN à 4 chiffres, c'est 10 000 possibilités — le
chiffrement protège d'un curieux qui ouvre les outils de développement, pas d'un
attaquant outillé qui a le téléphone. Recommander 6 chiffres. Temporisation
exponentielle sur échec, **pas d'effacement automatique** après N essais : avec
un code perdu et aucune récupération, ce serait un piège.

### 3.3 Export en clair par défaut — *recommandé*

Le journal exporté est la seule chose qui survit à un téléphone cassé. En clair,
il reste lisible et réimportable dans dix ans avec n'importe quoi. Option
d'export chiffré par phrase de passe en supplément, jamais à la place.

### 3.4 État applicatif

Un magasin minimal (`useSyncExternalStore` sur un module, ou Zustand) contenant
l'état déplié, recalculé à chaque `append()`. Pas de Redux : le journal joue
déjà ce rôle.

---

## 4. Compléments au modèle de données

### 4.1 Types d'événements manquants

La liste du contexte ne couvre pas certaines écritures pourtant nécessaires :

- `occurrence.overridden` / `occurrence.override_cleared` — **le plus important** :
  les `OccurrenceOverride` sont décrits comme entité mais aucun événement ne
  permet de les créer. Charge utile : `subscription_id`, `date_theorique`,
  `montant_cents`, `statut`, `exclu_de_estimation`.
- `transfer.updated` / `transfer.deleted` — un virement se corrige comme une
  transaction.
- `label.archived` — le champ `archived_at` existe sans événement pour le poser.
- `account.unarchived` — symétrique de `account.archived`.
- `settings.updated` — la réserve du reste à vivre doit vivre dans le journal,
  sinon elle ne suit pas l'export.
- `instrument.created` / `instrument.updated` — phase 2, à réserver maintenant.

### 4.2 Dates : chaînes civiles, jamais d'objet `Date`

Une date métier est une chaîne `YYYY-MM-DD`. Un `Date` ou un epoch pour « le 3
du mois » finit par se décaler d'un jour selon le fuseau et l'heure de saisie —
c'est le bug classique de ce type d'application, et il est silencieux.
Seul `Event.ts` est un epoch, parce que c'est un instant, pas une date.

### 4.3 `Snapshot` et `BalanceEntry` ne font pas doublon

- `BalanceEntry` = ce que **l'utilisateur a relevé** (événement `account.balance_set`).
- `Snapshot` = ce que **l'application a constaté** à l'ouverture, pour la courbe
  de patrimoine (événement `snapshot.recorded`).

Les confondre reviendrait soit à réécrire le passé, soit à perdre la courbe les
semaines sans relevé.

### 4.4 Invariant de solde d'un compte `saisi`

```
solde(compte) = dernier account.balance_set à la date D
              + Σ transactions et virements de date > D
```

C'est ce qui rend la réconciliation cohérente : elle pose un nouveau
`balance_set` **et** écrit l'écart en transaction, si bien que le calcul et le
relevé se rejoignent au lieu de diverger.

### 4.5 Médiane sur fenêtre paire

Moyenne des deux valeurs centrales, arrondie au centime le plus proche par
`roundCents`. À figer pour que les tests soient déterministes.

---

## 5. Réponse au point laissé ouvert : persistance sur iOS

Le contexte demandait de vérifier au moment de coder. `navigator.storage.persist()`
n'accorde rien sur Safari iOS : la protection réelle contre la purge après sept
jours d'inactivité, c'est **l'installation sur l'écran d'accueil**. L'appel reste
à faire (il est utile sur Chrome et sur macOS), mais l'onboarding doit insister
sur l'installation, et Réglages doit afficher l'état obtenu plutôt que de le
supposer. Conséquence assumée : l'export mensuel n'est pas un confort, c'est
la vraie sauvegarde.

---

## 6. Arborescence cible

```
src/
  core/        montants, dates civiles, fériés, récurrence, estimation,
               projection, reste à vivre — pur, testé, sans React
  domain/      événements, pliage, sélecteurs, invariants
  storage/     Dexie, chiffrement, dépôt, export/import, persistance
  app/         magasin, routage, verrou PIN, onboarding
  screens/     un dossier par écran
  ui/          composants partagés et jetons de design
```

---

## 7. Hors périmètre phase 1

Mode `calculé` et cours de bourse, synchronisation automatique par dépôt privé,
import CSV, suivi fiscal, vue à douze mois. Le PEA et l'or existent dès la
phase 1 **en mode `saisi`**.
