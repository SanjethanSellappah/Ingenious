# Ingenious

Suivi de finances personnelles, **hors ligne et sans serveur**. Les données sont
saisies à la main, vivent dans le navigateur de l'appareil, et ne sortent que par
un export explicite.

- Contexte du projet : [`docs/CONTEXTE.md`](docs/CONTEXTE.md)
- Plan d'action et arbitrages : [`docs/PLAN.md`](docs/PLAN.md)
- Modèle de menace et revues : [`docs/SECURITE.md`](docs/SECURITE.md)

**Aucun secret ne doit entrer dans ce dépôt**, qui est public. Une éventuelle clé
d'API (phase 2) est saisie par l'utilisateur au premier lancement et stockée
localement, jamais dans le build.

## Développement

```bash
npm install
npm run dev           # serveur de développement
npm run test          # tests unitaires (Vitest)
npm run test:coverage # couverture du noyau
npm run lint          # ESLint
npm run build         # vérification des types puis build de production
npm run preview       # sert le build, sous /Ingenious/
npm run icones        # régénère les PNG de public/ depuis le script
npm run audit         # audits de navigateur sur le build (voir scripts/audit/)
```

Les audits de `scripts/audit/` conduisent l'application dans un vrai navigateur —
clics, saisies, fichiers d'import malveillants, disque qui refuse d'écrire,
appareil fermé en plein chiffrement, trois appareils qui fusionnent leurs
journaux. Ils ne remplacent pas les tests unitaires : presque tous les défauts
sérieux de ce projet ont été trouvés là et non dans les tests. Lancez-les sur un
build à jour (`npm run build` d'abord).

Ce qui reste à éprouver sur un vrai téléphone — l'installation, la feuille de
partage, la persistance dans la durée, l'usage sur plusieurs semaines — est
listé par ordre de risque dans [`docs/RECETTE.md`](docs/RECETTE.md).

## Architecture

Quatre couches, du plus pur au plus branché. Une couche ne connaît jamais celle
au-dessus d'elle.

| Couche | Rôle | Contrainte |
| --- | --- | --- |
| `src/core/` | montants, dates, fériés, récurrences, estimation, projection | TypeScript pur : ni React, ni IO, ni `Date` |
| `src/domain/` | journal d'événements, validation, pliage, sélecteurs, vues | pur également ; ne connaît pas le stockage |
| `src/storage/` | Dexie, chiffrement, dépôt, export/import, persistance | seul à toucher IndexedDB |
| `src/app/` + `src/screens/` + `src/ui/` | magasin, routage, verrou, écrans | seuls à connaître React |

### Ce qui tient tout le reste

**Le journal est la source de vérité.** Append-only : une correction est un
nouvel événement, jamais une réécriture. L'état applicatif se recalcule en
repliant le journal, trié par instant puis par identifiant. Deux appareils
fusionnent par simple union sur l'identifiant d'événement — aucun conflit
possible, donc aucun code d'arbitrage.

**Les montants sont des entiers de centimes**, portant un type marqué pour qu'un
`number` ordinaire ne puisse pas s'y glisser. Un seul arrondi existe, commercial,
le demi s'éloignant de zéro.

**Une date métier est une chaîne `YYYY-MM-DD`.** L'arithmétique passe par le
numéro de jour, sans jamais construire d'objet `Date` : c'est le seul moyen sûr
d'éviter les décalages de fuseau, qui produisent des chiffres faux sans lever
d'erreur. `src/core/clock.ts` est l'unique endroit où un instant devient une date
civile.

**Les occurrences futures ne sont jamais stockées.** Une règle, plus une liste
d'exceptions : c'est le modèle d'iCalendar. La date théorique identifie
l'occurrence, la date décalée n'est qu'un affichage.

## Déploiement

Poussé sur `main`, le workflow `deploy-pages.yml` vérifie, construit et publie sur
GitHub Pages. L'application est servie sous `/Ingenious/` et route par hash :
GitHub Pages ne réécrit pas les URL vers `index.html`.

Un réglage reste à faire une fois dans l'interface du dépôt : **Settings →
Branches**, désigner `main` comme branche par défaut.

## Sauvegarde

Sans serveur, l'export est le seul filet. Le fichier produit **est le journal
lui-même**, en clair : relisible dans dix ans avec n'importe quel outil, et
réimportable par fusion — l'import n'écrase jamais.

Une application non ouverte ne rappelle rien : le rappel de sauvegarde arrive à
l'ouverture suivante. C'est mieux que rien, et il vaut mieux le dire que promettre
une régularité qu'on ne peut pas tenir.

## Import d'un relevé bancaire

Quatre formats : **CSV**, **Excel** (`.xlsx` et `.xls`), et **PDF**. Le format
est reconnu à ses octets, jamais à son extension — une banque qui nomme `.xls`
un fichier qui est du CSV ne doit pas rendre l'import incompréhensible.

Les quatre lectures produisent la même chose : une grille de chaînes. Tout ce
qui suit — correspondance des colonnes, dates, montants, empreinte, aperçu —
ignore d'où viennent les lignes. C'est pourquoi la détection des doublons vaut
d'un format à l'autre : **le même relevé importé en Excel puis en PDF n'ajoute
rien la seconde fois**, l'empreinte étant tirée du contenu et non du fichier.

Les quatre lecteurs sont écrits ici, sans dépendance : le navigateur sait
décompresser (`DecompressionStream`), et le reste est du décodage. Les
bibliothèques habituelles auraient ajouté plus de deux mégaoctets à une
application qui en fait six cents kilo-octets ; ces lecteurs en coûtent
vingt-six, et se relisent.

Ce qu'ils ne font pas, et qui est dit à l'écran plutôt que découvert : **un PDF
scanné ne donne rien**. Une photo de relevé ne contient pas de texte, et il n'y
a pas de reconnaissance de caractères. Un PDF a par ailleurs beau ressembler à
un tableau, il n'en contient pas : les colonnes sont retrouvées en regardant où
la plupart des lignes se taisent. D'où l'aperçu, colonne par colonne, avant
toute écriture.


Un relevé de banque n'a pas d'identifiant d'événement, et le journal est en ajout
seul : l'erreur possible n'est donc pas la perte, c'est le **doublon**. Chaque
ligne reçoit un identifiant **dérivé de son contenu** (compte, date, montant,
libellé normalisé, et le rang parmi les lignes indiscernables), de sorte que le
même relevé réimporté — ou importé depuis un second appareil — est reconnu par
la même union sur `id` que pour un journal.

Restent deux effets qu'aucune empreinte ne peut trancher seule, et qui sont
donc **montrés avant d'écrire** : les lignes qui ressemblent à une saisie déjà
présente, et les écarts de réconciliation, qui résument déjà les dépenses non
saisies de la période qu'on importe. Un écart recouvert est proposé à la
suppression ; le supprimer ne déplace pas le solde — il était derrière l'ancre
qui l'a suivi — mais rétablit les totaux du mois.

## Ce que le code garantit, et ce qu'il ne garantit pas

- Le **code de verrouillage** chiffre les données de l'appareil. Il protège de
  quelqu'un qui emprunte le téléphone, pas d'un adversaire outillé qui le garde.
  Un code perdu, ce sont les données perdues, sans récupération.
- **Une écriture refusée est annoncée**, jamais avalée : un bandeau apparaît
  au-dessus de tous les écrans et invite à exporter avant de fermer. C'est le
  seul accident qu'on ne peut pas constater soi-même — l'écran montre l'état en
  mémoire, qui a l'air juste, pendant que rien n'est enregistré.
- La **persistance du stockage** est demandée au navigateur, et l'état obtenu est
  affiché tel quel plutôt que supposé : Chrome l'accorde en général à une
  application installée, Safari sur iOS jamais. Dans tous les cas, l'installation
  sur l'écran d'accueil protège de la purge, et l'export reste la vraie
  sauvegarde.
- La **projection est une prédiction**. L'interface montre toujours de quoi elle
  est faite, et où sa certitude s'arrête : trait plein avant la première
  occurrence estimée, pointillé et fourchette au-delà.

## Tenue à l'usage

Journal de synthèse représentant un usage quotidien sur trois comptes : à quinze
ans d'historique — 27 400 événements — l'ouverture à froid d'une base chiffrée
prend une seconde et demie, la navigation reste sous les vingt-cinq
millisecondes. Le chiffrement initial du journal, opération unique à l'activation
du code, prend une dizaine de secondes ; il est reprenable, parce qu'une
application peut être fermée pendant.

## État

Phase 1 livrée : lots 0 à 7. S'y ajoutent, pris sur la phase 2, le mode
`calculé` avec les cours de bourse et l'**import CSV de relevés bancaires**. Le
reste de la phase 2 — synchronisation automatique, suivi fiscal, vue à douze
mois — est hors périmètre et décrit au §9 du contexte.
