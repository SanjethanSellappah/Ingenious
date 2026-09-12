# Modèle de menace et revue de sécurité

Document tenu à jour à chaque revue. Deux revues ont été passées : le lot 2
(chiffrement, dépôt, validation) et les lots 5 à 7 (écrans et parcours complets).

---

## 1. Ce que l'application protège, et ce qu'elle ne protège pas

Le dire précisément évite deux erreurs symétriques : se croire à l'abri, et
renoncer à des protections qui coûtent trois lignes.

**Protégé**

- Quelqu'un qui emprunte le téléphone déverrouillé et ouvre l'application : il
  bute sur le PIN.
- Quelqu'un qui inspecte IndexedDB par les outils de développement : il ne lit
  que des chiffrés.
- Un fichier d'import trafiqué : il est validé champ par champ avant d'entrer.

**Non protégé, assumé**

- **Un adversaire outillé qui a le téléphone en main.** Un PIN à quatre
  chiffres, c'est 10 000 possibilités : 600 000 itérations PBKDF2 ralentissent
  l'essai, elles ne l'empêchent pas. Six chiffres sont recommandés à la
  configuration, et la limite est écrite en toutes lettres à l'utilisateur.
- **Un appareil compromis.** Du code qui s'exécute dans la page lit les données
  déchiffrées, quoi qu'on fasse.
- **La perte du PIN.** Il n'existe aucune récupération, par construction.

**Sans objet**

Ni serveur, ni compte, ni session, ni appel réseau : l'essentiel des menaces
d'une application web n'existe pas ici. Il n'y a ni authentification à
contourner, ni données d'autrui à atteindre.

---

## 2. Revue du lot 2 — corrections apportées

### 2.1 La clé de données était exportable — _corrigé_

`ouvrirCoffre` rendait une clé `extractable: true`, si bien que n'importe quel
code exécuté dans la page pouvait l'exporter et l'emporter. Elle est désormais
non exportable ; seul `changerPin` déballe une copie exportable, le temps de
refaire l'enveloppe, et l'oublie.

La barrière est modeste — qui exécute du code dans la page lit de toute façon
les données déchiffrées — mais elle sépare deux choses très différentes : lire
ce qui passe pendant une session, et emporter la clé de tout le reste.

### 2.2 Le témoin scellé était redondant — _supprimé_

Le coffre stockait un second chiffré sous la clé dérivée du PIN, pour vérifier
le PIN sans déchiffrer le journal. Or AES-GCM authentifie : **le déballage de la
clé est déjà la vérification**. Un mauvais PIN fait échouer l'opération au lieu
de rendre une clé fausse. Le témoin n'apportait rien et offrait un clair connu
de plus sous la même clé.

### 2.3 Aucune politique de sécurité du contenu — _ajoutée_

L'application ne charge rien d'extérieur : ni police, ni script, ni image
distante, ni appel réseau. La politique la plus stricte était donc gratuite.
GitHub Pages ne permet pas d'en-têtes HTTP ; elle passe par une balise `meta`.

`frame-ancestors` en est volontairement absent : cette directive est ignorée
dans une balise `meta`, l'y écrire donnerait l'illusion d'une protection.

La politique s'applique **aussi en développement**, avec trois directives
desserrées pour Vite, qui sert ses scripts et sa feuille de style en ligne. Le
reste est identique, de sorte qu'une dépendance externe introduite par mégarde
se voie tout de suite et non en production seulement.

---

## 3. Vérifié sans correction nécessaire

| Point                                | Constat                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Pollution de prototype par un import | `__proto__` et `constructor` sont traités comme des données ; le prototype n'est pas touché. Couvert par des tests.      |
| Expressions régulières               | Aucun quantificateur imbriqué : une chaîne de 50 000 caractères est refusée en temps linéaire. Testé.                    |
| Scellé modifié                       | AES-GCM détecte un bit changé ; l'enregistrement est signalé, pas déchiffré de travers. Testé.                           |
| Clair injecté dans une base chiffrée | Refusé et signalé, les autres enregistrements sont conservés. Testé.                                                     |
| Débordement de montant               | Un entier au-delà des bornes sûres est refusé à l'écriture comme à la lecture. Testé.                                    |
| Contenu du précache                  | Coquille de l'application uniquement : aucune donnée utilisateur.                                                       |
| Secrets dans le dépôt                | Aucun, historique compris. Le build n'en contient pas davantage.                                                        |
| Dépendances                          | `npm audit` : aucune vulnérabilité.                                                                                     |
| Injection à l'affichage              | Le journal est de la donnée ; React échappe par défaut, et aucun `dangerouslySetInnerHTML` n'existe.                     |

