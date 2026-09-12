/**
 * Validation des données entrantes.
 *
 * Le journal est validé **à l'écriture et à la lecture**. À l'écriture parce
 * qu'un événement mal formé empoisonne tout l'état dérivé ; à la lecture parce
 * qu'un fichier d'import peut avoir été tronqué, édité à la main, ou produit par
 * une version plus ancienne.
 *
 * Un événement refusé doit être **nommé**, pas avalé : « champ `montant_cents`
 * attendu entier » se corrige, « import échoué » ne se corrige pas.
 */

export class ErreurValidation extends Error {
  constructor(
    readonly chemin: string,
    readonly detail: string,
  ) {
    super(`${chemin} : ${detail}`)
    this.name = 'ErreurValidation'
  }
}

function echouer(chemin: string, detail: string): never {
  throw new ErreurValidation(chemin || 'valeur', detail)
}

export function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)
}

export function objet(valeur: unknown, chemin = ''): Record<string, unknown> {
  if (!estObjet(valeur)) echouer(chemin, `objet attendu, reçu ${typeNom(valeur)}`)
  return valeur
}

export function chaine(
  valeur: unknown,
  chemin: string,
  options: { min?: number; max?: number } = {},
): string {
  if (typeof valeur !== 'string') echouer(chemin, `chaîne attendue, reçu ${typeNom(valeur)}`)
  const min = options.min ?? 1
  if (valeur.length < min) echouer(chemin, `chaîne d'au moins ${min} caractère(s) attendue`)
  if (options.max !== undefined && valeur.length > options.max) {
    echouer(chemin, `chaîne d'au plus ${options.max} caractères attendue`)
  }
  return valeur
}

export function entier(
  valeur: unknown,
  chemin: string,
  options: { min?: number; max?: number } = {},
): number {
  if (typeof valeur !== 'number' || !Number.isFinite(valeur)) {
    echouer(chemin, `nombre attendu, reçu ${typeNom(valeur)}`)
  }
  if (!Number.isSafeInteger(valeur)) echouer(chemin, `entier sûr attendu, reçu ${valeur}`)
  if (options.min !== undefined && valeur < options.min) echouer(chemin, `minimum ${options.min}`)
  if (options.max !== undefined && valeur > options.max) echouer(chemin, `maximum ${options.max}`)
  return valeur
}

export function booleen(valeur: unknown, chemin: string): boolean {
  if (typeof valeur !== 'boolean') echouer(chemin, `booléen attendu, reçu ${typeNom(valeur)}`)
  return valeur
}

export function parmi<const T extends readonly string[]>(
  valeur: unknown,
  chemin: string,
  valeurs: T,
): T[number] {
  if (typeof valeur !== 'string' || !valeurs.includes(valeur)) {
    echouer(chemin, `attendu l'une de [${valeurs.join(', ')}], reçu ${JSON.stringify(valeur)}`)
  }
  return valeur
}

export function tableau(valeur: unknown, chemin: string): unknown[] {
  if (!Array.isArray(valeur)) echouer(chemin, `tableau attendu, reçu ${typeNom(valeur)}`)
  return valeur
}

/** Applique `lire` seulement si le champ est présent et non `null`. */
export function optionnel<T>(valeur: unknown, lire: (valeur: unknown) => T): T | undefined {
  return valeur === undefined || valeur === null ? undefined : lire(valeur)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function uuid(valeur: unknown, chemin: string): string {
  const texte = chaine(valeur, chemin)
  if (!UUID.test(texte)) echouer(chemin, `UUID attendu, reçu ${JSON.stringify(texte)}`)
  return texte
}

function typeNom(valeur: unknown): string {
  if (valeur === null) return 'null'
  if (Array.isArray(valeur)) return 'tableau'
  return typeof valeur
}

/**
 * Retire les clés dont la valeur est `undefined`.
 *
 * Un champ optionnel absent ne doit pas laisser une clé à `undefined` dans le
 * journal : `JSON.stringify` la supprimerait à l'export mais pas à la
 * comparaison, et deux événements identiques cesseraient de se reconnaître.
 */
export function sansIndefinis(valeurs: Record<string, unknown>): Record<string, unknown> {
  const resultat: Record<string, unknown> = {}
  for (const [cle, valeur] of Object.entries(valeurs)) {
    if (valeur !== undefined) resultat[cle] = valeur
  }
  return resultat
}
