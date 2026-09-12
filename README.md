# Ingenious

Suivi de finances personnelles, **hors ligne et sans serveur**. Les données sont
saisies à la main, vivent dans le navigateur de l'appareil, et ne sortent que par
un export explicite.

- Contexte du projet : [`docs/CONTEXTE.md`](docs/CONTEXTE.md)
- Plan d'action et arbitrages : [`docs/PLAN.md`](docs/PLAN.md)

**Aucun secret ne doit entrer dans ce dépôt**, qui est public. Une éventuelle clé
d'API (phase 2) est saisie par l'utilisateur au premier lancement et stockée
localement, jamais dans le build.

## Développement

```bash
npm install
npm run dev          # serveur de développement
npm run test         # tests unitaires (Vitest)
npm run lint         # ESLint
npm run build        # vérification des types puis build de production
npm run preview      # sert le build, sous /Ingenious/
npm run icones       # régénère les PNG de public/ depuis le script
```

Le noyau (`src/core/`) est du TypeScript pur : ni React, ni IO. Ses tests
tournent en environnement `node`. Un test de composant ouvre son fichier par
`// @vitest-environment jsdom`.

## Déploiement

Poussé sur `main`, le workflow `deploy-pages.yml` vérifie, construit et publie
sur GitHub Pages. Deux réglages sont à faire une seule fois dans l'interface du
dépôt, sans quoi le workflow échoue :

1. **Settings → Branches** : avoir une branche `main`, et en faire la branche par défaut.
2. **Settings → Pages → Build and deployment → Source** : choisir **GitHub Actions**.

L'application est servie sous `/Ingenious/` (`base` dans `vite.config.ts`) et
route par hash : GitHub Pages ne réécrit pas les URL vers `index.html`.

## Noyau de calcul

`src/core/` est du TypeScript pur, sans React ni IO, entièrement testé. C'est là
que vivent les décisions qui coûtent cher à défaire :

| Module | Rôle |
|---|---|
| `money.ts` | entiers centimes, parsing FR, un seul arrondi |
| `civilDate.ts` | dates `YYYY-MM-DD`, arithmétique sans objet `Date` |
| `holidaysFR.ts` | les 11 fériés, Pâques par Meeus |
| `recurrence.ts` | occurrences théoriques, décalage jour ouvré à l'affichage |
| `estimation.ts` | médiane sur fenêtre glissante, résolution du montant |
| `prixAbonnement.ts` | montant valide à une date donnée |
| `echeances.ts` | des règles aux échéances valorisées et encadrées |
| `projection.ts` | solde jour par jour, point bas, bornes |
| `resteAVivre.ts` | le chiffre de l'accueil, toujours pessimiste |
| `clock.ts` | seul endroit où un instant devient une date civile |

## État

Lots 0 et 1 livrés : fondations, PWA installable, déploiement, noyau de calcul.
La persistance et le chiffrement sont le lot 2 — **ne pas saisir de données
réelles avant que l'export existe.**
