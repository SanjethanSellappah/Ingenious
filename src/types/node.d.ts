/**
 * Le strict minimum de Node, pour les tests seulement.
 *
 * Les épreuves des lecteurs de classeur portent sur de vrais fichiers, rangés
 * à côté d'elles : il faut donc savoir lire un fichier. Plutôt que d'ajouter
 * `@types/node` — qui rendrait `process`, `Buffer` et le reste visibles dans
 * tout le code de l'application, y compris là où ils n'ont rien à faire — on
 * déclare ici la seule fonction employée.
 */
declare module 'node:fs' {
  export function readFileSync(chemin: string): Uint8Array
}
