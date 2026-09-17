/**
 * Lecture d'un classeur `.xlsx`.
 *
 * Le résultat est une grille de chaînes — exactement ce que produit déjà la
 * lecture d'un CSV. Tout ce qui suit dans l'import (la correspondance des
 * colonnes, la lecture des dates et des montants, l'empreinte, l'aperçu) ne
 * change donc pas d'une ligne : un tableur n'est qu'une autre façon d'apporter
 * les mêmes lignes.
 *
 * Deux pièges méritent d'être nommés, parce qu'ils produisent des chiffres faux
 * sans jamais lever d'erreur :
 *
 * - **Une date est un nombre.** Dans un classeur, le 1er septembre 2026 est
 *   stocké « 46266 ». Rien dans la cellule ne dit que c'est une date : il faut
 *   aller lire son **format** dans une autre partie du fichier. Sans cela,
 *   l'import verrait une colonne de nombres à cinq chiffres et refuserait tout.
 * - **Le calendrier d'Excel compte un jour de trop.** Il tient 1900 pour
 *   bissextile, ce qu'elle n'est pas. L'erreur ne concerne que les deux premiers
 *   mois de 1900, mais elle décale la conversion de toutes les dates si on
 *   l'ignore — et Excel pour Mac part, lui, de 1904.
 *
 * Les nombres sont rendus **tels qu'ils sont écrits dans le fichier**, sans
 * repasser par un calcul : la valeur stockée est déjà exacte, et la reformater
 * ne pourrait qu'y perdre.
 */
import { depuisNumeroDeJour } from './civilDate'
import { jetonsXml, texteJusqua } from './xml'
import { ouvrirArchive, type Archive } from './zip'

export type FeuilleClasseur = {
  nom: string
  lignes: string[][]
}

export class ErreurClasseur extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErreurClasseur'
  }
}

// --- Dates ---------------------------------------------------------------------

/**
 * Jour zéro du calendrier d'Excel, exprimé en jours depuis le 1er janvier 1970.
 *
 * Le 30 décembre 1899, et non le 31 : le décalage d'un jour absorbe le
 * 29 février 1900 qu'Excel croit exister.
 */
const ORIGINE_1900 = -25569
/** Excel pour Mac compte depuis le 1er janvier 1904. */
const ECART_1904 = 1462

/**
 * Convertit un numéro de série en date civile.
 *
 * Les numéros inférieurs à 61 précèdent le faux 29 février : avant lui, le
 * décalage d'un jour ne s'applique pas encore. Aucun relevé bancaire ne parle de
 * janvier 1900, mais un import qui se trompe d'un jour sur une borne est un
 * import auquel on ne peut plus faire confiance ailleurs.
 */
export function dateDepuisSerie(serie: number, mille904 = false): string | null {
  if (!Number.isFinite(serie) || serie < 0) return null
  const entier = Math.floor(serie)
  if (mille904) return rendre(entier + ECART_1904 + ORIGINE_1900)
  if (entier === 0) return null
  if (entier < 61) return rendre(entier + ORIGINE_1900 + 1)
  return rendre(entier + ORIGINE_1900)
}

function rendre(numeroDeJour: number): string | null {
  try {
    // Rendu au format français : c'est celui que l'analyseur de dates de
    // l'import lit en premier, et celui qu'affichait le tableur.
    const civile = depuisNumeroDeJour(numeroDeJour)
    return `${civile.slice(8, 10)}/${civile.slice(5, 7)}/${civile.slice(0, 4)}`
  } catch {
    return null
  }
}

/**
 * Formats de date prédéfinis d'Excel.
 *
 * Ces numéros n'ont pas de description dans le fichier : ils sont connus du
 * tableur et de lui seul. 14 à 22 sont les dates et heures courantes, 45 à 47
 * les durées. Les formats propres au document, eux, portent leur description.
 */
function estFormatDatePredefini(id: number): boolean {
  return (
    (id >= 14 && id <= 22) ||
    (id >= 45 && id <= 47) ||
    (id >= 27 && id <= 36) ||
    (id >= 50 && id <= 58)
  )
}

/**
 * Vrai si une description de format décrit une date.
 *
 * Le texte entre guillemets est écarté d'abord : un format monétaire comme
 * `#,##0.00 "mois"` contient un « m » qui ne désigne pas un mois.
 */
