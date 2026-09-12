# Recette

Ce qui reste à vérifier ne peut pas l'être depuis une machine de développement.
Cette liste est ordonnée par risque : les premières lignes sont celles dont
l'échec coûterait des données, les dernières du confort.

Adresse de l'application : `https://sanjethansellappah.github.io/Ingenious/`

---

## 1. L'export sur iPhone — à faire en premier, avant toute donnée réelle

**Pourquoi d'abord.** Sans serveur, l'export est le seul filet : un téléphone
perdu sans export, c'est tout perdu. Et c'est le seul chemin que je n'ai pas pu
éprouver sur l'appareil visé — Safari ignore `<a download>` sur une URL blob et
ouvre le contenu dans un onglet au lieu d'enregistrer un fichier. L'application
passe donc par la feuille de partage, vérifiée sous Chromium, jamais sous Safari.
Si quelque chose doit être cassé, c'est là.

- [ ] Ouvrir l'adresse dans **Safari** (pas Chrome : sur iOS, seul Safari
      installe une application sur l'écran d'accueil).
- [ ] **Partager → Sur l'écran d'accueil.** Ouvrir ensuite l'application depuis
      l'icône, pas depuis Safari.
- [ ] Créer un compte bidon à 1 000 €, saisir deux ou trois dépenses.
- [ ] **Réglages → Exporter.** La feuille de partage iOS doit s'ouvrir.
- [ ] Choisir **Enregistrer dans Fichiers**. Vérifier que le fichier
      `ingenious-AAAA-MM-JJ.json` existe vraiment dans Fichiers.
- [ ] L'ouvrir : il doit commencer par `{"format":"ingenious.journal"`.
- [ ] Refaire un export et **annuler** la feuille de partage. Le rappel de
      sauvegarde doit **rester affiché** — rien n'a été enregistré.

**Si la feuille de partage ne s'ouvre pas** et que le fichier s'affiche dans un
onglet : c'est le défaut que je craignais, dites-le moi.

## 2. Repartir d'une sauvegarde

Le cas pour lequel tout le reste existe.

- [ ] Sur l'écran d'accueil de l'iPhone, supprimer l'application, puis la
      réinstaller depuis Safari.
- [ ] Au premier écran, **Restaurer une sauvegarde** → choisir le fichier.
- [ ] L'application doit s'ouvrir directement sur vos données, **sans avoir à
      créer de compte au préalable**.

## 3. Le code de verrouillage

- [ ] **Réglages → Configurer un code.** Six chiffres.
- [ ] Fermer complètement l'application, la rouvrir : le code est demandé.
- [ ] Entrer un mauvais code : refusé, sans effacer quoi que ce soit.
- [ ] Entrer le bon : les données sont là, intactes.
- [ ] Quitter l'application trois minutes, revenir : le code est redemandé.
- [ ] Un aller-retour de dix secondes ne doit **pas** redemander le code.

**À savoir** : un code perdu, ce sont les données perdues. Exportez avant.

## 4. La persistance sur iOS — le test long

iOS purge les données des sites web après quelques jours sans visite. Seule
l'installation sur l'écran d'accueil protège, et cela ne se vérifie qu'avec le
temps.

- [ ] Réglages → la ligne **Stockage** doit dire « Installée sur l'écran
      d'accueil : oui ».
- [ ] Ne pas ouvrir l'application pendant **deux semaines**, puis la rouvrir :
      les données doivent être là.

Si elles ont disparu malgré l'installation, c'est une limite d'iOS, pas un
défaut réparable — mais dites-le moi, cela change ce que l'application doit
promettre.

## 5. Deux appareils

- [ ] Installer aussi sur un second appareil (ou un autre navigateur).
- [ ] Exporter depuis le premier, restaurer sur le second.
- [ ] Saisir une dépense **différente** sur chacun, sans les synchroniser.
- [ ] Échanger les exports dans les deux sens.
- [ ] Les deux doivent afficher **exactement le même solde** et les mêmes
      mouvements, sans doublon.

## 6. L'usage réel, sur quelques semaines

C'est le seul test qui juge vraiment l'application : les autres vérifient qu'elle
ne casse pas, celui-ci vérifie qu'elle sert.

- [ ] Saisir vos vrais comptes, vos vrais abonnements.
- [ ] **Chaque semaine** : Réconciliation → relever le solde affiché par la
      banque. L'écart doit tomber sous « Non catégorisé » et recaler le solde.
- [ ] **Chaque mois** : confirmer les échéances variables (électricité, salaire)
      avec leur montant réel. L'estimation suivante doit s'affiner.
- [ ] Surveiller le **reste à vivre** : correspond-il à ce que vous auriez
      calculé de tête ? S'il ment, c'est le défaut le plus grave possible.
- [ ] Exporter au moins une fois par mois. L'application le rappelle.

## 7. Ce qui doit vous alerter

Signalez-moi tout de suite :

- Un **bandeau rouge** « La dernière saisie n'a pas pu être enregistrée ».
- Un montant affiché `NaN`, vide, ou manifestement faux.
- Un écran blanc.
- Une échéance qui apparaît deux fois, ou qui disparaît.
- Un solde qui change sans que vous ayez rien saisi.

Ce qui aide à corriger : quel écran, ce que vous veniez de faire, ce que vous
attendiez, ce que vous avez vu. Et **le fichier d'export** s'il ne contient rien
de gênant — il contient tout ce qu'il faut pour reproduire.

---

## Vérifications automatiques

Elles tournent sur une machine de développement, pas sur le téléphone.

```sh
npm install
npm run test          # 415 tests unitaires, deux secondes
npm run lint
npm run build
npm run audit         # 23 audits dans un vrai navigateur, environ trois minutes
npm run audit -- --tous   # avec les deux audits longs (volume, interruption)
```

`npm run audit` construit puis conduit l'application : clics, saisies, fichiers
d'import abîmés, disque qui refuse d'écrire, appareil fermé en plein chiffrement,
trois appareils qui fusionnent leurs journaux. Le détail de chacun est dans
`scripts/audit/README.md`.

Ces audits ont trouvé presque tous les défauts sérieux du projet. Ils ne
remplacent pas les sections 1 à 6 : aucun d'eux ne tourne sous Safari, ni sur un
iPhone, ni sur plusieurs semaines.
