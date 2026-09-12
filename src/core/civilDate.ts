/**
 * Dates civiles.
 *
 * Une date métier est une chaîne `YYYY-MM-DD`, jamais un `Date` ni un epoch :
 * « le 3 du mois » n'est pas un instant, et le traiter comme tel le décale d'un
 * jour selon le fuseau et l'heure de saisie. Le bug est silencieux — il ne lève
 * rien, il produit un chiffre faux.
 *
 * Toute l'arithmétique passe par le numéro de jour (jours depuis 1970-01-01),
 * calculé par l'algorithme de Howard Hinnant. Aucun `Date` n'est construit ici :
 * ajouter un jour, c'est ajouter 1, et le jour de la semaine tombe du même
 * calcul. Rien à décaler, donc rien à décaler de travers.
 */

declare const marqueDateCivile: unique symbol

/** Date civile `YYYY-MM-DD`, validée à la construction. */
export type CivilDate = string & { readonly [marqueDateCivile]: true }

const FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/

export type Composantes = { annee: number; mois: number; jour: number }

/** Vrai si l'année est bissextile au sens grégorien. */
export function estBissextile(annee: number): boolean {
  return (annee % 4 === 0 && annee % 100 !== 0) || annee % 400 === 0
}

const JOURS_PAR_MOIS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Nombre de jours du mois (1–12) de l'année donnée. */
export function joursDansLeMois(annee: number, mois: number): number {
  if (mois < 1 || mois > 12) throw new RangeError(`Mois hors bornes : ${mois}`)
  if (mois === 2 && estBissextile(annee)) return 29
  return JOURS_PAR_MOIS[mois - 1]!
}

/** Construit une date civile depuis ses composantes. Rejette le 31 avril comme le 29 février non bissextile. */
export function depuisComposantes(annee: number, mois: number, jour: number): CivilDate {
  if (!Number.isInteger(annee) || !Number.isInteger(mois) || !Number.isInteger(jour)) {
    throw new TypeError(`Composantes non entières : ${annee}-${mois}-${jour}`)
  }
  if (annee < 1 || annee > 9999) throw new RangeError(`Année hors bornes : ${annee}`)
  if (mois < 1 || mois > 12) throw new RangeError(`Mois hors bornes : ${mois}`)
  const max = joursDansLeMois(annee, mois)
  if (jour < 1 || jour > max) {
    throw new RangeError(`Le ${jour}/${mois}/${annee} n'existe pas (le mois compte ${max} jours)`)
  }
  return `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}` as CivilDate
}

/** Valide une chaîne et la marque comme date civile. Lève si la date n'existe pas. */
export function dateCivile(texte: string): CivilDate {
  const m = FORMAT.exec(texte)
  if (!m) throw new TypeError(`Date civile attendue au format YYYY-MM-DD, reçu « ${texte} »`)
  return depuisComposantes(Number(m[1]), Number(m[2]), Number(m[3]))
}

/** Vrai si la chaîne est une date civile existante. Ne lève pas. */
export function estDateCivile(texte: string): boolean {
  try {
    dateCivile(texte)
    return true
  } catch {
    return false
  }
}

/** Décompose une date civile. */
export function composantes(date: CivilDate): Composantes {
  const m = FORMAT.exec(date)!
  return { annee: Number(m[1]), mois: Number(m[2]), jour: Number(m[3]) }
}

/**
 * Numéro de jour : nombre de jours depuis le 1er janvier 1970, négatif avant.
 * Algorithme de Hinnant — exact sur tout le calendrier grégorien proleptique.
 */
export function numeroDeJour(date: CivilDate): number {
  const { annee, mois, jour } = composantes(date)
  const a = annee - (mois <= 2 ? 1 : 0)
  const ere = Math.floor(a / 400)
  const anneeDansEre = a - ere * 400 // 0–399
  const jourDansAnnee = Math.floor((153 * (mois + (mois > 2 ? -3 : 9)) + 2) / 5) + jour - 1
  const jourDansEre =
    anneeDansEre * 365 +
    Math.floor(anneeDansEre / 4) -
    Math.floor(anneeDansEre / 100) +
    jourDansAnnee
  return ere * 146097 + jourDansEre - 719468
}

