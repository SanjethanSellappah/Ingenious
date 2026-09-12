# Plan d'action — application de gestion d'argent personnelle

Ce document découpe l'implémentation décrite dans `docs/CONTEXTE.md`. Il ne
re-débat aucune décision arbitrée : il les ordonne, comble les trous du modèle,
et isole en §2 les quelques points qui doivent être tranchés avant d'écrire du
code.

---

## 0. État des lieux — 12 septembre 2026

**Dépôt public `SanjethanSellappah/Ingenious`** (code, GitHub Pages)

- Branche `main` créée, lots 0 et 1 livrés dessus.
- Le workflow Pages passe et publie : lint, tests et build verts, déploiement
  réussi. Reste à faire dans l'interface GitHub : désigner `main` comme branche
  par défaut (§7).

**Dépôt privé `SanjethanSellappah/Ingenious-private`** (données)

- Journal vierge et règles du dépôt en place. Rien d'autre tant que l'export
  n'existe pas (lot 2).

**Toolchain** : Node 22.22, npm 10.9. TypeScript 6.0.3 — pas la 7.0.2, que
`typescript-eslint` ne supporte pas encore (plafond `<6.1`).

---

## 1. Principes d'exécution

1. **Le noyau avant l'écran.** Tout ce qui est arithmétique — montants, dates,
   récurrences, projection, estimation — est écrit en TypeScript pur, sans React
   et sans IO, et couvert par des tests unitaires **avant** qu'un composant
   n'existe. C'est là que se logent les bugs coûteux : un décalage de jour ouvré
   faux ne se voit que six mois plus tard, et par un chiffre faux, pas par une
   erreur.
2. **Un lot = un livrable constatable.** Tests verts, page déployée, écran
   utilisable. Pas de lot qui ne se vérifie que par relecture.
3. **L'export existe avant la première vraie saisie.** Tant que le bouton
   d'export n'est pas livré, ne pas entrer de données réelles : sans filet, la
   perte est totale et silencieuse.
4. **Vocabulaire du contexte conservé tel quel** (`solde_cents`, `jour_du_mois`,
   `regle_weekend`…). Le code parle français sur le domaine, anglais sur la
   technique. Traduire les champs ajouterait une table de correspondance mentale,
   donc des bugs.
5. **Rien ne se calcule sur un `Date`.** Voir §4.2 : une date métier est une
   chaîne `YYYY-MM-DD`.

---

## 2. Arbitrages à confirmer

Ce sont les seuls points qui demandent une réponse avant de coder. Chacun a une
recommandation ; l'absence de réponse vaut acceptation de la recommandation.

### 2.1 Une occurrence réalisée ne crée pas de `Transaction` — *recommandé*

Le contexte dit qu'une occurrence « devient une transaction une fois réellement
passée » (§3.3) mais aussi que la régularisation « remplace le montant de
l'occurrence, elle ne crée pas de seconde ligne » (§5.6). Écrire à la fois un
`OccurrenceOverride` et une `Transaction` porterait le même montant à deux
endroits : toute correction ultérieure devrait les modifier ensemble, et le jour
où l'une des deux écritures manque, le solde diverge sans que rien ne le signale.

Retenu : **réaliser une occurrence n'écrit qu'un seul événement**,
`occurrence.overridden` en statut `realise`. C'est l'état dérivé qui la présente
comme un mouvement (§4.4), à sa date décalée, avec le label et le compte de
l'abonnement. « Devient une transaction » est honoré au niveau où la phrase a du
sens — ce que l'utilisateur voit — sans dupliquer la source de vérité.

Les champs `subscription_id` et `origine = recurrence` de `Transaction` restent
au modèle : ils serviront en phase 2 à rattacher une ligne de relevé importée en
CSV à l'abonnement qui l'explique.

### 2.2 Ancre de solde et départage à la journée — *recommandé*

