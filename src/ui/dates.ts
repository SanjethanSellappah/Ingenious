/**
 * Les dates telles qu'on les lit, une fois pour toutes.
 *
 * Trois écrans écrivaient chacun leur propre `jourCourt`, et deux leur propre
 * liste de mois. Le calendrier, lui, n'affichait que le quantième : « 03 ·
 * Prélèvement Navigo ». Dans la grille, au-dessus, le mois était écrit — mais
 * une liste se fait défiler, et la grille sort de l'écran. Il restait alors un
 * nombre à deux chiffres qui ne dit pas de quel mois il parle.
 *
 * Une date porte donc toujours son mois. Ce n'est pas un détail de rendu : une
 * échéance mal datée est une échéance qu'on croit passée, ou qu'on croit à
 * venir.
 */
import type { CivilDate } from '../core/civilDate'

export const NOMS_MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const

/** `2026-09-03` → `03/09`. Court, mais jamais ambigu sur le mois. */
export function jourEtMois(date: CivilDate | string): string {
  const [, mois, jour] = date.split('-')
  return `${jour ?? '??'}/${mois ?? '??'}`
}

/** `2026-09-03` → `3 septembre`. Pour un titre, où la place existe. */
export function jourEnLettres(date: CivilDate | string): string {
  const [, mois, jour] = date.split('-')
  const nom = NOMS_MOIS[Number(mois) - 1]
  if (nom === undefined) return String(date)
  return `${Number(jour)} ${nom}`
}
