/**
 * Lecture d'un conteneur OLE2, celui des vieux fichiers Microsoft.
 *
 * Un `.xls` d'avant 2007 n'est pas une archive mais un **système de fichiers
 * miniature** : des secteurs de taille fixe, chaînés par une table
 * d'allocation, avec un répertoire. C'est une disquette dans un fichier, et il
 * faut la monter avant de pouvoir lire quoi que ce soit.
 *
 * Deux détails coûtent cher quand on les néglige, et ne lèvent aucune erreur :
 *
 * - **Les petits flux vivent ailleurs.** En dessous d'un seuil (4 ko en
 *   pratique), un flux n'occupe pas de secteur entier : il est rangé dans un
 *   « mini-flux » avec sa propre table. Un relevé d'une page passe par là.
 * - **Une chaîne peut boucler.** Un fichier abîmé, ou malveillant, peut
 *   refermer une chaîne sur elle-même : la lecture tournerait sans fin. Le
 *   nombre de sauts est donc borné par le nombre de secteurs du fichier.
 */

const FIN_DE_CHAINE = 0xfffffffe
const LIBRE = 0xffffffff

export class ErreurConteneur extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErreurConteneur'
  }
}

export type Conteneur = {
  noms: string[]
  /** Contenu d'un flux, par son nom. `null` s'il n'existe pas. */
  flux: (nom: string) => Uint8Array | null
}

/** Vrai si les huit premiers octets sont la signature d'un conteneur OLE2. */
export function ressembleAUnConteneur(octets: Uint8Array): boolean {
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  return signature.every((attendu, rang) => octets[rang] === attendu)
}

