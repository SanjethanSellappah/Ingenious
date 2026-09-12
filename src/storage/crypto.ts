/**
 * Chiffrement local.
 *
 * Ce n'est pas une authentification, c'est un **verrou d'appareil** : empêcher
 * quelqu'un qui emprunte le téléphone de lire les données. Sans chiffrement, le
 * PIN est un rideau qu'on contourne en ouvrant les outils de développement.
 *
 * **Chiffrement à enveloppe.** Le PIN ne chiffre pas les données : il chiffre
 * une clé de données tirée au hasard, qui, elle, chiffre les données. Vingt
 * lignes de plus, et deux problèmes disparaissent — changer de PIN ne re-chiffre
 * que la clé, et un second appareil peut recevoir la clé de données sans avoir à
 * partager le même PIN ni le même sel.
 *
 * **Conséquence assumée : PIN perdu, données perdues, sans récupération.**
 * Il n'existe aucune porte dérobée, et c'est voulu.
 */

const ALGO_DERIVATION = 'PBKDF2'
const HACHAGE = 'SHA-256'
const ALGO_CHIFFREMENT = 'AES-GCM'
const LONGUEUR_CLE = 256
const OCTETS_SEL = 16
const OCTETS_IV = 12

/**
 * Plancher d'itérations.
 *
 * Un PIN à 4 chiffres, c'est 10 000 possibilités : aucune dérivation ne rend ça
 * résistant à un attaquant outillé qui a le téléphone en main. Les itérations
 * protègent d'un curieux, pas d'un adversaire — il faut le dire à l'utilisateur
 * plutôt que de lui laisser croire l'inverse.
 */
export const ITERATIONS_PLANCHER = 600_000
const CIBLE_MS = 500

export type ParametresKdf = {
  algo: 'PBKDF2-SHA256'
  iterations: number
  sel_b64: string
}

export type Scelle = {
  iv_b64: string
  donnees_b64: string
}

/** Ce que la base garde en clair : de quoi retrouver la clé, jamais la clé. */
export type MetaCoffre = {
  version: 1
  kdf: ParametresKdf
  /** Clé de données, chiffrée par la clé dérivée du PIN. */
  cle_enveloppee: Scelle
}

export class PinIncorrect extends Error {
  constructor() {
    super('PIN incorrect')
    this.name = 'PinIncorrect'
  }
}

// --- Encodage -----------------------------------------------------------------

const encodeur = new TextEncoder()
const decodeur = new TextDecoder()

export function versBase64(octets: Uint8Array): string {
  let binaire = ''
  for (const octet of octets) binaire += String.fromCharCode(octet)
  return btoa(binaire)
}

export function depuisBase64(texte: string): Uint8Array {
  const binaire = atob(texte)
  const octets = new Uint8Array(binaire.length)
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i)
  return octets
}

function aleatoire(longueur: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(longueur))
}

// --- Dérivation ---------------------------------------------------------------

async function cleDerivee(pin: string, sel: Uint8Array, iterations: number): Promise<CryptoKey> {
  const matiere = await crypto.subtle.importKey(
    'raw',
    encodeur.encode(pin),
    ALGO_DERIVATION,
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: ALGO_DERIVATION, salt: sel as BufferSource, iterations, hash: HACHAGE },
    matiere,
    { name: ALGO_CHIFFREMENT, length: LONGUEUR_CLE },
    false,
    ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt'],
  )
}

/**
 * Calibre le nombre d'itérations pour viser ~500 ms sur *cet* appareil.
 *
 * Un nombre figé dans le code serait soit trop lent sur un vieux téléphone, soit
 * trop faible sur un ordinateur récent. Le plancher n'est jamais franchi vers
 * le bas, quelle que soit la mesure.
 */
export async function calibrerIterations(cibleMs = CIBLE_MS): Promise<number> {
  const echantillon = 100_000
  const sel = aleatoire(OCTETS_SEL)
  const depart = performance.now()
  await cleDerivee('calibrage', sel, echantillon)
  const duree = Math.max(performance.now() - depart, 0.1)
  const estime = Math.round((echantillon * cibleMs) / duree / 10_000) * 10_000
  return Math.max(ITERATIONS_PLANCHER, estime)
}

// --- Coffre -------------------------------------------------------------------

export type Coffre = {
  meta: MetaCoffre
  /**
   * Clé de données. Jamais persistée en clair, et **non exportable** : même du
   * code exécuté dans la page ne peut pas la relire. C'est une barrière modeste —
   * qui exécute du code dans la page lit de toute façon les données déchiffrées —
   * mais elle fait la différence entre lire ce qui passe et emporter la clé.
   */
  cle: CryptoKey
}

async function nouvelleCleDonnees(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: ALGO_CHIFFREMENT, length: LONGUEUR_CLE }, true, [
    'encrypt',
    'decrypt',
  ])
}

async function envelopper(cle: CryptoKey, kek: CryptoKey): Promise<Scelle> {
  const iv = aleatoire(OCTETS_IV)
  const enveloppe = await crypto.subtle.wrapKey('raw', cle, kek, {
    name: ALGO_CHIFFREMENT,
    iv: iv as BufferSource,
  })
  return { iv_b64: versBase64(iv), donnees_b64: versBase64(new Uint8Array(enveloppe)) }
}

