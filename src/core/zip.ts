/**
 * Lecture d'une archive ZIP.
 *
 * Un fichier `.xlsx` est une archive de documents XML : pour le lire, il faut
 * d'abord savoir ouvrir l'archive. Le navigateur sait déjà décompresser —
 * `DecompressionStream` est une interface native — donc cela ne coûte aucune
 * bibliothèque, aucun octet de plus dans l'application, et rien de nouveau à
 * autoriser dans la politique de sécurité du contenu.
 *
 * Écrire cette centaine de lignes plutôt que d'ajouter une dépendance n'est pas
 * de la coquetterie : une application qui doit rester lisible et réparable dans
 * dix ans se passe volontiers d'un paquet de six cent mille octets dont
 * personne ne relira jamais le code, et qu'il faudra pourtant tenir à jour.
 *
 * Seul le nécessaire est traité : les deux méthodes de compression qu'emploient
 * les tableurs (aucune, et « deflate »). Tout le reste est **refusé en le
 * disant** plutôt que lu de travers.
 */

/**
 * Taille maximale d'une entrée décompressée.
 *
 * Un fichier de quelques kilo-octets peut en contenir plusieurs gigas une fois
 * décompressé : c'est une vieille façon de faire tomber un lecteur, et ce
 * lecteur reçoit des fichiers que l'utilisateur n'a pas écrits. Un relevé
 * bancaire de cent mille lignes pèse une dizaine de méga-octets une fois
 * déplié ; soixante-quatre laisse une marge confortable et ferme la porte.
 */
const TAILLE_MAXIMALE = 64 * 1024 * 1024

const SIGNATURE_FIN = 0x06054b50
const SIGNATURE_CENTRAL = 0x02014b50
const SIGNATURE_LOCAL = 0x04034b50

/** Une archive ouverte : des noms, et de quoi lire chacun à la demande. */
export type Archive = {
  noms: string[]
  /** Contenu décompressé d'une entrée, ou `null` si elle n'existe pas. */
  lire: (nom: string) => Promise<Uint8Array | null>
  lireTexte: (nom: string) => Promise<string | null>
}

export class ErreurArchive extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErreurArchive'
  }
}

type Entree = {
  nom: string
  methode: number
  tailleCompressee: number
  tailleReelle: number
  decalageLocal: number
}

/**
 * Décompresse un bloc « deflate » brut.
 *
 * `deflate-raw` et non `deflate` : le ZIP stocke le flux sans l'en-tête zlib,
 * et confondre les deux fait échouer la décompression sur le premier octet.
 */
async function inflater(donnees: Uint8Array): Promise<Uint8Array> {
  const flux = new Blob([donnees as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(flux).arrayBuffer())
}

/**
 * Retrouve la fin du catalogue.
 *
 * On remonte depuis la fin du fichier : le ZIP se lit à l'envers, son catalogue
 * étant à la fin. Le commentaire final pouvant faire jusqu'à 65 535 octets, on
 * ne cherche pas plus loin que cela — au-delà, ce n'est pas un ZIP.
 */
function trouverFinCatalogue(vue: DataView): number {
  const debut = Math.max(0, vue.byteLength - 22 - 0xffff)
  for (let i = vue.byteLength - 22; i >= debut; i--) {
    if (vue.getUint32(i, true) === SIGNATURE_FIN) return i
  }
  throw new ErreurArchive('ce fichier n’est pas une archive ZIP (fin de catalogue introuvable)')
}

// Asynchrone bien que rien n'y soit attendu : la décompression l'est, et une
// signature qui changerait le jour où l'on décompresserait à l'ouverture ferait
// remonter ce changement dans tous les appelants.
// eslint-disable-next-line @typescript-eslint/require-await
export async function ouvrirArchive(octets: Uint8Array): Promise<Archive> {
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength)
  const fin = trouverFinCatalogue(vue)

  const nombre = vue.getUint16(fin + 10, true)
  const debutCatalogue = vue.getUint32(fin + 16, true)
  if (debutCatalogue === 0xffffffff) {
    // Zip64 : aucun tableur n'en produit pour un relevé bancaire, et deviner
    // serait pire que refuser.
    throw new ErreurArchive('archive ZIP64 : format non pris en charge')
  }

  const entrees = new Map<string, Entree>()
  let position = debutCatalogue
  const nomDe = new TextDecoder('utf-8')

  for (let rang = 0; rang < nombre; rang++) {
    if (position + 46 > vue.byteLength || vue.getUint32(position, true) !== SIGNATURE_CENTRAL) {
      throw new ErreurArchive('catalogue de l’archive abîmé')
    }
    const methode = vue.getUint16(position + 10, true)
    const tailleCompressee = vue.getUint32(position + 20, true)
    const tailleReelle = vue.getUint32(position + 24, true)
    const longueurNom = vue.getUint16(position + 28, true)
    const longueurExtra = vue.getUint16(position + 30, true)
    const longueurCommentaire = vue.getUint16(position + 32, true)
    const decalageLocal = vue.getUint32(position + 42, true)
    const nom = nomDe.decode(octets.subarray(position + 46, position + 46 + longueurNom))
    entrees.set(nom, { nom, methode, tailleCompressee, tailleReelle, decalageLocal })
    position += 46 + longueurNom + longueurExtra + longueurCommentaire
  }

  async function lire(nom: string): Promise<Uint8Array | null> {
    const entree = entrees.get(nom)
    if (!entree) return null

    // La taille du nom et des extras se relit dans l'en-tête **local** : elle
    // n'est pas toujours la même que dans le catalogue, et s'en remettre au
    // catalogue décale la lecture de quelques octets — donc tout le contenu.
    const tete = entree.decalageLocal
    if (tete + 30 > vue.byteLength || vue.getUint32(tete, true) !== SIGNATURE_LOCAL) {
      throw new ErreurArchive(`entrée « ${nom} » introuvable dans l’archive`)
    }
    const longueurNom = vue.getUint16(tete + 26, true)
    const longueurExtra = vue.getUint16(tete + 28, true)
    const debut = tete + 30 + longueurNom + longueurExtra
    const brut = octets.subarray(debut, debut + entree.tailleCompressee)

    if (entree.tailleReelle > TAILLE_MAXIMALE) {
      throw new ErreurArchive(
        `entrée « ${nom} » démesurée une fois décompressée (${entree.tailleReelle} octets)`,
      )
    }
    if (entree.methode === 0) return brut
    if (entree.methode === 8) {
      const clair = await inflater(brut)
      // La taille annoncée peut mentir : on vérifie ce qui sort vraiment.
      if (clair.length > TAILLE_MAXIMALE) {
        throw new ErreurArchive(`entrée « ${nom} » démesurée une fois décompressée`)
      }
      return clair
    }
    throw new ErreurArchive(
      `entrée « ${nom} » compressée par une méthode inconnue (${entree.methode})`,
    )
  }

  return {
    noms: [...entrees.keys()],
    lire,
    lireTexte: async (nom) => {
      const donnees = await lire(nom)
      return donnees === null ? null : new TextDecoder('utf-8').decode(donnees)
    },
  }
}

/** Vrai si les premiers octets sont ceux d'une archive ZIP. */
export function ressembleAUneArchive(octets: Uint8Array): boolean {
  return octets[0] === 0x50 && octets[1] === 0x4b
}
