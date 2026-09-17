/**
 * Lecture d'un classeur `.xls`, le format binaire d'Excel 97.
 *
 * Il n'a rien à voir avec le `.xlsx` : pas d'archive, pas de XML, mais un flux
 * d'enregistrements — un type, une longueur, des octets — rangé dans un
 * conteneur OLE2. C'est un format de 1997, et les banques l'exportent encore.
 *
 * Trois pièges portent l'essentiel du risque, et tous les trois donnent des
 * chiffres faux plutôt qu'une erreur :
 *
 * - **Les nombres « RK » sont compressés.** Pour tenir sur quatre octets au
 *   lieu de huit, Excel range soit un entier, soit les trente-deux bits de
 *   poids fort d'un flottant, avec éventuellement une division par cent. Se
 *   tromper de branche fait un facteur cent, ou un nombre absurde.
 * - **Un texte peut être coupé en plein milieu.** Les libellés sont rangés dans
 *   une table commune qui déborde sur des enregistrements de continuation, et
 *   **chaque continuation recommence par son propre octet d'encodage** : la
 *   suite d'un texte en un octet par caractère peut se poursuivre en deux. Lire
 *   tout droit donne du charabia, ou décale toute la table.
 * - **Une date est un nombre.** Comme dans le `.xlsx` : c'est le format
 *   rattaché à la cellule qui le dit, et lui seul.
 */
import { dateDepuisSerie, formatEstDate } from './xlsx'
import { ouvrirConteneur, ressembleAUnConteneur } from './cfb'
import type { FeuilleClasseur } from './xlsx'

export class ErreurClasseurAncien extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErreurClasseurAncien'
  }
}

const BOF = 0x0809
const FIN = 0x000a
const SST = 0x00fc
const CONTINUE = 0x003c
const BOUNDSHEET = 0x0085
const FORMAT = 0x041e
const XF = 0x00e0
const DATEMODE = 0x0022
const LABELSST = 0x00fd
const LABEL = 0x0204
const RSTRING = 0x00d6
const RK = 0x027e
const MULRK = 0x00bd
const NOMBRE = 0x0203
const FORMULE = 0x0006
const CHAINE = 0x0207

type Enregistrement = { type: number; debut: number; longueur: number }

function* enregistrements(flux: Uint8Array, depuis = 0): Generator<Enregistrement> {
  let position = depuis
  while (position + 4 <= flux.length) {
    const type = flux[position]! | (flux[position + 1]! << 8)
    const longueur = flux[position + 2]! | (flux[position + 3]! << 8)
    if (type === 0 && longueur === 0) return
    if (position + 4 + longueur > flux.length) return
    yield { type, debut: position + 4, longueur }
    position += 4 + longueur
  }
}

/**
 * Convertit l'octet d'un texte « compressé ».
 *
 * La tentation est de lire ces octets en Windows-1252, puisque c'est la page de
 * codes d'Excel. Ce serait faux, et de façon invisible : dans le format de
 * 1997, « compressé » veut dire que **l'octet de poids fort de chaque caractère
 * est nul** — l'octet restant est donc le code Unicode lui-même, de U+0000 à
 * U+00FF, c'est-à-dire du Latin-1.
 *
 * La différence ne se voit que sur seize octets, mais elle se voit là où ça
 * compte : lus en Windows-1252, ils deviendraient l'euro, l'œ ou une
 * apostrophe typographique au milieu d'un libellé qui n'en contenait pas. Un
 * fichier qui a vraiment besoin de ces caractères n'est pas compressé — il est
 * écrit en deux octets par caractère, et cette fonction n'est pas appelée.
 */
function caractereCompresse(octet: number): string {
  return String.fromCharCode(octet)
}

/**
 * Lecteur de la table des textes, continuations comprises.
 *
 * Les segments sont gardés séparés plutôt que recollés : c'est la frontière
 * elle-même qui porte l'information — un octet d'encodage y recommence, et le
 * perdre abîme tous les libellés qui suivent.
 */
class LecteurTexte {
  private segment = 0
  private position = 0

  constructor(
    private readonly segments: readonly Uint8Array[],
    depart = 0,
  ) {
    this.position = depart
  }

  private courant(): Uint8Array | undefined {
    return this.segments[this.segment]
  }