Voir l'invariant en §4.3. Deux mouvements le même jour que la réconciliation
doivent être départagés par l'horodatage d'événement, sinon la saisie faite après
une réconciliation du même jour est ignorée du solde. Silencieux, et impossible à
diagnostiquer plus tard.

### 2.3 La borne pessimiste dépend du sens — *implémenté*

Le contexte fixe l'usage de la borne basse pour une **rentrée** estimée (§5.2).
Par symétrie, une **dépense** estimée doit être prise à son **maximum** dans la
même borne : c'est le même principe — le sens de l'erreur compte — appliqué à
l'autre signe.

À l'écriture, la règle s'est révélée plus simple que son énoncé. Les montants
étant signés, « la plus maigre des rentrées » et « la plus grosse des dépenses »
sont la même chose : **la plus petite valeur signée**. La borne basse accumule
donc toujours le minimum, la borne haute toujours le maximum, sans distinguer
les deux sens — donc sans pouvoir se tromper de côté sur l'un des deux.

### 2.4 Les occurrences échues non confirmées n'entrent nulle part — *recommandé*

Une échéance dont la date décalée est passée sans qu'aucun `realise` n'ait été
saisi : l'application ne sait pas si elle est passée en banque. Elle **ne l'ajoute
pas au solde** et **ne la projette pas** — la projection démarre strictement après
aujourd'hui. Elle apparaît dans une liste « à confirmer » sur l'accueil, qui est
le geste qui recale le solde. Inventer le débit serait mentir, l'ignorer sans le
dire aussi.

### 2.5 Reste à vivre sans rentrée connue — *recommandé*