export function formatEstDate(description: string): boolean {
  const utile = description
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '')
  return /[ymdhs]/i.test(utile)
}

// --- Parties du classeur ----------------------------------------------------------

type Styles = {
  /** Pour chaque style de cellule, vrai s'il affiche une date. */
  datePourStyle: boolean[]
}

function lireStyles(xml: string): Styles {
  const descriptions = new Map<number, string>()
  const datePourStyle: boolean[] = []
  let dansCellXfs = false

  for (const jeton of jetonsXml(xml)) {
    if (jeton.type === 'ouvrante') {
      if (jeton.nom === 'numFmt') {
        const id = Number(jeton.attributs.numFmtId)
        if (Number.isFinite(id)) descriptions.set(id, jeton.attributs.formatCode ?? '')
      } else if (jeton.nom === 'cellXfs') dansCellXfs = true
      else if (jeton.nom === 'xf' && dansCellXfs) {
        const id = Number(jeton.attributs.numFmtId ?? '0')
        const description = descriptions.get(id)
        datePourStyle.push(
          description !== undefined ? formatEstDate(description) : estFormatDatePredefini(id),
        )
      }
    } else if (jeton.type === 'fermante' && jeton.nom === 'cellXfs') dansCellXfs = false
  }
  return { datePourStyle }
}

/**
 * Chaînes partagées.
 *
 * Excel ne répète pas deux fois le même libellé : il les range tous ici et les
 * cellules y renvoient par leur rang. Un libellé peut être découpé en morceaux
 * (`r`) quand une partie est en gras — il faut les recoller, sinon « VIR
 * SALAIRE » devient « VIR ».
 */
function lireChainesPartagees(xml: string): string[] {
  const chaines: string[] = []
  const jetons = jetonsXml(xml)
  for (;;) {
    const pas = jetons.next()
    if (pas.done === true) break
    const jeton = pas.value
    if (jeton.type === 'ouvrante' && jeton.nom === 'si') {
      if (jeton.autonome) chaines.push('')
      else chaines.push(texteJusqua(jetons, 'si', ['rPh']))
    }
  }
  return chaines
}

type Feuille = { nom: string; cible: string }

function lireCibles(rels: string | null): Map<string, string> {
  const cibles = new Map<string, string>()
  if (rels === null) return cibles
  for (const jeton of jetonsXml(rels)) {
    if (jeton.type === 'ouvrante' && jeton.nom === 'Relationship') {
      const id = jeton.attributs.Id
      const cible = jeton.attributs.Target
      if (id !== undefined && cible !== undefined) cibles.set(id, cible)
    }
  }
  return cibles
}

function cheminFeuille(cible: string): string {
  // La cible peut être absolue (`/xl/worksheets/sheet1.xml`) ou relative au
  // classeur (`worksheets/sheet1.xml`). Les deux existent dans la nature.
  if (cible.startsWith('/')) return cible.slice(1)
  if (cible.startsWith('xl/')) return cible
  return `xl/${cible}`
}

// --- Cellules -----------------------------------------------------------------------

/** `BC` vaut 54 : les colonnes se comptent en base 26 sans zéro. */
export function colonneDepuisReference(reference: string): number {
  let rang = 0
  for (const caractere of reference) {
    const code = caractere.charCodeAt(0)
    if (code < 65 || code > 90) break
    rang = rang * 26 + (code - 64)
  }
  return rang - 1
}

