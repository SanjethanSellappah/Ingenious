/**
 * Horloge de l'application.
 *
 * C'est le seul endroit où un instant devient une date civile. Partout ailleurs,
 * une date métier est une chaîne `YYYY-MM-DD` : un `Date` promené dans le calcul
 * finit par se décaler d'un jour selon le fuseau et l'heure de saisie, et ce bug
 * ne se voit pas — il produit un chiffre faux, pas une erreur.
 *
 * La source d'instant est remplaçable, parce qu'un test de projection qui dépend
 * du jour où il tourne n'est pas un test.
 */
import { depuisComposantes, type CivilDate } from './civilDate'

export type { CivilDate }

/** Source d'instant. Remplacée en test, jamais en production. */
export type SourceInstant = () => Date

const sourceParDefaut: SourceInstant = () => new Date()

let source: SourceInstant = sourceParDefaut

/** Instant courant en millisecondes epoch. C'est ce que porte `Event.ts`. */
export function maintenant(): number {
  return source().getTime()
}

/**
 * Date civile d'aujourd'hui, dans le fuseau de l'appareil.
 *
 * Volontairement calculée sur les composantes locales : à 00 h 30 à Paris en
 * hiver, l'instant est encore la veille en UTC. C'est la date locale qui est la
 * bonne — c'est celle que l'utilisateur lit sur son relevé.
 */
export function aujourdhui(): CivilDate {
  return dateCivileLocale(source())
}

/** Composantes locales d'un instant, converties en date civile. */
export function dateCivileLocale(instant: Date): CivilDate {
  return depuisComposantes(instant.getFullYear(), instant.getMonth() + 1, instant.getDate())
}

/** Fixe la source d'instant. Réservé aux tests. */
export function fixerHorloge(instant: Date | SourceInstant): void {
  source = typeof instant === 'function' ? instant : () => instant
}

/** Rétablit l'horloge système. Réservé aux tests. */
export function reinitialiserHorloge(): void {
  source = sourceParDefaut
}