  /** Passe au segment suivant quand celui-ci est épuisé. Vrai s'il reste à lire. */
  private avancer(): boolean {
    for (;;) {
      const bloc = this.courant()
      if (bloc === undefined) return false
      if (this.position < bloc.length) return true
      this.segment += 1
      this.position = 0
    }
  }

  /** Vrai si la lecture se trouve exactement au début d'une continuation. */
  private auBordDuSegment(): boolean {
    const bloc = this.courant()
    return bloc !== undefined && this.position >= bloc.length
  }

  octet(): number {
    if (!this.avancer()) return 0
    return this.courant()![this.position++]!
  }

  entier16(): number {
    return this.octet() | (this.octet() << 8)
  }

  entier32(): number {
    return (this.entier16() | (this.entier16() << 16)) >>> 0
  }

  sauter(nombre: number): void {
    for (let rang = 0; rang < nombre; rang++) this.octet()
  }

  fini(): boolean {
    return !this.avancer()
  }

  /**
   * Lit un texte au format d'Excel 97.
   *
   * L'ordre des champs n'est pas négociable : nombre de caractères, drapeaux,
   * puis — seulement si les drapeaux l'annoncent — le nombre de tronçons de
   * mise en forme et la taille des données asiatiques, **avant** le texte.
   * Les lire après ferait commencer le texte quelques octets trop loin.
   */
  texte(): string {
    const caracteres = this.entier16()
    let drapeaux = this.octet()
    let tronçons = 0
    let extension = 0
    if ((drapeaux & 0x08) !== 0) tronçons = this.entier16()
    if ((drapeaux & 0x04) !== 0) extension = this.entier32()

    let resultat = ''
    for (let rang = 0; rang < caracteres; rang++) {
      // Une continuation recommence par son propre octet d'encodage : la suite
      // d'un texte compressé peut arriver en deux octets par caractère.
      if (this.auBordDuSegment()) {
        this.avancer()
        drapeaux = this.octet()
      }
      if ((drapeaux & 0x01) !== 0) resultat += String.fromCharCode(this.entier16())
      else resultat += caractereCompresse(this.octet())
    }
    this.sauter(tronçons * 4 + extension)
    return resultat
  }
}

/** Texte court, précédé d'un nombre de caractères sur un seul octet. */
function texteCourt(flux: Uint8Array, debut: number): { texte: string; suite: number } {
  const caracteres = flux[debut]!
  const drapeaux = flux[debut + 1]!
  let resultat = ''
  let position = debut + 2
  for (let rang = 0; rang < caracteres; rang++) {
    if ((drapeaux & 0x01) !== 0) {
      resultat += String.fromCharCode(flux[position]! | (flux[position + 1]! << 8))
      position += 2
    } else {
      resultat += caractereCompresse(flux[position]!)
      position += 1
    }
  }
  return { texte: resultat, suite: position }
}

/**
 * Décode un nombre « RK ».
 *
 * Deux bits de queue disent comment lire les trente autres : entier ou flottant
 * tronqué, à diviser par cent ou non. Les quatre cas existent dans un même
 * fichier, parfois dans une même colonne.
 */
export function nombreRK(brut: number): number {
  const centieme = (brut & 0x01) !== 0
  const entier = (brut & 0x02) !== 0
  let valeur: number
  if (entier) {
    // Décalage arithmétique : le bit de signe doit être conservé.
    valeur = brut >> 2
  } else {
    const tampon = new ArrayBuffer(8)
    const vue = new DataView(tampon)
    vue.setUint32(4, brut & 0xfffffffc, true)
    vue.setUint32(0, 0, true)
    valeur = vue.getFloat64(0, true)
  }
  return centieme ? valeur / 100 : valeur
}

/**
 * Rend un nombre sans notation exponentielle ni décimales fantômes.
 *
 * Un flottant tronqué se relit parfois « 145.80000000000001 ». Le repasser par
 * une précision de quinze chiffres significatifs — la précision qu'Excel
 * garantit — restitue « 145.8 » sans jamais rien inventer.
 */
function rendreNombre(valeur: number): string {
  if (!Number.isFinite(valeur)) return ''
  if (Number.isInteger(valeur)) return String(valeur)
  const arrondi = Number(valeur.toPrecision(15))
  return String(arrondi)
}

