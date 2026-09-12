/**
 * Identifiants d'entités.
 *
 * Distincts des identifiants d'événements, qui sont des UUID v4 : un compte ou
 * un abonnement porte un identifiant lisible, ce qui rend un journal exporté
 * relisible à l'œil nu — et c'est tout l'intérêt d'un export en clair.
 */
export function identifiant(prefixe: string): string {
  return `${prefixe}-${crypto.randomUUID().slice(0, 12)}`
}
