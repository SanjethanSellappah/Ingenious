/**
 * Jours fériés français.
 *
 * Calculés, jamais embarqués en table : onze jours, dont trois mobiles qui se
 * déduisent de Pâques. Une table finirait périmée, et c'est le genre de péremption
 * qu'on ne remarque qu'en constatant une échéance décalée du mauvais côté.
 *
 * Ne couvre pas les jours propres à l'Alsace-Moselle (Vendredi saint, 26 décembre)
 * ni à l'outre-mer.
 */
import {
  ajouterJours,
  composantes,
  depuisComposantes,
  jourDeLaSemaine,
  type CivilDate,
} from './civilDate'

export type NomFerie =
  | "jour de l'an"
  | 'lundi de Pâques'
  | 'fête du Travail'
  | 'victoire 1945'
  | 'Ascension'
  | 'lundi de Pentecôte'
  | 'fête nationale'
  | 'Assomption'
  | 'Toussaint'
  | 'armistice 1918'
  | 'Noël'

/**
 * Dimanche de Pâques, algorithme de Meeus/Jones/Butler pour le calendrier
 * grégorien. Pâques n'est pas férié en France — c'est le lundi qui suit — mais
 * il est l'ancre des trois fêtes mobiles.
 */
export function paques(annee: number): CivilDate {
  if (!Number.isInteger(annee)) throw new TypeError(`Année non entière : ${annee}`)
  const a = annee % 19
  const b = Math.floor(annee / 100)
  const c = annee % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mois = Math.floor((h + l - 7 * m + 114) / 31)
  const jour = ((h + l - 7 * m + 114) % 31) + 1
  return depuisComposantes(annee, mois, jour)
}

/** Les onze fériés de l'année, indexés par date. */
export function joursFeries(annee: number): Map<CivilDate, NomFerie> {
  const dimanchePaques = paques(annee)
  const feries = new Map<CivilDate, NomFerie>([
    [depuisComposantes(annee, 1, 1), "jour de l'an"],
    [ajouterJours(dimanchePaques, 1), 'lundi de Pâques'],
    [depuisComposantes(annee, 5, 1), 'fête du Travail'],
    [depuisComposantes(annee, 5, 8), 'victoire 1945'],
    [ajouterJours(dimanchePaques, 39), 'Ascension'],
    [ajouterJours(dimanchePaques, 50), 'lundi de Pentecôte'],
    [depuisComposantes(annee, 7, 14), 'fête nationale'],
    [depuisComposantes(annee, 8, 15), 'Assomption'],
    [depuisComposantes(annee, 11, 1), 'Toussaint'],
    [depuisComposantes(annee, 11, 11), 'armistice 1918'],
    [depuisComposantes(annee, 12, 25), 'Noël'],
  ])
  return feries
}

const cache = new Map<number, Map<CivilDate, NomFerie>>()

function feriesDeLAnnee(annee: number): Map<CivilDate, NomFerie> {
  let feries = cache.get(annee)
  if (!feries) {
    feries = joursFeries(annee)
    cache.set(annee, feries)
  }
  return feries
}

/** Nom du férié, ou `null`. Une projection interroge le même jour des dizaines de fois : le calcul est mis en cache par année. */
export function nomDuFerie(date: CivilDate): NomFerie | null {
  return feriesDeLAnnee(composantes(date).annee).get(date) ?? null
}

export function estFerie(date: CivilDate): boolean {
  return nomDuFerie(date) !== null
}

/** Samedi ou dimanche. */
export function estWeekend(date: CivilDate): boolean {
  const jour = jourDeLaSemaine(date)
  return jour === 0 || jour === 6
}

/** Ni week-end, ni férié. C'est le jour où une banque bouge de l'argent. */
export function estJourOuvre(date: CivilDate): boolean {
  return !estWeekend(date) && !estFerie(date)
}

/** Premier jour ouvré à partir de `date` incluse, en avançant. */
export function prochainJourOuvre(date: CivilDate): CivilDate {
  let courant = date
  for (let garde = 0; garde < 30; garde++) {
    if (estJourOuvre(courant)) return courant
    courant = ajouterJours(courant, 1)
  }
  throw new Error(`Aucun jour ouvré trouvé après ${date}`)
}

/** Premier jour ouvré à partir de `date` incluse, en reculant. */
export function precedentJourOuvre(date: CivilDate): CivilDate {
  let courant = date
  for (let garde = 0; garde < 30; garde++) {
    if (estJourOuvre(courant)) return courant
    courant = ajouterJours(courant, -1)
  }
  throw new Error(`Aucun jour ouvré trouvé avant ${date}`)
}