La formule §5.2 suppose une prochaine rentrée. S'il n'y en a aucune dans les
60 jours, l'horizon retenu est la fin du mois courant, et l'écran l'écrit
explicitement (« aucune rentrée connue d'ici le 30 septembre ») au lieu
d'afficher un chiffre dont la portée est invisible.

### 2.6 Chiffrement à enveloppe dès la phase 1 — *recommandé*

Dériver la clé de chiffrement directement du PIN crée deux problèmes qui
n'apparaissent qu'au moment où ils coûtent cher : changer de PIN imposerait de
re-chiffrer toute la base, et la synchronisation entre deux appareils (phase 2)
exigerait le même PIN **et** le même sel. Une clé de données aléatoire, enveloppée
par la clé dérivée du PIN, coûte vingt lignes de plus aujourd'hui : changer le PIN
ré-enveloppe la clé, et un second appareil reçoit la clé de données par un code de
récupération affiché à l'écran.

### 2.7 Export en clair par défaut — *recommandé*

Le journal exporté est la seule chose qui survit à un téléphone cassé. En clair,
il reste lisible et réimportable dans dix ans avec n'importe quel outil. Un export
chiffré par phrase de passe peut s'ajouter en option, jamais se substituer.

### 2.8 Paramètres de dérivation, et ce que le PIN protège vraiment

PBKDF2-SHA256 via WebCrypto, pas d'Argon2 (qui imposerait un WASM). Itérations
calibrées à ~500 ms sur le téléphone, plancher 600 000. **À écrire noir sur blanc
à la configuration** : un PIN à 4 chiffres, c'est 10 000 possibilités — le
chiffrement protège d'un curieux qui ouvre les outils de développement, pas d'un
attaquant outillé qui a le téléphone en main. Recommander 6 chiffres. Temporisation
exponentielle sur échec, et **pas d'effacement automatique** après N essais : avec
un PIN perdu et aucune récupération, l'effacement serait un piège, pas une
protection.

---

## 3. Découpage en lots

### Lot 0 — Fondations et déploiement ✅
*Livrable : une page blanche installable, en ligne.*

- Vite + React + TypeScript, ESLint + Prettier, Vitest.
- `base: '/Ingenious/'` dans la configuration Vite (dépôt de projet, pas de
  domaine dédié).
- `vite-plugin-pwa` : `registerType: 'autoUpdate'`, `start_url` et `scope`
  alignés sur la base, manifeste, icônes 192 et 512.
- Routage en **HashRouter** : GitHub Pages ne réécrit pas les URL vers
  `index.html`, et le contournement par `404.html` casse le partage de lien.
- Workflow GitHub Actions de déploiement Pages sur push de `main`.
- `clock.ts` : un unique `aujourdhui()` retournant la date civile locale,
  injectable — c'est ce qui rend les tests de projection déterministes.

**Terminé quand** : l'URL Pages répond, l'app s'installe sur l'écran d'accueil du
téléphone, `npm run test` passe à vide.

*Livré.* Vérifié en local sur un contexte mobile : le service worker contrôle la
page, l'application se recharge réseau coupé, une route de hash inconnue rend la
même page. Reste la vérification qui dépend de GitHub : l'URL Pages, une fois les
deux réglages du §7 faits.

### Lot 1 — Noyau pur, entièrement testé ✅
*Livrable : `src/core/` vert.*

Aucun React, aucun IO. Chaque module a son `*.test.ts`.

- `money.ts` — entiers centimes, parsing FR (`12,50` et `12.50`), formatage, un
  unique `roundCents` utilisé partout.
- `civilDate.ts` — dates métier en chaînes `YYYY-MM-DD`. Arithmétique jours/mois,
  fin de mois, comparaisons, jamais de `Date` intermédiaire.
- `holidaysFR.ts` — les 11 fériés, Pâques par Meeus, Ascension +39, lundi de
  Pentecôte +50. Zéro dépendance, toutes années.
- `recurrence.ts` — occurrences théoriques entre deux dates (`mensuel`,
  `trimestriel`, `annuel`, `personnalise`, `intervalle`, `jour_du_mois`,
  `regle_mois_court`), puis `dateAffichee()` appliquant `regle_weekend`.
  **La théorique est la clé, la décalée est un affichage.**
- `estimation.ts` — médiane sur la fenêtre glissante des occurrences réalisées,
  exclusions respectées, retour `{ mediane, min, max, echantillon }`.
  Fenêtre paire : moyenne des deux valeurs centrales, arrondie par `roundCents`.
- `projection.ts` — série jour par jour **par compte**, point bas et sa date,
  date de la première occurrence estimée, bornes basse et haute au-delà (§2.3).
  Prend aussi les transactions futures ponctuelles déjà saisies, pas seulement
  les récurrences.
- `resteAVivre.ts` — solde courant − échéances jusqu'à la prochaine rentrée −
  réserve, borne pessimiste sur tout montant estimé, horizon de repli §2.5.

**Terminé quand** ces cas passent : 31 février, abonnement au 31 en février,
échéance un 1er mai, échéance un samedi avec chacune des trois règles, année
bissextile, fenêtre d'estimation vide, fenêtre de taille paire, changement de
tarif à cheval sur une échéance, projection sans aucune rentrée.

*Livré*, 177 tests. Deux ajouts par rapport à la liste ci-dessus :

- `prixAbonnement.ts` — le montant valide à une date. Il était réclamé par la
  liste des cas à couvrir sans figurer dans les modules ; le placer dans le
  noyau plutôt que dans le pliage rend le lot 3 plus mince.
- `echeances.ts` — le point de jonction : une récurrence, ses prix, ses
  exceptions et ses occurrences réalisées entrent, des échéances datées, signées
  et encadrées sortent. C'est ce que consomment la projection et le reste à
  vivre, et c'est ce que les écrans appelleront.

Ce qui ne peut pas être valorisé — un abonnement estimé sans historique, une
échéance antérieure à tout tarif connu — est rendu à part, jamais compté zéro :
l'écran doit le réclamer, pas faire comme si le montant était nul.

### Lot 2 — Persistance et chiffrement
*Livrable : un journal qui survit au rechargement.*

- `events.ts` — union discriminée de tous les types d'événements, avec validation
  à l'écriture **et à la lecture** : un import corrompu ne doit pas faire planter
  le pliage, il doit rejeter l'événement fautif en le nommant.
- Dexie, deux tables seulement : `events` (enregistrements chiffrés, clé `id`) et
  `meta` (sel, paramètres de dérivation, clé de données enveloppée, identifiant
  d'appareil). Le journal n'est jamais interrogé par contenu, donc le chiffrement
  ne coûte aucun index : on déchiffre tout au démarrage et on plie en mémoire.
- `crypto.ts` — chiffrement à enveloppe (§2.6), AES-GCM, IV aléatoire par
  enregistrement.
- Chiffreur « identité » tant qu'aucun PIN n'est configuré : c'est l'état réel
  avant l'onboarding, et ça garde le débogage lisible.
- `navigator.storage.persist()` au premier lancement, résultat journalisé et
  affiché dans Réglages (§5).
- `repository.ts` — `append()`, `loadAll()`, `exportJson()`, `importJson()`
  (union sur `id`, jamais d'écrasement).

**Terminé quand** : on ajoute des événements, on recharge, tout est là ; on
exporte, on vide la base, on réimporte, l'état dérivé est identique au bit près.

### Lot 3 — État dérivé
*Livrable : sélecteurs testés sur journal synthétique.*

- Pliage du journal trié par `ts` puis `id` → comptes, mouvements, labels,
  abonnements, historique de prix, exceptions, instantanés.
- Vue **mouvement** unifiée (§4.4) : transactions, virements, occurrences
  réalisées. Les virements y portent leur nature et sont exclus par construction
  de tout total de dépenses.
- Résolution du montant d'une occurrence : réalisé > prévisionnel > estimation.
- Prix d'abonnement valide **à la date de l'échéance**, jamais le prix courant.
- Invariant de solde §4.3 vérifié par tests, réconciliation comprise.

### Lot 4 — Coquille applicative
*Livrable : navigation et verrou.*

- Cinq onglets en barre basse : Accueil · Calendrier · Ajout · Comptes · Réglages.
- Écran de verrouillage PIN, re-verrouillage sur `visibilitychange` après délai.
- Jetons de design ; composant `Montant` (signe et icône, jamais la couleur
  seule) ; `SaisieMontant` (`inputmode="decimal"`, virgule acceptée).
- Onboarding en 3 étapes : compte courant et son solde ; salaire en rentrée
  estimée avec un montant de départ ; trois abonnements. Plus l'invitation à
  installer sur l'écran d'accueil, qui est la vraie protection contre la purge.

### Lot 5 — Écrans, par ordre d'utilité quotidienne

1. **Accueil** — reste à vivre en gros ; solde projeté du courant ; alerte de
   point bas ; prochaines échéances ; **occurrences à confirmer** (§2.4) ; et de
   quoi le chiffre est composé (« 7 échéances connues, 2 estimées »), avec la
   frontière trait plein / pointillé.
2. **Ajout rapide** — montant d'abord, bascule entrée / sortie / virement.
3. **Réconciliation hebdomadaire** — saisie du solde réel, écart matérialisé en
   transaction « Non catégorisé », `origine = reconciliation`, nouvelle ancre.
4. **Comptes** — patrimoine, regroupement bancaire / investissement, virement.
5. **Abonnements** et formulaire complet, avec aperçu des trois prochaines
   échéances en dates décalées.
6. **Calendrier** — grille mensuelle, pastilles d'échéance, courbe en dessous.
7. **Dépenses par label** — total du mois, barres proportionnelles, budget.
8. **Détail de compte** — relevés d'un compte `saisi`.
9. **Réglages** — PIN, réserve, export, import, labels, état du stockage.

### Lot 6 — Filet et automatismes

- Instantané quotidien par compte déclenché à l'ouverture ; les trous se relient,
  ne se comblent jamais par des valeurs inventées.
- Rappel mensuel de sauvegarde, et l'export qui va avec (§6).
- Régularisation de fin de mois : le réel remplace le montant de l'occurrence,
  l'écart avec l'estimation est affiché sans être écrit.

### Lot 7 — Finitions

Accessibilité (aucune information portée par la seule couleur, taille des cibles,
contrastes), comportement hors ligne, coût du pliage au démarrage, `README`.

---

## 4. Compléments au modèle de données

### 4.1 Types d'événements manquants

La liste du contexte ne couvre pas certaines écritures pourtant nécessaires :

- `occurrence.overridden` / `occurrence.override_cleared` — **le plus important** :
  les `OccurrenceOverride` sont décrits comme entité, mais aucun événement ne
  permet de les créer. Charge utile : `subscription_id`, `date_theorique`,
  `montant_cents`, `statut`, `exclu_de_estimation`.
- `transfer.updated` / `transfer.deleted` — un virement se corrige comme une
  transaction.
- `label.archived` — le champ `archived_at` existe sans événement pour le poser.
- `account.unarchived` — symétrique de `account.archived`.
- `settings.updated` — la réserve du reste à vivre doit vivre dans le journal,
  sinon elle ne suit pas l'export.
- `instrument.created` / `instrument.updated` — phase 2, à réserver maintenant
  pour ne pas renuméroter le format plus tard.

### 4.1 bis Unité de l'intervalle d'une récurrence `personnalise`

Le contexte donne `frequence: personnalise` et `intervalle: int` sans dire en
quoi l'intervalle est compté. Les deux lectures sont défendables — tous les N
mois, ou tous les N jours — et se départagent mal sans le cas d'usage. Plutôt
que de trancher en silence, la règle porte un champ `unite_intervalle`
(`mois` | `semaine` | `jour`), **défaut `mois`**, qui n'a de sens que pour
`personnalise` : les autres fréquences imposent la leur, 1, 3 ou 12 mois.

### 4.2 Dates : chaînes civiles, jamais d'objet `Date`

Une date métier est une chaîne `YYYY-MM-DD`. Un `Date` ou un epoch pour « le 3 du
mois » finit par se décaler d'un jour selon le fuseau et l'heure de saisie — c'est
le bug classique de ce type d'application, et il est silencieux. Seul `Event.ts`
est un epoch, parce que c'est un instant, pas une date.

### 4.3 Invariant de solde d'un compte `saisi`

Soit l'**ancre** = le dernier `account.balance_set` de date ≤ J (départage par
`ts` d'événement).

```
solde(compte, J) = ancre.valeur
                 + Σ mouvements m du compte tels que
                     ( m.date > ancre.date
                       ou (m.date = ancre.date et m.event_ts > ancre.event_ts) )
                     et m.date ≤ J
```

La réconciliation écrit **dans cet ordre** : la transaction d'écart, puis la
nouvelle ancre. L'écart est donc porté par une ligne visible dans les dépenses du
mois, sans être compté deux fois dans le solde — l'ancre le contient déjà. Le
départage par `ts` est ce qui permet de saisir une dépense après avoir réconcilié
le même jour sans qu'elle disparaisse du calcul.

Corollaire utile : la réconciliation est auto-corrective. Tout ce qui manquait —
occurrence non confirmée, dépense oubliée — finit dans l'écart.

### 4.4 Vue « mouvement » unifiée

Un mouvement est `{ compte_id, date, montant_cents, nature, label_id?, source }`
où `nature` ∈ `transaction` | `virement` | `occurrence`. Elle produit :

- le solde (§4.3),
- la projection,
- les dépenses par label — les virements en sont exclus par leur `nature`, et les
  occurrences réalisées y apportent le label de leur abonnement, ce qui est
  exactement ce que demande le contexte §4.2 sans double saisie.

### 4.5 `Snapshot` et `BalanceEntry` ne font pas doublon

- `BalanceEntry` = ce que **l'utilisateur a relevé** (`account.balance_set`).
- `Snapshot` = ce que **l'application a constaté** à l'ouverture, pour la courbe
  de patrimoine (`snapshot.recorded`).

Les confondre revient soit à réécrire le passé, soit à perdre la courbe les
semaines sans relevé.

### 4.6 État applicatif

Un magasin minimal — `useSyncExternalStore` sur un module, ou Zustand — contenant
l'état déplié, recalculé à chaque `append()`. Pas de Redux : le journal joue déjà
ce rôle, et mieux.

---

## 5. Le point laissé ouvert : persistance sur iOS

Le contexte demandait de vérifier au moment de coder. `navigator.storage.persist()`
n'accorde rien sur Safari iOS ; la protection réelle contre la purge après sept
jours d'inactivité, c'est **l'installation sur l'écran d'accueil**. L'appel reste à
faire — il est utile sur Chrome et sur macOS — mais l'onboarding doit insister sur
l'installation, et Réglages doit afficher l'état réellement obtenu plutôt que de le
supposer. Conséquence assumée : l'export mensuel n'est pas un confort, c'est la
sauvegarde.

---

## 6. Les deux dépôts

| | `Ingenious` (public) | `Ingenious-private` (privé) |
|---|---|---|
| Contenu | code, docs, workflow Pages | journal d'événements sauvegardé |
| Secrets | **aucun, jamais** | aucun non plus : ni PIN, ni clé |
| Phase 1 | source de l'app déployée | dépôt de l'export manuel |
| Phase 2 | inchangé | cible de la synchronisation automatique |

Le dépôt privé reçoit dès maintenant un journal **vierge** au format d'export, et
le `README` qui décrit l'enveloppe. Ainsi le format de sauvegarde existe avant la
première donnée réelle, et le passage du manuel à l'automatique en phase 2 ne
change qu'une chose : un bouton devient un appel réseau.

Enveloppe d'export, en clair (phase 1) :

```json
{
  "format": "ingenious.journal",
  "version": 1,
  "chiffre": false,
  "genere_le": "2026-09-11T00:00:00.000Z",
  "appareil": null,
  "events": []
}
```

Chiffrée (option §2.7, et phase 2), les mêmes champs d'en-tête, `chiffre: true`,
plus `kdf`, `iv` et `ciphertext` ; `events` disparaît. L'en-tête reste en clair :
il faut pouvoir lire la version d'un fichier qu'on ne sait pas encore déchiffrer.

**Le dépôt privé n'est pas une sauvegarde à lui seul.** Un dépôt GitHub privé est
un second exemplaire, pas un coffre : garder aussi une copie locale de l'export.

---

## 7. Ce qui doit être fait dans l'interface GitHub

Ces trois actions ne sont pas accessibles depuis le code et bloquent le lot 0 :

1. **Créer la branche `main` et la désigner par défaut.** Aujourd'hui la branche
   par défaut est une branche de travail ; le workflow Pages se déclencherait sur
   une branche vouée à disparaître.
2. **Activer GitHub Pages** sur le dépôt public, source « GitHub Actions ».
3. Phase 2 seulement : créer un jeton à portée restreinte au dépôt privé, saisi
   dans l'application sur chaque appareil. **Jamais dans le dépôt de code.**

---

## 8. Arborescence cible

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

## 9. Hors périmètre phase 1

Mode `calculé` et cours de bourse, synchronisation automatique, import CSV, suivi
fiscal, vue à douze mois. Le PEA et l'or existent dès la phase 1 **en mode
`saisi`**.

---

## 10. Prochaine étape

Lots 0 et 1 livrés. La suite est le **lot 2**, persistance et chiffrement — donc
l'export, qui est la règle §1.3 : **aucune donnée réelle ne doit être saisie
avant que le bouton d'export existe.** C'est aussi le lot qui tranche §2.6 à
§2.8, sur le chiffrement.

Les arbitrages §2.1 à §2.5 sont tous implémentés dans le noyau et couverts par
les tests. Ils restent contestables tant qu'aucune donnée réelle n'existe ; après,
ils deviennent chers à défaire.