---

## 4. Revue des lots 5 à 7 — une correction critique

### 4.1 Configurer un code rendait toutes les données illisibles — _corrigé_

Le défaut le plus grave trouvé sur ce projet, et il était invisible aux tests
unitaires : **activer un code après avoir saisi des données les rendait toutes
illisibles**. Les enregistrements écrits en clair restaient en clair ; le
chiffreur actif les rejetait ensuite un par un, et l'application s'ouvrait vide.
Une perte totale, silencieuse, provoquée par un geste censé protéger.

Le journal est désormais **rechiffré avant** que le coffre soit enregistré, et
dans cet ordre précis : si le rechiffrement échoue, la base reste lisible sans
code plutôt que de devenir un coffre dont on aurait perdu le contenu. Le
rechiffrement se fait par lots, chaque enregistrement est relu avant d'être
réécrit, et un enregistrement illisible interrompt l'opération au lieu d'être
remplacé par du vide.

Cinq tests verrouillent le comportement, dont un qui décrit le piège d'origine
pour qu'il ne revienne pas.

### 4.2 Balayage des nouvelles surfaces

| Point | Constat |
| --- | --- |
| Construction dynamique de code | Aucune : ni `eval`, ni `new Function`, ni `innerHTML`, ni `dangerouslySetInnerHTML`. |
| Appels réseau | Aucun. L'application ne parle à personne. |
| Mémoire locale | Une seule clé, la date du dernier export. Ni code, ni clé, ni donnée financière. |
| Le code dans le journal | Absent : le code ne transite par aucun événement ni aucun export. |
| Import hostile | Validé champ par champ avant d'entrer, événements refusés nommés un par un. |
| Dépendances | `npm audit` : aucune vulnérabilité. |

### 4.3 Deux appareils créaient « le même » compte — _corrigé_

L'onboarding figeait l'identifiant du compte à `compte-courant` et celui de la
rentrée à `rentree-salaire`. Deux appareils produisaient donc deux comptes
**portant le même identifiant** : à la fusion des journaux, l'un écrasait
l'autre, deux soldes différents se confondaient en un seul, et rien ne le
signalait.

C'est la panne la plus difficile à diagnostiquer que cette architecture puisse
produire — la fusion est censée être sans conflit, et elle l'est : le conflit
venait des identifiants d'entités, pas des identifiants d'événements. Ils sont
désormais tirés au sort comme partout ailleurs. Un test de fusion à deux
appareils verrouille l'invariant.

Trouvé en important, dans un appareil neuf, l'export d'un autre.

### 4.4 Un import qui ne finissait jamais — _corrigé_

Le champ fichier était remis à zéro immédiatement après le début de la lecture.
Vider `input.value` invalide la source du fichier : la lecture restait en
suspens indéfiniment, sans erreur, sans message. Le bouton ne faisait
simplement rien. Le contenu est maintenant lu avant toute remise à zéro, et le
`return` silencieux qui masquait l'autre moitié du problème dit désormais
pourquoi il renonce.

### 4.5 Un rechargement vidait l'écran — _corrigé_

Toute relecture du journal remettait l'indicateur de chargement à vrai, ce qui
démontait l'écran courant. Après un import, le message annonçant le résultat
disparaissait donc au moment précis où il comptait. Le chargement ne vaut plus
que pour la toute première lecture.

### 4.6 Une règle CSS perdue en spécificité — _corrigé_

`.ligne-label-reglage` (0,1,0) ne battait pas `.liste li` (0,1,1) : le
formulaire de budget s'étalait en ligne et poussait ses boutons hors de l'écran
du téléphone. Un contrôle automatisé du débordement horizontal couvre désormais
les dix écrans.

### 4.7 Une impasse : signaler un problème qu'aucun écran ne résout — _corrigé_

L'accueil affichait « 2 échéances sans montant connu » et **aucun écran ne
permettait de les renseigner**. La liste des occurrences à confirmer ne
contenait que celles dont le montant était déjà connu : les plus urgentes en
étaient précisément absentes.

Elles y figurent désormais, avec la mention « montant inconnu, à renseigner » et
la saisie ouverte d'emblée — il n'y a rien à valider quand il n'y a rien
d'attendu. Le montant saisi alimente ensuite la fenêtre glissante et valorise
les mois suivants.

