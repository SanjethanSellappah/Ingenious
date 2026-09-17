/**
 * Une seule porte d'entrée pour les quatre formats de relevé.
 *
 * CSV, `.xlsx`, `.xls`, PDF : quatre lectures très différentes, un seul
 * résultat — une grille de chaînes. Tout ce qui suit dans l'import, de la
 * correspondance des colonnes jusqu'à l'empreinte qui reconnaît les doublons,
 * ignore d'où viennent les lignes. C'est ce qui a permis d'ajouter trois
 * formats sans toucher à la détection des doublons ni à l'aperçu.
 *
 * **Le format se lit dans les octets, pas dans le nom du fichier.** Une banque
 * qui nomme `releve.xls` un fichier qui est en réalité du CSV — cela arrive, et
 * plus souvent qu'on ne croit — serait sinon illisible pour une raison
 * incompréhensible. L'extension ne sert qu'à départager ce que les octets ne
 * disent pas.
 */
import { analyserCsv, decoderTexte, NOMS_SEPARATEUR } from './csv'
import { lirePdf, ressembleAUnPdf } from './pdf'
import { lireClasseur } from './xlsx'
import { lireClasseurAncien } from './xls'
import { ressembleAUnConteneur } from './cfb'
import { ressembleAUneArchive } from './zip'

export type FormatReleve = 'csv' | 'xlsx' | 'xls' | 'pdf'

export type Grille = {
  /** Nom de la feuille, ou du fichier quand il n'y en a qu'une. */
  nom: string
  lignes: string[][]
}

export type DocumentReleve = {
  format: FormatReleve
  /** Ce qu'on peut dire du fichier à l'écran, en une ligne. */
  description: string
  /** Une grille par feuille. Un CSV ou un PDF n'en a qu'une. */
  grilles: Grille[]
}

export const NOMS_FORMAT: Record<FormatReleve, string> = {
  csv: 'CSV',
  xlsx: 'Excel (.xlsx)',
  xls: 'Excel 97 (.xls)',
  pdf: 'PDF',
}

function pluriel(nombre: number, singulier: string, pluriel_: string): string {
  return `${nombre} ${nombre > 1 ? pluriel_ : singulier}`
}

/**
 * Décrit un classeur.
 *
 * Le nombre de lignes n'a de sens que pour une feuille unique : dès qu'il y en
 * a plusieurs, c'est le menu des feuilles qui le donne, feuille par feuille.
 */
function decrireFeuilles(feuilles: readonly Grille[]): string {
  if (feuilles.length === 1) {
    return `${feuilles[0]!.nom} · ${pluriel(feuilles[0]!.lignes.length, 'ligne', 'lignes')}`
  }
  return pluriel(feuilles.length, 'feuille', 'feuilles')
}

/**
 * Distingue un fichier de texte d'un fichier binaire.
 *
 * Sans ce garde-fou, n'importe quel fichier — une image, une archive d'un autre
 * genre, un exécutable — « réussirait » à s'ouvrir comme un CSV et rendrait une
 * ligne de charabia. L'utilisateur verrait un aperçu absurde sans comprendre
 * que son fichier n'a simplement pas le bon format.
 *
 * Le signe qui ne trompe pas est la présence de caractères de contrôle : un
 * fichier de texte n'en contient que des tabulations et des fins de ligne.
 */
function analyseTexte(texte: string): 'texte' | 'binaire' {
  const echantillon = texte.slice(0, 4096)
  if (echantillon.length === 0) return 'binaire'
  let controles = 0
  for (const caractere of echantillon) {
    const code = caractere.charCodeAt(0)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) controles += 1
  }
  return controles / echantillon.length > 0.02 ? 'binaire' : 'texte'
}

export async function lireDocumentReleve(octets: Uint8Array, nom: string): Promise<DocumentReleve> {
  // --- PDF ---------------------------------------------------------------
  if (ressembleAUnPdf(octets)) {
    const tableau = await lirePdf(octets)
    const utiles = tableau.lignes.filter((ligne) => ligne.some((cellule) => cellule !== ''))
    if (utiles.length === 0) {
      throw new Error(
        'Ce PDF ne contient aucun texte : c’est probablement un relevé scanné, ' +
          'c’est-à-dire une image. Demandez à votre banque le même relevé en CSV ' +
          'ou en Excel — l’application ne sait pas lire une photo.',
      )
    }
    return {
      format: 'pdf',
      description: `${pluriel(tableau.pages, 'page', 'pages')} · ${pluriel(utiles.length, 'ligne lue', 'lignes lues')}`,
      grilles: [{ nom, lignes: tableau.lignes }],
    }
  }

  // --- Classeur moderne ----------------------------------------------------
  if (ressembleAUneArchive(octets)) {
    const feuilles = await lireClasseur(octets)
    return { format: 'xlsx', description: decrireFeuilles(feuilles), grilles: feuilles }
  }

  // --- Classeur d'Excel 97 -------------------------------------------------
  if (ressembleAUnConteneur(octets)) {
    const feuilles = lireClasseurAncien(octets)
    return { format: 'xls', description: decrireFeuilles(feuilles), grilles: feuilles }
  }

  // --- Texte ---------------------------------------------------------------
  const { texte, encodage } = decoderTexte(
    octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer,
  )
  if (analyseTexte(texte) === 'binaire') {
    throw new Error(
      'Ce fichier n’est pas un relevé lisible. Formats acceptés : CSV, Excel ' +
        '(.xlsx et .xls) et PDF. Un relevé au format OFX ou QIF n’est pas encore reconnu.',
    )
  }
  const analyse = analyserCsv(texte)
  if (analyse.lignes.length === 0) {
    throw new Error(
      'Ce fichier ne contient aucune ligne lisible. Formats acceptés : CSV, Excel ' +
        '(.xlsx et .xls) et PDF.',
    )
  }
  return {
    format: 'csv',
    description:
      `séparateur ${NOMS_SEPARATEUR[analyse.separateur]} · ${encodage} · ` +
      pluriel(analyse.lignes.length, 'ligne', 'lignes'),
    grilles: [{ nom, lignes: analyse.lignes }],
  }
}
