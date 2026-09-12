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
```

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

## Ce que le code garantit, et ce qu'il ne garantit pas

- Le **code de verrouillage** chiffre les données de l'appareil. Il protège de
  quelqu'un qui emprunte le téléphone, pas d'un adversaire outillé qui le garde.
  Un code perdu, ce sont les données perdues, sans récupération.
- Sur **iOS**, `navigator.storage.persist()` n'accorde rien : seule l'installation
  sur l'écran d'accueil protège de la purge après quelques jours d'inactivité.
- La **projection est une prédiction**. L'interface montre toujours de quoi elle
  est faite, et où sa certitude s'arrête : trait plein avant la première
  occurrence estimée, pointillé et fourchette au-delà.

## État

Phase 1 livrée : lots 0 à 7. La phase 2 — mode `calculé`, cours de bourse,
synchronisation automatique, import CSV, suivi fiscal, vue à douze mois — est
hors périmètre et décrite au §9 du contexte.
