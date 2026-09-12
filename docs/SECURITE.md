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

### 4.11 Confirmer une échéance ne servait à rien — _corrigé_

Le plan d'action annonçait une « vue mouvement unifiée » incluant les
occurrences réalisées ; le type existait, il n'était **jamais peuplé**. Une
échéance confirmée ne comptait donc nulle part : ni dans le solde, ni dans les
dépenses par label. Sept cents euros de loyer confirmés laissaient le compte à
son montant d'avant, et le poste « Logement » à zéro.

Deux conséquences, toutes deux dans le contexte : le §4.2 promettait qu'« un
label inclut les prélèvements récurrents sans double saisie », et l'écran « à
confirmer » n'avait aucun effet visible — un geste qu'on cesse de faire au bout
de deux fois.

Une occurrence confirmée est désormais un mouvement à part entière : datée au
jour décalé, signée selon le sens de l'abonnement, portant son label. Le tarif
initial d'un abonnement vaut de surcroît **depuis sa date de début** et non
depuis aujourd'hui — sans quoi toutes ses échéances antérieures restaient sans
montant et étaient réclamées sans raison.

Le solde, lui, ne bouge que si l'échéance est postérieure au dernier relevé.
C'est l'invariant §4.3 qui le veut, et l'écran le dit maintenant plutôt que de
laisser croire l'inverse.

### 4.12 Accessibilité, mesurée

Audit automatisé sur les neuf écrans, application remplie : 255 textes contrôlés.
Aucun contraste sous le seuil AA, aucun champ sans étiquette, aucun bouton sans
nom accessible, un seul `h1` par écran, aucun saut de niveau de titre, focus
clavier visible, aucune cible tactile sous 40 px.

Le détecteur a lui-même été éprouvé sur une faute délibérée — un audit qui ne
trouve jamais rien n'a aucune valeur tant qu'on n'a pas vérifié qu'il sait
trouver.

---

## 5. Revue des entrées et des sorties

### 5.1 Un import refusé ne disait pas pourquoi — _corrigé_

`valider.ts` pose la règle : « un événement refusé doit être **nommé**, pas
avalé ». La validation la tenait — chaque rejet porte le rang de l'événement et
le champ fautif — mais l'écran d'import jetait ces phrases et n'affichait qu'un
compte. « 412 refusés » ne laisse rien à faire ; « event[3].payload.date : date
civile YYYY-MM-DD attendue, reçu "2026-02-30" » se corrige dans le fichier.

Les cinq premières raisons sont désormais affichées — un fichier corrompu en
produit parfois des milliers d'identiques, et les afficher toutes noierait la
seule ligne utile.

### 5.2 Le fichier d'import, éprouvé pour de bon

Treize fichiers hostiles passés par l'écran réel, pas par un test unitaire :
`__proto__` et `constructor.prototype` dans une charge utile, entier hors des
entiers sûrs, `ts` négatif, identifiant non-UUID, type d'événement inventé,
charge utile en tableau, texte de 100 000 caractères, JSON tronqué, en-tête
étranger, version future, date du 30 février, identifiants en double.

Résultat : aucune pollution de prototype (`Object.prototype` intact), chaque
refus nommé, l'en-tête vérifié avant tout, les doublons fusionnés par union sur
`id`, et l'application toujours vivante après les treize. Les charges utiles
valides portant une clé hostile sont acceptées et la clé conservée telle quelle
— c'est une donnée, jamais une instruction.

### 5.3 L'export pouvait mentir sur iPhone — _corrigé_

Tout le filet tient à ce bouton, et il était écrit pour un navigateur de bureau :
`<a download>` sur une URL blob, avec révocation immédiate après le clic.

Deux défauts, et le second est grave. Révoquer dans la foulée du clic annule le
téléchargement sur plusieurs navigateurs, sans erreur visible. Surtout, Safari
ignore `download` pour une URL blob et **ouvre le contenu dans un onglet** :
l'utilisateur croit avoir sauvegardé, le rappel de sauvegarde disparaît, et il
n'a aucun fichier. Une application dont la seule protection est l'export ne peut
pas se tromper là-dessus, sur l'appareil même qu'elle vise.

L'export passe maintenant par la feuille de partage du système quand le
navigateur l'accepte pour un fichier — c'est elle qui donne « Enregistrer dans
Fichiers » sur iOS — et retombe sur le lien sinon, lien attaché au document et
URL révoquée au tour suivant. Un partage annulé n'efface pas le rappel : ce
n'est pas une sauvegarde. Un refus du navigateur (geste consommé par l'attente
du journal) retombe sur le téléchargement.

