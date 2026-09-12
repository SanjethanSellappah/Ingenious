# Modèle de menace et revue de sécurité

Document tenu à jour à chaque revue. La dernière porte sur le lot 2 —
chiffrement, dépôt, validation du journal.

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

## 4. Reste à faire

- **Temporisation exponentielle** sur échec de PIN, et re-verrouillage sur
  `visibilitychange` — lot 4, quand l'écran de verrouillage existera.
- **Pas d'effacement automatique** après N essais : avec un PIN perdu et aucune
  récupération, ce serait un piège, pas une protection. Décision arrêtée.
- **Avertissement explicite** à la configuration du PIN : ce qu'il protège, ce
  qu'il ne protège pas, et qu'il est irrécupérable.