/** Inverse de `numeroDeJour`. */
export function depuisNumeroDeJour(numero: number): CivilDate {
  const z = numero + 719468
  const ere = Math.floor(z / 146097)
  const jourDansEre = z - ere * 146097 // 0–146096
  const anneeDansEre = Math.floor(
    (jourDansEre -
      Math.floor(jourDansEre / 1460) +
      Math.floor(jourDansEre / 36524) -
      Math.floor(jourDansEre / 146096)) /
      365,
  )
  const a = anneeDansEre + ere * 400
  const jourDansAnnee =
    jourDansEre -
    (365 * anneeDansEre + Math.floor(anneeDansEre / 4) - Math.floor(anneeDansEre / 100))
  const mp = Math.floor((5 * jourDansAnnee + 2) / 153) // 0–11, mars = 0
  const jour = jourDansAnnee - Math.floor((153 * mp + 2) / 5) + 1
  const mois = mp + (mp < 10 ? 3 : -9)
  return depuisComposantes(a + (mois <= 2 ? 1 : 0), mois, jour)
}

/** Jour de la semaine : 0 = dimanche, 6 = samedi, comme `Date.getDay`. */
export function jourDeLaSemaine(date: CivilDate): number {
  const z = numeroDeJour(date)
  return z >= -4 ? (z + 4) % 7 : ((z + 5) % 7) + 6
}

/** Ajoute `nombre` jours, éventuellement négatif. */
export function ajouterJours(date: CivilDate, nombre: number): CivilDate {
  return depuisNumeroDeJour(numeroDeJour(date) + nombre)
}

/**
 * Ajoute `nombre` mois en conservant le quantième, **rogné au dernier jour du
 * mois d'arrivée** : 31 janvier + 1 mois donne le 28 ou le 29 février.
 *
 * Attention : ce rognage ne se rattrape pas au mois suivant. Une récurrence ne
 * doit donc jamais s'itérer par additions successives — elle se recalcule
 * toujours depuis son mois d'ancrage (voir `recurrence.ts`).
 */
export function ajouterMois(date: CivilDate, nombre: number): CivilDate {
  const { annee, mois, jour } = composantes(date)
  const indice = annee * 12 + (mois - 1) + nombre
  const anneeCible = Math.floor(indice / 12)
  const moisCible = (indice % 12) + 1
  return depuisComposantes(
    anneeCible,
    moisCible,
    Math.min(jour, joursDansLeMois(anneeCible, moisCible)),
  )
}

/** Nombre de mois calendaires entre deux dates, quantièmes ignorés. */
export function moisEntre(depuis: CivilDate, jusqua: CivilDate): number {
  const a = composantes(depuis)
  const b = composantes(jusqua)
  return (b.annee - a.annee) * 12 + (b.mois - a.mois)
}

/** Nombre de jours de `depuis` à `jusqua`, négatif si `jusqua` précède. */
export function joursEntre(depuis: CivilDate, jusqua: CivilDate): number {
  return numeroDeJour(jusqua) - numeroDeJour(depuis)
}

export function premierJourDuMois(date: CivilDate): CivilDate {
  const { annee, mois } = composantes(date)
  return depuisComposantes(annee, mois, 1)
}

export function dernierJourDuMois(date: CivilDate): CivilDate {
  const { annee, mois } = composantes(date)
  return depuisComposantes(annee, mois, joursDansLeMois(annee, mois))
}

/** Négatif si `a` précède `b`, zéro si identiques, positif sinon. Le format trie comme la chronologie. */
export function comparer(a: CivilDate, b: CivilDate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function estAvant(a: CivilDate, b: CivilDate): boolean {
  return a < b
}

export function estApres(a: CivilDate, b: CivilDate): boolean {
  return a > b
}

/** Bornes incluses. */
export function estDans(date: CivilDate, debut: CivilDate, fin: CivilDate): boolean {
  return date >= debut && date <= fin
}

export function minDate(a: CivilDate, b: CivilDate): CivilDate {
  return a <= b ? a : b
}

export function maxDate(a: CivilDate, b: CivilDate): CivilDate {
  return a >= b ? a : b
}

/** Toutes les dates de `debut` à `fin`, bornes incluses. */
export function intervalleDeJours(debut: CivilDate, fin: CivilDate): CivilDate[] {
  const dates: CivilDate[] = []
  for (let n = numeroDeJour(debut); n <= numeroDeJour(fin); n++) dates.push(depuisNumeroDeJour(n))
  return dates
}

const NOMS_JOURS = [
  'dimanche',
  'lundi',
  'mardi',
  'mercredi',
  'jeudi',
  'vendredi',
  'samedi',
] as const

/** Nom français du jour de la semaine. */
export function nomDuJour(date: CivilDate): (typeof NOMS_JOURS)[number] {
  return NOMS_JOURS[jourDeLaSemaine(date)]!
}
