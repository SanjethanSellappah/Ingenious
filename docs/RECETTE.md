# Recette

Ce qui reste à vérifier ne peut pas l'être depuis une machine de développement.
Cette liste est ordonnée par risque : les premières lignes sont celles dont
l'échec coûterait des données, les dernières du confort.

Adresse de l'application : `https://sanjethansellappah.github.io/Ingenious/`

Les audits automatiques tournent sous Chromium avec un profil de téléphone
Android. **Sur Android, ils couvrent donc l'essentiel du terrain** : ce qui suit
vérifie ce qu'un navigateur piloté ne montre pas — la vraie feuille de partage,
la vraie installation, la vraie durée, le vrai usage.

---

## 1. Installer, et exporter tout de suite

L'export est le seul filet : sans serveur, un téléphone perdu sans export, c'est
tout perdu. À faire avant de saisir la moindre donnée réelle.

- [ ] Ouvrir l'adresse dans **Chrome**.
- [ ] **Réglages → Installer l'application.** Chrome doit ouvrir sa fenêtre
      d'installation. Si le bouton n'apparaît pas, passer par le menu ⋮ du
      navigateur → *Installer l'application*.
- [ ] Rouvrir depuis l'**icône de l'écran d'accueil**, plus depuis Chrome. La
      barre d'adresse ne doit plus être visible.
- [ ] Créer un compte bidon à 1 000 €, saisir deux ou trois dépenses.
- [ ] **Réglages → Exporter.** La feuille de partage Android doit s'ouvrir.
- [ ] Enregistrer dans **Fichiers** ou **Drive**. Vérifier que
      `ingenious-AAAA-MM-JJ.json` existe vraiment.
- [ ] L'ouvrir : il commence par `{"format":"ingenious.journal"`.
- [ ] Refaire un export et **annuler** le partage. Le rappel de sauvegarde doit
      **rester affiché** — rien n'a été enregistré.

## 2. Repartir d'une sauvegarde

Le cas pour lequel tout le reste existe.

- [ ] Désinstaller l'application, puis la réinstaller.
- [ ] Au premier écran, **Restaurer une sauvegarde** → choisir le fichier.
- [ ] Elle doit s'ouvrir directement sur vos données, **sans avoir à créer de
      compte au préalable**.

## 3. Le code de verrouillage

- [ ] **Réglages → Configurer un code.** Six chiffres.
- [ ] Fermer complètement l'application, la rouvrir : le code est demandé.
- [ ] Mauvais code : refusé, sans rien effacer. Bon code : données intactes.
- [ ] Quitter trois minutes, revenir : le code est redemandé.
- [ ] Un aller-retour de dix secondes ne doit **pas** le redemander.

**À savoir** : un code perdu, ce sont les données perdues. Exportez avant.

## 4. La persistance — le test long

Un navigateur fait le ménage dans les données des sites qu'on ne visite plus, et
il ne distingue pas un site oublié d'une application qu'on n'a pas ouverte de la
semaine.

- [ ] Réglages → **Stockage**. Lire les deux lignes :
      - *Persistance accordée par le navigateur* — sur Android, une application
        installée l'obtient en général. Si c'est **oui**, le risque est faible.
      - *Installée sur l'écran d'accueil* — doit être **oui**.
- [ ] Ne pas ouvrir l'application pendant **deux semaines**, puis la rouvrir :
      les données doivent être là.

Si la persistance est refusée malgré l'installation, dites-le moi : cela change
ce que l'application doit promettre.

## 5. Deux appareils

- [ ] Installer aussi sur un second appareil, ou dans un autre navigateur.
- [ ] Exporter depuis le premier, restaurer sur le second.
- [ ] Saisir une dépense **différente** sur chacun, sans les synchroniser.
- [ ] Échanger les exports dans les deux sens.
- [ ] Les deux doivent afficher **exactement le même solde** et les mêmes
      mouvements, sans doublon.

## 6. L'usage réel, sur quelques semaines

C'est le seul test qui juge vraiment l'application : les autres vérifient
qu'elle ne casse pas, celui-ci vérifie qu'elle sert.

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

## Si vous ouvrez un jour depuis un iPhone

L'application y fonctionne, avec deux réserves qui n'ont pas été éprouvées sur
l'appareil : Safari ignore `<a download>` pour une URL blob — d'où le passage par
la feuille de partage — et il n'accorde jamais la persistance, l'installation
sur l'écran d'accueil étant alors la seule protection. Sur iOS, l'installation
passe par le menu de partage de Safari, pas par un bouton.

---

## Vérifications automatiques

Sur une machine de développement, pas sur le téléphone.

```sh
npm install
npm run test          # 415 tests unitaires, deux secondes
npm run lint
npm run build
npm run audit         # 24 audits dans un vrai navigateur, environ trois minutes
npm run audit -- --tous   # avec les deux audits longs (volume, interruption)
```

`npm run audit` conduit l'application construite : clics, saisies, fichiers
d'import abîmés, disque qui refuse d'écrire, appareil fermé en plein
chiffrement, trois appareils qui fusionnent leurs journaux. Le détail de chacun
est dans `scripts/audit/README.md`.

Ces audits ont trouvé presque tous les défauts sérieux du projet. Ils ne
remplacent pas les sections 1 à 6 : aucun ne tourne sur un vrai téléphone, ni
sur plusieurs semaines.