function lireFeuille(
  xml: string,
  chaines: string[],
  styles: Styles,
  mille904: boolean,
): string[][] {
  const lignes: string[][] = []
  let courante: string[] = []
  let dansDonnees = false
  let rangLigneAttendu = 1

  const jetons = jetonsXml(xml)
  // Lecture à la main : `texteJusqua` puise dans le même générateur, et un
  // `for...of` le refermerait à la première cellule lue.
  for (;;) {
    const pas = jetons.next()
    if (pas.done === true) break
    const jeton = pas.value
    if (jeton.type === 'ouvrante') {
      if (jeton.nom === 'sheetData') {
        dansDonnees = !jeton.autonome
        continue
      }
      if (!dansDonnees) continue

      if (jeton.nom === 'row') {
        // Les lignes vides ne sont pas écrites : on les rétablit, sinon tout ce
        // qui suit remonte d'un cran et les dates se retrouvent sur les
        // mauvais montants.
        const rang = Number(jeton.attributs.r)
        if (Number.isFinite(rang)) {
          while (rangLigneAttendu < rang) {
            lignes.push([])
            rangLigneAttendu += 1
          }
          rangLigneAttendu = rang + 1
        }
        courante = []
        if (jeton.autonome) lignes.push(courante)
        continue
      }

      if (jeton.nom === 'c') {
        const colonne = colonneDepuisReference(jeton.attributs.r ?? '')
        const cible = colonne >= 0 ? colonne : courante.length
        while (courante.length < cible) courante.push('')

        if (jeton.autonome) {
          courante.push('')
          continue
        }

        const type = jeton.attributs.t ?? 'n'
        const style = Number(jeton.attributs.s ?? '')
        // La formule est écartée : sans cela, `<c><f>SUM(A1:A9)</f><v>42</v></c>`
        // rendrait « SUM(A1:A9)42 » et le montant deviendrait illisible.
        const brut = texteJusqua(jetons, 'c', type === 'inlineStr' ? ['f'] : ['f', 'is'])

        if (type === 's') {
          const rang = Number(brut)
          courante.push(Number.isFinite(rang) ? (chaines[rang] ?? '') : '')
        } else if (type === 'inlineStr' || type === 'str') {
          courante.push(brut)
        } else if (type === 'b') {
          courante.push(brut === '1' ? 'VRAI' : 'FAUX')
        } else if (type === 'e') {
          courante.push('')
        } else {
          const nombre = Number(brut)
          const estDate =
            Number.isFinite(style) &&
            styles.datePourStyle[style] === true &&
            Number.isFinite(nombre)
          if (estDate) courante.push(dateDepuisSerie(nombre, mille904) ?? brut)
          // La valeur brute, sans repasser par un calcul : elle est déjà exacte.
          else courante.push(brut)
        }
        continue
      }
      continue
    }

    if (jeton.type === 'fermante') {
      if (jeton.nom === 'row' && dansDonnees) lignes.push(courante)
      else if (jeton.nom === 'sheetData') break
    }
  }

  return lignes
}

// --- Entrée publique -------------------------------------------------------------------

/**
 * Lit toutes les feuilles d'un classeur.
 *
 * Toutes, et pas seulement la première : un relevé bancaire arrive parfois
 * derrière une page de garde, et deviner laquelle contient les opérations
 * reviendrait à parier. L'écran d'import montre les feuilles et laisse choisir.
 */
export async function lireClasseur(octets: Uint8Array): Promise<FeuilleClasseur[]> {
  let archive: Archive
  try {
    archive = await ouvrirArchive(octets)
  } catch (erreur) {
    throw new ErreurClasseur(
      `ce fichier n’est pas un classeur lisible : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    )
  }

  const classeur = await archive.lireTexte('xl/workbook.xml')
  if (classeur === null) {
    throw new ErreurClasseur(
      'archive sans classeur : s’agit-il d’un `.xlsx` ? Un `.xls` ancien s’ouvre autrement.',
    )
  }

  const cibles = lireCibles(await archive.lireTexte('xl/_rels/workbook.xml.rels'))
  const feuilles: Feuille[] = []
  let mille904 = false

  for (const jeton of jetonsXml(classeur)) {
    if (jeton.type !== 'ouvrante') continue
    if (jeton.nom === 'workbookPr') {
      const valeur = jeton.attributs.date1904
      mille904 = valeur === '1' || valeur === 'true'
    } else if (jeton.nom === 'sheet') {
      const cible = cibles.get(jeton.attributs.id ?? '')
      if (cible !== undefined) {
        feuilles.push({ nom: jeton.attributs.name ?? `Feuille ${feuilles.length + 1}`, cible })
      }
    }
  }
  if (feuilles.length === 0) throw new ErreurClasseur('ce classeur ne contient aucune feuille')

  const styles = lireStyles((await archive.lireTexte('xl/styles.xml')) ?? '')
  const chaines = lireChainesPartagees((await archive.lireTexte('xl/sharedStrings.xml')) ?? '')

  const resultat: FeuilleClasseur[] = []
  for (const feuille of feuilles) {
    const xml = await archive.lireTexte(cheminFeuille(feuille.cible))
    resultat.push({
      nom: feuille.nom,
      lignes: xml === null ? [] : lireFeuille(xml, chaines, styles, mille904),
    })
  }
  return resultat
}