export function ouvrirConteneur(octets: Uint8Array): Conteneur {
  if (!ressembleAUnConteneur(octets)) {
    throw new ErreurConteneur('ce fichier n’est pas un document Microsoft au format ancien')
  }
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength)

  const tailleSecteur = 1 << vue.getUint16(30, true)
  const tailleMiniSecteur = 1 << vue.getUint16(32, true)
  if (tailleSecteur < 128 || tailleSecteur > 1 << 20) {
    throw new ErreurConteneur(`taille de secteur invalide (${tailleSecteur})`)
  }
  const nombreSecteursFat = vue.getUint32(44, true)
  const premierRepertoire = vue.getUint32(48, true)
  const seuilMini = vue.getUint32(56, true)
  const premierMiniFat = vue.getUint32(60, true)
  const nombreMiniFat = vue.getUint32(64, true)
  const premierDifat = vue.getUint32(68, true)
  const nombreDifat = vue.getUint32(72, true)

  const totalSecteurs = Math.ceil(octets.byteLength / tailleSecteur)
  const debutDe = (secteur: number) => (secteur + 1) * tailleSecteur

  function secteur(numero: number): Uint8Array {
    const debut = debutDe(numero)
    if (debut < 0 || debut + tailleSecteur > octets.byteLength) {
      throw new ErreurConteneur(`secteur ${numero} hors du fichier`)
    }
    return octets.subarray(debut, debut + tailleSecteur)
  }

  // --- Table d'allocation ---------------------------------------------------
  const secteursFat: number[] = []
  for (let rang = 0; rang < 109 && secteursFat.length < nombreSecteursFat; rang++) {
    const numero = vue.getUint32(76 + rang * 4, true)
    if (numero === LIBRE || numero === FIN_DE_CHAINE) break
    secteursFat.push(numero)
  }
  // Au-delà de 109 secteurs de table, la suite est chaînée à part.
  let suivantDifat = premierDifat
  for (let pas = 0; pas < nombreDifat && suivantDifat < FIN_DE_CHAINE; pas++) {
    const bloc = secteur(suivantDifat)
    const vueBloc = new DataView(bloc.buffer, bloc.byteOffset, bloc.byteLength)
    const parBloc = tailleSecteur / 4 - 1
    for (let rang = 0; rang < parBloc && secteursFat.length < nombreSecteursFat; rang++) {
      const numero = vueBloc.getUint32(rang * 4, true)
      if (numero === LIBRE || numero === FIN_DE_CHAINE) break
      secteursFat.push(numero)
    }
    suivantDifat = vueBloc.getUint32(tailleSecteur - 4, true)
  }

  const fat: number[] = []
  for (const numero of secteursFat) {
    const bloc = secteur(numero)
    const vueBloc = new DataView(bloc.buffer, bloc.byteOffset, bloc.byteLength)
    for (let rang = 0; rang < tailleSecteur / 4; rang++) {
      fat.push(vueBloc.getUint32(rang * 4, true))
    }
  }

  /** Concatène une chaîne de secteurs. Le nombre de sauts est borné. */
  function suivreChaine(debut: number, table: readonly number[], lire: (n: number) => Uint8Array) {
    const morceaux: Uint8Array[] = []
    let courant = debut
    let sauts = 0
    while (courant < FIN_DE_CHAINE) {
      if (sauts++ > table.length + totalSecteurs) {
        throw new ErreurConteneur('chaîne de secteurs qui boucle sur elle-même')
      }
      morceaux.push(lire(courant))
      const suivant = table[courant]
      if (suivant === undefined) break
      courant = suivant
    }
    let taille = 0
    for (const morceau of morceaux) taille += morceau.length
    const tout = new Uint8Array(taille)
    let position = 0
    for (const morceau of morceaux) {
      tout.set(morceau, position)
      position += morceau.length
    }
    return tout
  }

  // --- Répertoire -----------------------------------------------------------
  const repertoire = suivreChaine(premierRepertoire, fat, secteur)
  type Entree = { nom: string; type: number; debut: number; taille: number }
  const entrees: Entree[] = []
  for (let position = 0; position + 128 <= repertoire.length; position += 128) {
    const vueEntree = new DataView(repertoire.buffer, repertoire.byteOffset + position, 128)
    const type = vueEntree.getUint8(66)
    if (type === 0) continue
    const longueurNom = vueEntree.getUint16(64, true)
    const octetsNom = repertoire.subarray(position, position + Math.max(0, longueurNom - 2))
    const nom = new TextDecoder('utf-16le').decode(octetsNom)
    entrees.push({
      nom,
      type,
      debut: vueEntree.getUint32(116, true),
      // La taille est sur 64 bits ; aucun classeur de cette époque n'approche
      // les quatre gigaoctets, et les 32 bits hauts sont souvent du remplissage.
      taille: vueEntree.getUint32(120, true),
    })
  }

  const racine = entrees.find((entree) => entree.type === 5)

  // --- Mini-flux ------------------------------------------------------------
  let miniFat: number[] = []
  let miniFlux: Uint8Array = new Uint8Array(0)
  if (racine !== undefined && premierMiniFat < FIN_DE_CHAINE && nombreMiniFat > 0) {
    const blocs = suivreChaine(premierMiniFat, fat, secteur)
    const vueMini = new DataView(blocs.buffer, blocs.byteOffset, blocs.byteLength)
    miniFat = []
    for (let rang = 0; rang < blocs.length / 4; rang++) {
      miniFat.push(vueMini.getUint32(rang * 4, true))
    }
    miniFlux = suivreChaine(racine.debut, fat, secteur)
  }

  function miniSecteur(numero: number): Uint8Array {
    const debut = numero * tailleMiniSecteur
    return miniFlux.subarray(debut, debut + tailleMiniSecteur)
  }

  function flux(nom: string): Uint8Array | null {
    const entree = entrees.find((candidat) => candidat.type === 2 && candidat.nom === nom)
    if (!entree) return null
    const tout =
      entree.taille < seuilMini
        ? suivreChaine(entree.debut, miniFat, miniSecteur)
        : suivreChaine(entree.debut, fat, secteur)
    return tout.subarray(0, entree.taille)
  }

  return {
    noms: entrees.filter((entree) => entree.type === 2).map((entree) => entree.nom),
    flux,
  }
}
