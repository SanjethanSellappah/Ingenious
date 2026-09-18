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

## 4 bis. Les cours automatiques — la seule chose non éprouvée

Tout le reste de l'application est vérifié dans un navigateur. **Pas ceci** : je
n'ai ni clé ni accès au service depuis l'environnement de développement. Le
câblage est testé — la clé part au bon hôte, le cours reçu est écrit et daté, un
refus n'efface rien, la clé reste hors de l'export — mais la forme réelle de la
réponse du service ne l'est pas.

- [ ] Créer un compte gratuit sur `twelvedata.com`, récupérer la clé.
- [ ] **Réglages → Cours des instruments → Garder**, puis **Actualiser les
      cours**.
- [ ] Vérifier que le nombre de cours mis à jour correspond au nombre
      d'instruments, et que la valorisation change.
- [ ] Comparer un cours obtenu avec celui affiché par votre courtier.

Si l'actualisation échoue, le message donne la raison par instrument. Envoyez-la
moi : c'est très probablement la forme de la réponse qui diffère, et c'est une
correction de quelques lignes.

L'or est interrogé en `XAU/EUR` et ramené au gramme si c'est en grammes que vous
comptez. **Vérifiez ce chiffre en premier** : une once fait 31,1 g, et une erreur
d'unité se voit tout de suite.

## 4 ter. L'import d'un relevé bancaire

Quatre formats sont acceptés : CSV, Excel (`.xlsx` et `.xls`) et PDF. Les audits
conduisent cet écran avec de vrais fichiers de chaque format, mais fabriqués
ici. Ce qu'ils ne peuvent pas éprouver, c'est le fichier que **votre** banque
produit : les noms de colonnes, le séparateur, l'encodage, la mise en page du
PDF. C'est la seule inconnue de cette fonctionnalité.

Commencez par le CSV s'il est proposé : c'est le format le plus sûr des quatre,
parce que les colonnes y sont déclarées au lieu d'être devinées.

- [ ] Exporter un relevé depuis le site de votre banque, sur une période **déjà
      réconciliée**.
- [ ] **Comptes → Importer un relevé CSV.** Choisir le compte, puis le fichier.
- [ ] Vérifier la ligne qui annonce le fichier : nombre de lignes, séparateur,
      encodage. Si le nombre de lignes ne correspond pas, le séparateur a été mal
      deviné — dites-le, c'est corrigeable.
- [ ] Vérifier les **colonnes devinées**, et les corriger au besoin. Vérifier
      surtout qu'un montant d'exemple s'affiche correctement.
- [ ] Lire l'aperçu **avant** d'importer : le nombre d'opérations, les dates
      extrêmes, et les encarts qui apparaissent.
- [ ] Si un encart **« Écarts de réconciliation »** apparaît, c'est normal et
      c'est le point important : l'écart « Non catégorisé » résume déjà les
      dépenses que le fichier apporte en détail. Laisser la case cochée.
- [ ] Importer. Vérifier ensuite dans **Dépenses** que le total du mois n'a pas
      doublé.
- [ ] **Réimporter exactement le même fichier.** L'aperçu doit annoncer
      **0 opération** et dire que les lignes sont déjà connues. Si un seul
      doublon apparaît, arrêtez-vous là et signalez-le.
- [ ] Exporter un fichier **plus large** (deux mois au lieu d'un) qui recouvre le
      premier. Seules les lignes nouvelles doivent être annoncées.
- [ ] Vérifier les **accents** dans les libellés importés. Un « RETRAIT DÉCEMBRE »
      devenu illisible veut dire que l'encodage a été mal lu.

### Les autres formats

- [ ] Recommencer avec le même relevé en **Excel**, s'il est proposé. Vérifier
      surtout les **dates** : dans un classeur, une date est un nombre, et c'est
      son format qui dit qu'il faut la lire comme une date. Une colonne de dates
      affichée « 46266 » veut dire que ce format n'a pas été reconnu — dites-le.
- [ ] Si le classeur a plusieurs feuilles, vérifier que c'est bien celle des
      opérations qui est proposée, et changer au besoin.
- [ ] Recommencer avec le **PDF** du même relevé. C'est le format le plus
      incertain : un PDF ne contient pas de tableau, les colonnes sont retrouvées
      d'après les alignements. Regarder l'aperçu ligne à ligne avant d'importer.
- [ ] Après avoir importé le relevé dans un format, **importer le même relevé
      dans un autre format** sur le même compte. L'aperçu doit annoncer
      **0 opération** : l'empreinte vient du contenu, pas du fichier. Si des
      doublons apparaissent, arrêtez-vous et signalez-le.
- [ ] Si votre PDF est un **scan** (une image), l'application doit le dire
      clairement et vous renvoyer vers le CSV ou l'Excel. Elle ne doit jamais
      prétendre l'avoir lu.

### Les libellés abrégés

- [ ] Après l'import, regarder la liste des mouvements du compte. Chaque ligne
      doit tenir en une ou deux lignes d'écran, pas en un paragraphe.
- [ ] Vérifier qu'aucun **commerçant** n'a disparu au passage : « Prélèvement
      Orange », « Virement A Durandel », « Navigo annuel » doivent rester
      reconnaissables. Si un nom manque, c'est un vrai défaut — signalez-le avec
      le libellé complet.
- [ ] Ouvrir un mouvement importé : le **libellé de la banque** doit y figurer en
      entier, tel quel, avec ses références.
- [ ] Sur cet écran, le champ **Note** est vide : c'est voulu. Le laisser vide
      garde le libellé de la banque ; y écrire quelque chose le remplace.

Si un encart **« Sans effet sur le solde »** apparaît, ce n'est pas une panne :
le solde part de votre dernier relevé et n'additionne que ce qui vient après.
Des lignes plus anciennes enrichissent l'historique et les totaux par poste sans
déplacer le solde.

## 5. Deux appareils

- [ ] Installer aussi sur un second appareil, ou dans un autre navigateur.
- [ ] Exporter depuis le premier, restaurer sur le second.
- [ ] Saisir une dépense **différente** sur chacun, sans les synchroniser.
- [ ] Échanger les exports dans les deux sens.
- [ ] Les deux doivent afficher **exactement le même solde** et les mêmes
      mouvements, sans doublon.
- [ ] Importer **le même relevé CSV sur les deux appareils**, séparément, puis
      échanger les exports. Les lignes ne doivent apparaître **qu'une fois** :
      leur identifiant est dérivé de leur contenu, il est donc le même des deux
      côtés.

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