const PREDEFINIS_DATE = (id: number) =>
  (id >= 14 && id <= 22) ||
  (id >= 27 && id <= 36) ||
  (id >= 45 && id <= 47) ||
  (id >= 50 && id <= 58)

export function lireClasseurAncien(octets: Uint8Array): FeuilleClasseur[] {
  if (!ressembleAUnConteneur(octets)) {
    throw new ErreurClasseurAncien('ce fichier n’est pas un classeur Excel 97')
  }
  const conteneur = ouvrirConteneur(octets)
  const flux = conteneur.flux('Workbook') ?? conteneur.flux('Book')
  if (flux === null) {
    throw new ErreurClasseurAncien('ce document Microsoft ne contient pas de classeur')
  }

  const premier = [...enregistrements(flux)][0]
  if (premier === undefined || premier.type !== BOF) {
    throw new ErreurClasseurAncien('classeur illisible : aucun en-tête reconnu')
  }
  const version = flux[premier.debut]! | (flux[premier.debut + 1]! << 8)
  if (version < 0x0600) {
    throw new ErreurClasseurAncien(
      'classeur antérieur à Excel 97 : ouvrez-le dans un tableur et réenregistrez-le en .xlsx ou .csv',
    )
  }

  // --- Partie commune : textes, formats, styles, feuilles ---------------------
  const descriptions = new Map<number, string>()
  const formatParStyle: number[] = []
  const feuilles: { nom: string; position: number }[] = []
  let mille904 = false
  let textes: string[] = []

  const globaux = [...enregistrements(flux)]
  for (let rang = 0; rang < globaux.length; rang++) {
    const enr = globaux[rang]!
    if (enr.type === FIN) break

    if (enr.type === DATEMODE) {
      mille904 = (flux[enr.debut]! | (flux[enr.debut + 1]! << 8)) === 1
    } else if (enr.type === BOUNDSHEET) {
      const position =
        (flux[enr.debut]! |
          (flux[enr.debut + 1]! << 8) |
          (flux[enr.debut + 2]! << 16) |
          (flux[enr.debut + 3]! << 24)) >>>
        0
      feuilles.push({ nom: texteCourt(flux, enr.debut + 6).texte, position })
    } else if (enr.type === FORMAT) {
      const identifiant = flux[enr.debut]! | (flux[enr.debut + 1]! << 8)
      const lecteur = new LecteurTexte([flux.subarray(enr.debut + 2, enr.debut + enr.longueur)])
      descriptions.set(identifiant, lecteur.texte())
    } else if (enr.type === XF) {
      formatParStyle.push(flux[enr.debut + 2]! | (flux[enr.debut + 3]! << 8))
    } else if (enr.type === SST) {
      // Le texte déborde sur les continuations qui suivent immédiatement.
      const segments = [flux.subarray(enr.debut, enr.debut + enr.longueur)]
      for (let suite = rang + 1; suite < globaux.length; suite++) {
        const candidat = globaux[suite]!
        if (candidat.type !== CONTINUE) break
        segments.push(flux.subarray(candidat.debut, candidat.debut + candidat.longueur))
      }
      const lecteur = new LecteurTexte(segments, 8)
      const uniques =
        segments[0]!.length >= 8
          ? new DataView(segments[0]!.buffer, segments[0]!.byteOffset, 8).getUint32(4, true)
          : 0
      textes = []
      for (let compte = 0; compte < uniques && !lecteur.fini(); compte++) {
        textes.push(lecteur.texte())
      }
    }
  }

  const estDate = (style: number): boolean => {
    const identifiant = formatParStyle[style]
    if (identifiant === undefined) return false
    const description = descriptions.get(identifiant)
    return description !== undefined ? formatEstDate(description) : PREDEFINIS_DATE(identifiant)
  }

  // --- Feuilles ---------------------------------------------------------------
  const resultat: FeuilleClasseur[] = []
  for (const feuille of feuilles) {
    resultat.push({
      nom: feuille.nom,
      lignes: lireFeuille(flux, feuille.position, textes, estDate, mille904),
    })
  }
  return resultat
}