Trouvé en créant une récurrence variable sans montant de départ, puis en
cherchant comment la renseigner.

### 4.8 Deux notions concurrentes pour la même chose — _simplifié_

Le noyau exposait `composition.echeancesEchues` et le domaine
`occurrencesAConfirmer`. Au niveau du domaine, la première était **toujours
vide** — la fenêtre de projection commence au jour même, aucune échéance ne peut
lui être antérieure. Une valeur toujours vide finit par être lue comme « il n'y
a rien », ce qui est faux. La projection rend maintenant `aConfirmer`, calculée
sur une fenêtre de quarante-cinq jours en arrière, et le champ du noyau garde
son rôle de garde-fou à son niveau.

### 4.9 Un abonnement qui coûte sans jamais échoir — _corrigé_

Archiver un compte laissait ses abonnements « actifs » : comptés dans le coût
mensuel cumulé, mais absents de toute projection, puisqu'aucune ne parcourt un
compte archivé. Vingt-cinq euros par mois qui pèsent sans jamais arriver —
personne n'irait chercher là.

L'archivage clôt désormais les abonnements rattachés, dans la même écriture, et
l'écran de confirmation les nomme avant de le faire.

### 4.10 Un code oublié rendait l'appareil définitivement inutilisable — _corrigé_

Le code est irrécupérable, c'est une décision assumée. Mais **aucune issue
n'existait** : un appareil verrouillé le restait pour toujours, y compris pour
quelqu'un tenant sa sauvegarde en main. Tout le discours de l'application repose
sur « l'export est le filet » — encore faut-il un endroit où le lancer.

L'écran de verrouillage propose désormais « Code oublié », qui mène à un
effacement explicite : trois avertissements, et la phrase `EFFACER` à recopier à
la main — pas une case à cocher, qu'on coche sans lire. L'application redémarre
alors vierge et l'export se réimporte.

**Ce que cela ouvre, assumé** : quelqu'un qui a le téléphone peut détruire les
données sans connaître le code. Il ne peut pas les lire — c'est la seule chose
que le chiffrement promet — et il pouvait déjà désinstaller l'application. Le
risque ajouté est nul ; l'impasse qu'il lève est réelle.

**Changer de code** est également possible depuis Réglages : seule l'enveloppe
de la clé est refaite, aucune donnée n'est re-chiffrée. C'était l'intérêt du
chiffrement à enveloppe, resté jusqu'ici sans interface.

### 4.11 Accessibilité, mesurée

Audit automatisé sur les neuf écrans, application remplie : 255 textes contrôlés.
Aucun contraste sous le seuil AA, aucun champ sans étiquette, aucun bouton sans
nom accessible, un seul `h1` par écran, aucun saut de niveau de titre, focus
clavier visible, aucune cible tactile sous 40 px.

Le détecteur a lui-même été éprouvé sur une faute délibérée — un audit qui ne
trouve jamais rien n'a aucune valeur tant qu'on n'a pas vérifié qu'il sait
trouver.

---

## 5. Livré depuis

- **Temporisation exponentielle** sur échec de code, plafonnée à cinq minutes.
  Au-delà, c'est l'utilisateur légitime qu'on punit.
- **Aucun effacement automatique** après N essais : avec un code perdu et aucune
  récupération, ce serait un piège, pas une protection. Un test vérifie qu'après
  vingt échecs le coffre est intact.
- **Re-verrouillage** après deux minutes en arrière-plan.
- **Avertissement explicite** à la configuration : ce que le code protège, ce
  qu'il ne protège pas, qu'il est irrécupérable — et une case à cocher qui exige
  de le reconnaître avant de continuer.

## 6. Ce qui reste ouvert

- **Le dépôt privé de sauvegarde reste manuel.** La synchronisation automatique
  (phase 2) suppose un jeton d'accès saisi par appareil. Il n'entrera jamais dans
  le dépôt de code ; le mécanisme de stockage reste à concevoir, et c'est la
  seule nouvelle surface d'attaque prévue du projet.
- **L'export est en clair, par choix.** C'est la seule chose qui survive à un
  téléphone cassé, et elle doit rester lisible sans cette application. Un fichier
  d'export mal rangé expose tout : le dire à l'utilisateur vaut mieux que de le
  chiffrer et de perdre la clé avec le téléphone.
