# Audits de navigateur

Ces scripts conduisent l'application dans un vrai navigateur — clics, saisies,
fichiers déposés, disque en panne, appareil fermé en plein chiffrement.

Ils ne remplacent pas les tests unitaires : ils trouvent autre chose. Presque
tous les défauts sérieux de ce projet ont été trouvés ici et non dans les tests.
Perte de données à l'activation du code, import qui ne finissait jamais,
identifiants qui entraient en collision entre deux appareils, écriture refusée
en silence, restauration qui exigeait d'inventer un compte : aucun n'était
visible depuis une assertion sur une fonction pure.

## Lancer

```sh
npm run build        # les audits visitent le site construit
npm run audit        # les audits rapides, environ trois minutes
npm run audit -- --tous        # tout, y compris volume et interruption
npm run audit -- a11y fusion   # ceux qu'on nomme
```

Le lanceur démarre `vite preview`, exécute chaque script, et déclare l'échec sur
un code de sortie non nul ou sur un problème annoncé dans la sortie.

## Ce que chacun vérifie

| Script | Vérifie |
| --- | --- |
| `a11y` | contraste AA, étiquettes, titres, repères, cibles tactiles — 16 écrans |
| `a11y-verrou` | les cinq écrans de code, qu'aucune route ne permet d'atteindre |
| `a11y-onboarding` | les trois étapes du démarrage à froid |
| `debordement` | aucun débordement horizontal à 412 px |
| `hostile` | treize fichiers d'import malveillants ou abîmés |
| `export` | téléchargement, partage, partage annulé, partage refusé |
| `restauration` | sauvegarde saine, abîmée, étrangère, vide, sur appareil neuf |
| `fusion` | trois appareils, saisies croisées, convergence, ordre indifférent |
| `panne` | disque qui refuse d'écrire : le bandeau, son contraste, son effacement |
| `stockage` | IndexedDB absent, quota dépassé, `localStorage` bloqué |
| `reverrou` | reverrouillage après deux minutes en arrière-plan, pas avant |
| `reconciliation` | l'écart, son absence de double comptage, une dépense saisie après l'ancre |
| `extremes` | noms de 68 caractères, montants à sept chiffres, saisies absurdes, soldes négatifs |
| `installation` | le bouton d'installation : proposé, consommé une fois, absent quand elle est faite |
| `interruption` | application fermée en plein chiffrement _(long)_ |
| `volume` | quinze ans de journal : ouverture, navigation, chiffrement _(long)_ |
| `parcours` | le parcours complet, d'un bout à l'autre |
| `pin`, `code` | chiffrement réel en base, changement de code, code oublié |
| `comptes`, `confirmer`, `correction`, `effet`, `occurrence`, `horsligne`, `rappel` | règles métier vues depuis l'écran |

## Une règle

Un audit qui ne trouve jamais rien n'a aucune valeur tant qu'on n'a pas vérifié
qu'il sait trouver. Le détecteur de contraste a été éprouvé sur une faute
délibérée ; le test de confinement de `Date` en cassant la règle exprès ; la
reprise d'un chiffrement interrompu en désactivant la reprise. Faites de même
avant de faire confiance à un nouvel audit.

## Non versionné

Le scénario de mise à jour PWA demande de servir deux versions successives du
site : il se remonte à la main quand on en a besoin. Vérifié une fois — la
saisie en cours survit, la nouvelle version est servie au rechargement, le hors
ligne continue de fonctionner, l'ancien cache est nettoyé.