/**
 * Déballe la clé de données.
 *
 * Le déballage **est** la vérification du PIN : AES-GCM authentifie, donc une
 * clé dérivée d'un mauvais PIN fait échouer l'opération au lieu de rendre une
 * clé fausse. Pas besoin d'un témoin scellé à côté — ce serait un second
 * chiffré sous la même clé, pour une information qu'on a déjà.
 */
async function deballer(meta: MetaCoffre, kek: CryptoKey, exportable: boolean): Promise<CryptoKey> {
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      depuisBase64(meta.cle_enveloppee.donnees_b64) as BufferSource,
      kek,
      { name: ALGO_CHIFFREMENT, iv: depuisBase64(meta.cle_enveloppee.iv_b64) as BufferSource },
      { name: ALGO_CHIFFREMENT, length: LONGUEUR_CLE },
      exportable,
      ['encrypt', 'decrypt'],
    )
  } catch {
    throw new PinIncorrect()
  }
}

/** Crée un coffre neuf : sel, clé de données, enveloppe. */
export async function creerCoffre(pin: string, iterations?: number): Promise<Coffre> {
  const tours = iterations ?? (await calibrerIterations())
  const sel = aleatoire(OCTETS_SEL)
  const kek = await cleDerivee(pin, sel, tours)
  const cleExportable = await nouvelleCleDonnees()
  const meta: MetaCoffre = {
    version: 1,
    kdf: { algo: 'PBKDF2-SHA256', iterations: tours, sel_b64: versBase64(sel) },
    cle_enveloppee: await envelopper(cleExportable, kek),
  }
  // La clé rendue est la version non exportable : celle qui a servi à
  // l'enveloppe ne sort pas de cette fonction.
  return { meta, cle: await deballer(meta, kek, false) }
}

/** Ouvre un coffre existant. Lève `PinIncorrect` si le PIN ne convient pas. */
export async function ouvrirCoffre(pin: string, meta: MetaCoffre): Promise<Coffre> {
  const kek = await cleDerivee(pin, depuisBase64(meta.kdf.sel_b64), meta.kdf.iterations)
  return { meta, cle: await deballer(meta, kek, false) }
}

/**
 * Change le PIN.
 *
 * Seule l'enveloppe est refaite : la clé de données ne change pas, donc aucune
 * donnée n'est re-chiffrée. C'est tout l'intérêt de l'enveloppe — sans elle,
 * changer de PIN imposerait de réécrire la base entière.
 */
export async function changerPin(
  coffre: Coffre,
  ancienPin: string,
  nouveauPin: string,
): Promise<MetaCoffre> {
  const iterations = coffre.meta.kdf.iterations
  const ancienneKek = await cleDerivee(ancienPin, depuisBase64(coffre.meta.kdf.sel_b64), iterations)
  // Une copie exportable est déballée juste pour cette opération, puis oubliée :
  // la clé que le reste de l'application détient reste non exportable.
  const cleExportable = await deballer(coffre.meta, ancienneKek, true)
  const sel = aleatoire(OCTETS_SEL)
  const nouvelleKek = await cleDerivee(nouveauPin, sel, iterations)
  return {
    version: 1,
    kdf: { algo: 'PBKDF2-SHA256', iterations, sel_b64: versBase64(sel) },
    cle_enveloppee: await envelopper(cleExportable, nouvelleKek),
  }
}

// --- Chiffrement des enregistrements ------------------------------------------

async function sceller(cle: CryptoKey, clair: string): Promise<Scelle> {
  const iv = aleatoire(OCTETS_IV)
  const scelle = await crypto.subtle.encrypt(
    { name: ALGO_CHIFFREMENT, iv: iv as BufferSource },
    cle,
    encodeur.encode(clair),
  )
  return { iv_b64: versBase64(iv), donnees_b64: versBase64(new Uint8Array(scelle)) }
}

async function descelller(cle: CryptoKey, scelle: Scelle): Promise<string> {
  const clair = await crypto.subtle.decrypt(
    { name: ALGO_CHIFFREMENT, iv: depuisBase64(scelle.iv_b64) as BufferSource },
    cle,
    depuisBase64(scelle.donnees_b64) as BufferSource,
  )
  return decodeur.decode(clair)
}

/**
 * Chiffre ou laisse passer.
 *
 * Tant qu'aucun PIN n'est configuré, le chiffreur est l'identité : c'est l'état
 * réel de l'application avant l'onboarding, et ça garde le débogage lisible.
 * Le reste du code n'a pas à savoir lequel des deux il utilise.
 */
export type Chiffreur = {
  actif: boolean
  chiffrer: (valeur: unknown) => Promise<unknown>
  dechiffrer: (valeur: unknown) => Promise<unknown>
}

export function chiffreurIdentite(): Chiffreur {
  return {
    actif: false,
    chiffrer: (valeur) => Promise.resolve(valeur),
    dechiffrer: (valeur) => Promise.resolve(valeur),
  }
}

export function chiffreurCoffre(coffre: Coffre): Chiffreur {
  return {
    actif: true,
    chiffrer: async (valeur) => sceller(coffre.cle, JSON.stringify(valeur)),
    dechiffrer: async (valeur) => {
      const scelle = valeur as Scelle
      if (typeof scelle?.iv_b64 !== 'string' || typeof scelle?.donnees_b64 !== 'string') {
        throw new Error('Enregistrement non chiffré dans une base chiffrée')
      }
      return JSON.parse(await descelller(coffre.cle, scelle)) as unknown
    },
  }
}

export { sceller, descelller }
