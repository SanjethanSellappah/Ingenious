/**
 * Montants.
 *
 * Un montant est un **entier de centimes**. Jamais un flottant : 0,1 + 0,2 ne
 * fait pas 0,3 en binaire, et l'erreur s'accumule silencieusement sur une
 * projection à trois mois. Le type est marqué pour qu'un `number` ordinaire ne
 * puisse pas se glisser dans un calcul d'argent sans passer par une conversion
 * explicite.
 *
 * Une seule fonction arrondit — `arrondirCents`. Le jour où la règle d'arrondi
 * doit changer, il n'y a qu'un endroit à relire.
 */

declare const marqueCents: unique symbol

/** Montant en centimes, entier signé. Négatif = sortie d'argent. */
export type Cents = number & { readonly [marqueCents]: true }

export const ZERO = 0 as Cents

/** Marque un entier comme montant. Lève sur un flottant ou un non-fini. */
export function cents(valeur: number): Cents {
  if (!Number.isFinite(valeur)) throw new TypeError(`Montant non fini : ${valeur}`)
  if (!Number.isInteger(valeur)) {
    throw new TypeError(`Montant non entier : ${valeur}. Un montant est en centiemes entiers.`)
  }
  if (!Number.isSafeInteger(valeur)) throw new RangeError(`Montant hors bornes sûres : ${valeur}`)
  return valeur as Cents
}

/**
 * Arrondit un calcul intermédiaire au centime.
 *
 * Arrondi commercial : le demi s'éloigne de zéro, symétriquement pour les
 * négatifs. `Math.round` seul ne convient pas — il arrondit vers +∞, donc
 * −0,5 donnerait 0 et une dépense s'allégerait d'un centime à chaque arrondi.
 */
export function arrondirCents(valeur: number): Cents {
  if (!Number.isFinite(valeur)) throw new TypeError(`Montant non fini : ${valeur}`)
  const arrondi = valeur < 0 ? -Math.round(-valeur) : Math.round(valeur)
  return cents(arrondi)
}

/** Somme de montants. Vide vaut zéro. */
export function somme(montants: readonly Cents[]): Cents {
  let total = 0
  for (const m of montants) total += m
  return cents(total)
}

export function ajouter(a: Cents, b: Cents): Cents {
  return cents(a + b)
}

export function soustraire(a: Cents, b: Cents): Cents {
  return cents(a - b)
}

export function negatif(montant: Cents): Cents {
  return cents(0 - montant)
}

export function valeurAbsolue(montant: Cents): Cents {
  return cents(Math.abs(montant))
}

/** Multiplie par un facteur réel (taux, quantité) et arrondit au centime. */
export function multiplier(montant: Cents, facteur: number): Cents {
  if (!Number.isFinite(facteur)) throw new TypeError(`Facteur non fini : ${facteur}`)
  return arrondirCents(montant * facteur)
}

// `\s` couvre déjà l'espace insécable et l'espace fine insécable ; l'apostrophe
// est le séparateur de milliers suisse, qu'un copier-coller peut amener.
const ESPACES = /[\s']/g
const SEPARATEUR_FINAL = /^(-?)(\d*)(?:[.,](\d{0,2}))?$/

/**
 * Analyse une saisie française.
 *
 * Accepte « 12,50 », « 12.50 », « 1 234,56 », « 12 € », « -12,5 », « ,5 ».
 * Refuse tout ce qui a plus de deux décimales : tronquer en silence une saisie
 * à trois décimales, c'est perdre de l'argent sans le dire. Retourne `null`
 * plutôt que de lever — une frappe en cours n'est pas une erreur de programme.
 */
export function analyserMontant(texte: string): Cents | null {
  const nettoye = texte.replace(ESPACES, '').replace(/€|EUR/gi, '').replace(/^\+/, '')
  if (nettoye === '' || nettoye === '-') return null
  const m = SEPARATEUR_FINAL.exec(nettoye)
  if (!m) return null
  const [, signe, entiere = '', decimale] = m
  if (entiere === '' && (decimale === undefined || decimale === '')) return null
  const centimes =
    Number(`${entiere || '0'}`) * 100 + Number((decimale ?? '').padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(centimes)) return null
  return cents(signe === '-' ? -centimes : centimes)
}

const FORMAT_EUROS = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const FORMAT_NOMBRE = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export type OptionsFormat = {
  /** Préfixe « + » les montants positifs. Le signe ne doit jamais être porté par la seule couleur. */
  signeExplicite?: boolean
  /** Retire le symbole « € ». */
  sansSymbole?: boolean
}

/** Formate un montant pour l'affichage : « 1 234,56 € ». */
export function formaterMontant(montant: Cents, options: OptionsFormat = {}): string {
  const euros = montant / 100
  const format = options.sansSymbole ? FORMAT_NOMBRE : FORMAT_EUROS
  const rendu = format.format(euros)
  return options.signeExplicite && montant > 0 ? `+${rendu}` : rendu
}

/** Formate pour une saisie : ni symbole, ni séparateur de milliers, virgule décimale. */
export function formaterPourSaisie(montant: Cents): string {
  const signe = montant < 0 ? '-' : ''
  const absolu = Math.abs(montant)
  return `${signe}${Math.floor(absolu / 100)},${String(absolu % 100).padStart(2, '0')}`
}