Les quatre chemins sont vérifiés dans un vrai navigateur : téléchargement,
partage accepté, partage annulé — rappel toujours présent sur les deux écrans
qui le portent —, partage refusé avec repli.

### 5.4 L'écran de verrouillage n'avait aucun repère de page — _corrigé_

L'audit d'accessibilité ne portait que sur les onze écrans accessibles par une
route. Il en manquait sept : les trois écrans de détail, les deux écrans
« introuvable », et surtout les cinq écrans de verrou — ceux qu'on n'atteint
pas par une URL, et que rencontre en premier quiconque a configuré un code.

Étendu à seize écrans plus les cinq du verrou, il a trouvé : l'écran de saisie
du code était un `<form>` nu, sans `<main>`. Tous les autres écrans en ont un.
Un lecteur d'écran y arrivait sans repère de page et sans nulle part où sauter,
sur la première chose que l'application montre. Le formulaire est désormais
enveloppé dans un `<main>`, la mise en page inchangée et mesurée.

Le reste est propre sur les vingt et un écrans : aucun contraste sous le seuil
AA, aucun champ sans étiquette, un seul `h1`, aucun saut de niveau de titre.

### 5.5 Restaurer exigeait d'abîmer ses données d'abord — _corrigé_

Le téléphone remplacé est *le* cas pour lequel l'export existe. Or l'import ne
vivait que dans Réglages, et Réglages n'est joignable qu'une fois l'application
ouverte — c'est-à-dire une fois un compte créé. Pour récupérer sa sauvegarde, il
fallait donc inventer un compte fictif, traverser tout le démarrage à froid, et
seulement alors importer. Ce compte restait ensuite dans le patrimoine : le
journal est append-only, on ne l'efface jamais, on l'archive au mieux.

Demander d'abîmer ses données pour récupérer ses données n'est pas une procédure
de secours. L'écran de bienvenue porte désormais la restauration.

Un détail qui aurait annulé la correction précédente : une restauration réussie
fait apparaître des comptes, donc l'application s'ouvre d'elle-même et l'écran
disparaît — les refus s'y seraient affichés le temps d'un clignement, sur
l'écran même où l'on répare une sauvegarde abîmée. Quand il reste quelque chose
à lire, l'ouverture attend un clic.

### 5.6 Fusion multi-appareils, éprouvée pour de bon

L'union sur `id` sans arbitrage est la décision d'architecture dont tout le
reste dépend. Elle n'avait jamais été conduite de bout en bout dans un
navigateur, seulement testée unitairement.

Trois appareils réels : A installé, B neuf restauré depuis A, puis saisies
indépendantes de part et d'autre, échange croisé des exports. Vérifié —
convergence stricte de ce que l'utilisateur voit (patrimoine, comptes,
abonnements, taille du journal), réimport du même fichier sans effet, et le cas
qui compte : A corrige un mouvement pendant que B le supprime. Même verdict des
deux côtés, et sur un troisième appareil qui importe dans l'ordre inverse.

### 5.7 `Date` confiné, et la règle vérifiée

Une date métier est une chaîne `YYYY-MM-DD` ; un `Date` promené dans le calcul
se décale d'un jour selon le fuseau, sans lever d'exception. La règle existait
en commentaire, et une seule ligne y contrevenait déjà. Elle est désormais
tenue par un test qui parcourt les sources et nomme le fichier, la ligne et le
code fautif — éprouvé en cassant la règle exprès.

---

## 6. Livré depuis

- **Temporisation exponentielle** sur échec de code, plafonnée à cinq minutes.
  Au-delà, c'est l'utilisateur légitime qu'on punit.
- **Aucun effacement automatique** après N essais : avec un code perdu et aucune
  récupération, ce serait un piège, pas une protection. Un test vérifie qu'après
  vingt échecs le coffre est intact.
- **Re-verrouillage** après deux minutes en arrière-plan.
- **Avertissement explicite** à la configuration : ce que le code protège, ce
  qu'il ne protège pas, qu'il est irrécupérable — et une case à cocher qui exige
  de le reconnaître avant de continuer.

## 7. Ce qui reste ouvert

- **Le dépôt privé de sauvegarde reste manuel.** La synchronisation automatique
  (phase 2) suppose un jeton d'accès saisi par appareil. Il n'entrera jamais dans
  le dépôt de code ; le mécanisme de stockage reste à concevoir, et c'est la
  seule nouvelle surface d'attaque prévue du projet.
- **L'export est en clair, par choix.** C'est la seule chose qui survive à un
  téléphone cassé, et elle doit rester lisible sans cette application. Un fichier
  d'export mal rangé expose tout : le dire à l'utilisateur vaut mieux que de le
  chiffrer et de perdre la clé avec le téléphone.