function lireFeuille(
  flux: Uint8Array,
  position: number,
  textes: readonly string[],
  estDate: (style: number) => boolean,
  mille904: boolean,
): string[][] {
  const cellules = new Map<number, Map<number, string>>()
  let ligneMax = -1
  let colonneMax = -1
  let attenteChaine: { ligne: number; colonne: number } | null = null

  const poser = (ligne: number, colonne: number, valeur: string) => {
    let rangee = cellules.get(ligne)
    if (rangee === undefined) {
      rangee = new Map()
      cellules.set(ligne, rangee)
    }
    rangee.set(colonne, valeur)
    if (ligne > ligneMax) ligneMax = ligne
    if (colonne > colonneMax) colonneMax = colonne
  }

  const nombreOuDate = (valeur: number, style: number) =>
    estDate(style)
      ? (dateDepuisSerie(valeur, mille904) ?? rendreNombre(valeur))
      : rendreNombre(valeur)

  let premier = true
  for (const enr of enregistrements(flux, position)) {
    if (premier) {
      premier = false
      // Le premier enregistrement est le BOF de la feuille ; on l'enjambe.
      if (enr.type === BOF) continue
    }
    if (enr.type === FIN) break

    const u16 = (decalage: number) =>
      flux[enr.debut + decalage]! | (flux[enr.debut + decalage + 1]! << 8)

    if (enr.type === LABELSST) {
      poser(
        u16(0),
        u16(2),
        textes[
          (flux[enr.debut + 6]! |
            (flux[enr.debut + 7]! << 8) |
            (flux[enr.debut + 8]! << 16) |
            (flux[enr.debut + 9]! << 24)) >>>
            0
        ] ?? '',
      )
    } else if (enr.type === LABEL || enr.type === RSTRING) {
      const lecteur = new LecteurTexte([flux.subarray(enr.debut + 6, enr.debut + enr.longueur)])
      poser(u16(0), u16(2), lecteur.texte())
    } else if (enr.type === RK) {
      const brut = new DataView(flux.buffer, flux.byteOffset + enr.debut + 6, 4).getUint32(0, true)
      poser(u16(0), u16(2), nombreOuDate(nombreRK(brut), u16(4)))
    } else if (enr.type === MULRK) {
      const ligne = u16(0)
      const premiere = u16(2)
      const nombre = Math.floor((enr.longueur - 6) / 6)
      for (let rang = 0; rang < nombre; rang++) {
        const base = enr.debut + 4 + rang * 6
        const style = flux[base]! | (flux[base + 1]! << 8)
        const brut = new DataView(flux.buffer, flux.byteOffset + base + 2, 4).getUint32(0, true)
        poser(ligne, premiere + rang, nombreOuDate(nombreRK(brut), style))
      }
    } else if (enr.type === NOMBRE) {
      const valeur = new DataView(flux.buffer, flux.byteOffset + enr.debut + 6, 8).getFloat64(
        0,
        true,
      )
      poser(u16(0), u16(2), nombreOuDate(valeur, u16(4)))
    } else if (enr.type === FORMULE) {
      const octetsResultat = new DataView(flux.buffer, flux.byteOffset + enr.debut + 6, 8)
      // Un résultat dont les deux derniers octets valent 0xFFFF n'est pas un
      // nombre : c'est un texte, annoncé par l'enregistrement suivant.
      if (octetsResultat.getUint16(6, true) === 0xffff) {
        attenteChaine = { ligne: u16(0), colonne: u16(2) }
      } else {
        poser(u16(0), u16(2), nombreOuDate(octetsResultat.getFloat64(0, true), u16(4)))
      }
    } else if (enr.type === CHAINE && attenteChaine !== null) {
      const lecteur = new LecteurTexte([flux.subarray(enr.debut, enr.debut + enr.longueur)])
      poser(attenteChaine.ligne, attenteChaine.colonne, lecteur.texte())
      attenteChaine = null
    }
  }

  const lignes: string[][] = []
  for (let ligne = 0; ligne <= ligneMax; ligne++) {
    const rangee = cellules.get(ligne)
    const sortie: string[] = []
    for (let colonne = 0; colonne <= colonneMax; colonne++) {
      sortie.push(rangee?.get(colonne) ?? '')
    }
    lignes.push(sortie)
  }
  return lignes
}
