/**
 * Extraction du texte d'un PDF, puis reconstitution d'un tableau.
 *
 * C'est le format le plus incertain des trois, et il faut le dire franchement :
 * **un PDF ne contient pas de tableau**. Il contient des morceaux de texte
 * posés à des coordonnées. Ce qu'on lit comme une colonne n'existe nulle part
 * dans le fichier — c'est une régularité d'alignement, et il faut la retrouver.
 *
 * D'où la démarche, en deux temps :
 *
 * 1. **Relever chaque fragment avec sa position.** Le texte d'un PDF est décrit
 *    par une machine à écrire virtuelle : une matrice dit où poser le curseur,
 *    des opérateurs font avancer. On la suit.
 * 2. **Retrouver les colonnes par vote.** Une colonne se reconnaît à ce que la
 *    plupart des lignes se taisent entre elle et la suivante. On ne cherche pas
 *    un blanc que *personne* n'occupe — le titre de la banque et la ligne de
 *    solde traversent la page et les comblent tous — mais un blanc que la
 *    grande majorité respecte.
 *
 * Ce que cela ne fait pas, et qui doit être dit à l'utilisateur plutôt que
 * découvert par lui :
 *
 * - **Un PDF scanné ne donne rien.** Une photo de relevé ne contient aucun
 *   texte, seulement des pixels. Il n'y a pas de reconnaissance de caractères
 *   ici, et il n'y en aura pas : ce serait plusieurs mégaoctets de modèle pour
 *   un résultat qu'il faudrait de toute façon relire ligne à ligne.
 * - **Une mise en page inhabituelle peut mal se découper.** C'est précisément
 *   pourquoi l'écran d'import montre le résultat, colonne par colonne, et
 *   n'écrit rien tant que l'utilisateur n'a pas confirmé.
 */

export class ErreurPdf extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ErreurPdf'
  }
}

export function ressembleAUnPdf(octets: Uint8Array): boolean {
  // « %PDF- », parfois précédé de quelques octets parasites.
  const tete = new TextDecoder('latin1').decode(octets.subarray(0, 1024))
  return tete.includes('%PDF-')
}

// --- Objets --------------------------------------------------------------------

type Objet = { dictionnaire: string; flux: Uint8Array | null }

const LATIN1 = new TextDecoder('latin1')

/**
 * Relève tous les objets du fichier en le parcourant d'un bout à l'autre.
 *
 * On ne suit pas la table des références croisées : elle est souvent fausse
 * dans un fichier réparé ou produit par un outil pressé, et la reconstruire est
 * de toute façon ce que font les lecteurs quand elle l'est. Balayer coûte une
 * passe, et ne dépend de rien.
 */
function relever(octets: Uint8Array): Map<number, Objet> {
  const texte = LATIN1.decode(octets)
  const objets = new Map<number, Objet>()
  const debutObjet = /(\d+)\s+(\d+)\s+obj\b/g
  let trouve: RegExpExecArray | null

  while ((trouve = debutObjet.exec(texte)) !== null) {
    const numero = Number(trouve[1])
    const apres = debutObjet.lastIndex
    const finObjet = texte.indexOf('endobj', apres)
    const borne = finObjet === -1 ? texte.length : finObjet

    const marqueFlux = texte.indexOf('stream', apres)
    let dictionnaire: string
    let flux: Uint8Array | null = null

    if (marqueFlux !== -1 && marqueFlux < borne) {
      dictionnaire = texte.slice(apres, marqueFlux)
      let debut = marqueFlux + 6
      if (texte[debut] === '\r') debut += 1
      if (texte[debut] === '\n') debut += 1
      // `endstream` plutôt que la longueur déclarée : celle-ci est parfois une
      // référence indirecte, parfois fausse, et se tromper ici perd la page.
      const fin = texte.indexOf('endstream', debut)
      let borneFlux = fin === -1 ? borne : fin
      while (
        borneFlux > debut &&
        (texte[borneFlux - 1] === '\n' || texte[borneFlux - 1] === '\r')
      ) {
        borneFlux -= 1
      }
      flux = octets.subarray(debut, borneFlux)
    } else {
      dictionnaire = texte.slice(apres, borne)
    }

    objets.set(numero, { dictionnaire, flux })
  }
  return objets
}

// --- Filtres ---------------------------------------------------------------------

/** Même borne que pour les archives : un flux compressé peut être une bombe. */
const TAILLE_MAXIMALE = 64 * 1024 * 1024

async function inflater(donnees: Uint8Array): Promise<Uint8Array> {
  for (const format of ['deflate', 'deflate-raw'] as const) {
    let clair: Uint8Array | null = null
    try {
      const flux = new Blob([donnees as unknown as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream(format))
      clair = new Uint8Array(await new Response(flux).arrayBuffer())
    } catch {
      // Un flux sans en-tête zlib se décompresse en « brut » : on essaie l'autre.
    }
    // La vérification est hors du `try` : levée dedans, elle serait avalée par
    // le rattrapage et l'on essaierait l'autre format pour rien.
    if (clair !== null) {
      if (clair.length > TAILLE_MAXIMALE) throw new ErreurPdf('flux compressé démesuré')
      return clair
    }
  }
  throw new ErreurPdf('flux compressé illisible')
}

function decoderAscii85(donnees: Uint8Array): Uint8Array {
  const sortie: number[] = []
  let groupe = 0
  let compte = 0
  for (let i = 0; i < donnees.length; i++) {
    const c = donnees[i]!
    if (c === 0x7e) break // « ~> » : fin
    if (c <= 0x20) continue
    if (c === 0x7a && compte === 0) {
      sortie.push(0, 0, 0, 0)
      continue
    }
    if (c < 0x21 || c > 0x75) continue
    groupe = groupe * 85 + (c - 0x21)
    compte += 1
    if (compte === 5) {
      sortie.push(
        (groupe >>> 24) & 0xff,
        (groupe >>> 16) & 0xff,
        (groupe >>> 8) & 0xff,
        groupe & 0xff,
      )
      groupe = 0
      compte = 0
    }
  }
  if (compte > 0) {
    for (let rang = compte; rang < 5; rang++) groupe = groupe * 85 + 84
    const octets = [
      (groupe >>> 24) & 0xff,
      (groupe >>> 16) & 0xff,
      (groupe >>> 8) & 0xff,
      groupe & 0xff,
    ]
    sortie.push(...octets.slice(0, compte - 1))
  }
  return new Uint8Array(sortie)
}

function decoderAsciiHex(donnees: Uint8Array): Uint8Array {
  const sortie: number[] = []
  let haut = -1
  for (const octet of donnees) {
    if (octet === 0x3e) break
    const chiffre = Number.parseInt(String.fromCharCode(octet), 16)
    if (Number.isNaN(chiffre)) continue
    if (haut === -1) haut = chiffre
    else {
      sortie.push(haut * 16 + chiffre)
      haut = -1
    }
  }
  if (haut !== -1) sortie.push(haut * 16)
  return new Uint8Array(sortie)
}

async function decoder(objet: Objet): Promise<Uint8Array> {
  if (objet.flux === null) return new Uint8Array(0)
  let donnees = objet.flux
  const filtres = [
    ...objet.dictionnaire.matchAll(
      /\/(FlateDecode|ASCII85Decode|ASCIIHexDecode|LZWDecode|DCTDecode|RunLengthDecode)\b/g,
    ),
  ]
  for (const filtre of filtres) {
    const nom = filtre[1]
    if (nom === 'FlateDecode') donnees = await inflater(donnees)
    else if (nom === 'ASCII85Decode') donnees = decoderAscii85(donnees)
    else if (nom === 'ASCIIHexDecode') donnees = decoderAsciiHex(donnees)
    else throw new ErreurPdf(`filtre « ${nom} » non pris en charge`)
  }
  return donnees
}

// --- Encodages -------------------------------------------------------------------

/** Les seize caractères où Windows-1252 s'écarte du Latin-1. */
const HAUT_1252 = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x8d, 0x017d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc,
  0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
]

function winAnsi(octet: number): string {
  if (octet >= 0x80 && octet <= 0x9f) return String.fromCharCode(HAUT_1252[octet - 0x80]!)
  return String.fromCharCode(octet)
}

/** Noms de glyphes courants, pour les tables `/Differences`. */
const GLYPHES: Record<string, string> = {
  space: ' ',
  euro: '€',
  eacute: 'é',
  egrave: 'è',
  ecircumflex: 'ê',
  agrave: 'à',
  acircumflex: 'â',
  ccedilla: 'ç',
  ugrave: 'ù',
  ucircumflex: 'û',
  icircumflex: 'î',
  idieresis: 'ï',
  ocircumflex: 'ô',
  Eacute: 'É',
  Egrave: 'È',
  Agrave: 'À',
  Ccedilla: 'Ç',
  oe: 'œ',
  OE: 'Œ',
  quoteright: '’',
  quoteleft: '‘',
  quotedblleft: '“',
  quotedblright: '”',
  endash: '–',
  emdash: '—',
  periodcentered: '·',
  degree: '°',
  comma: ',',
  period: '.',
  hyphen: '-',
  plus: '+',
  slash: '/',
}

type Police = {
  /** Correspondance octet → texte, quand elle est connue. */
  table: Map<number, string>
  /** Vrai si les codes font deux octets (police composite). */
  deuxOctets: boolean
}

/** Lit une table `ToUnicode` : c'est la seule source sûre pour une police sous-ensemble. */
function lireToUnicode(source: string): Map<number, string> {
  const table = new Map<number, string>()
  const hexVersTexte = (hex: string) => {
    let texte = ''
    for (let i = 0; i + 4 <= hex.length; i += 4)
      texte += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16))
    return texte
  }

  for (const bloc of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const paire of bloc[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      table.set(Number.parseInt(paire[1]!, 16), hexVersTexte(paire[2]!))
    }
  }
  for (const bloc of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const plage of bloc[1]!.matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g,
    )) {
      const debut = Number.parseInt(plage[1]!, 16)
      const fin = Number.parseInt(plage[2]!, 16)
      const cible = Number.parseInt(plage[3]!, 16)
      for (let code = debut; code <= fin && code - debut < 65536; code++) {
        table.set(code, String.fromCharCode(cible + (code - debut)))
      }
    }
  }
  return table
}

// --- Fragments de texte -------------------------------------------------------------

type Fragment = { x: number; y: number; largeur: number; taille: number; texte: string }

type Matrice = [number, number, number, number, number, number]

function multiplier(a: Matrice, b: Matrice): Matrice {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ]
}

/** Découpe un flux de contenu en jetons PDF. */
function* jetonsContenu(
  source: string,
): Generator<{ type: 'nombre' | 'operateur' | 'nom' | 'texte' | 'crochet'; valeur: string }> {
  let i = 0
  while (i < source.length) {
    const c = source[i]!
    if (c === '%') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (/\s/.test(c)) {
      i += 1
      continue
    }
    if (c === '(') {
      // Chaîne littérale : parenthèses imbriquées et échappements.
      let profondeur = 1
      let texte = ''
      i += 1
      while (i < source.length && profondeur > 0) {
        const d = source[i]!
        if (d === '\\') {
          const suivant = source[i + 1]!
          if (suivant >= '0' && suivant <= '7') {
            let octal = ''
            let j = i + 1
            while (
              j < source.length &&
              octal.length < 3 &&
              source[j]! >= '0' &&
              source[j]! <= '7'
            ) {
              octal += source[j]!
              j += 1
            }
            texte += String.fromCharCode(Number.parseInt(octal, 8))
            i = j
            continue
          }
          const echappes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }
          if (suivant === '\n') i += 2
          else {
            texte += echappes[suivant] ?? suivant
            i += 2
          }
          continue
        }
        if (d === '(') profondeur += 1
        else if (d === ')') {
          profondeur -= 1
          if (profondeur === 0) {
            i += 1
            break
          }
        }
        texte += d
        i += 1
      }
      yield { type: 'texte', valeur: texte }
      continue
    }
    if (c === '<' && source[i + 1] !== '<') {
      const fin = source.indexOf('>', i)
      const hex = source.slice(i + 1, fin === -1 ? source.length : fin).replace(/\s/g, '')
      let texte = ''
      for (let j = 0; j + 1 < hex.length + 1; j += 2) {
        const paire = hex.slice(j, j + 2).padEnd(2, '0')
        if (paire.trim() === '') break
        texte += String.fromCharCode(Number.parseInt(paire, 16))
      }
      yield { type: 'texte', valeur: texte }
      i = fin === -1 ? source.length : fin + 1
      continue
    }
    if (c === '[' || c === ']') {
      yield { type: 'crochet', valeur: c }
      i += 1
      continue
    }
    if (c === '<' || c === '>') {
      i += 2
      continue
    }
    if (c === '/') {
      let j = i + 1
      while (j < source.length && !/[\s/[\]<>()]/.test(source[j]!)) j += 1
      yield { type: 'nom', valeur: source.slice(i + 1, j) }
      i = j
      continue
    }
    if (/[-+.\d]/.test(c)) {
      let j = i
      while (j < source.length && /[-+.\d]/.test(source[j]!)) j += 1
      yield { type: 'nombre', valeur: source.slice(i, j) }
      i = j
      continue
    }
    let j = i
    while (j < source.length && !/[\s/[\]<>()]/.test(source[j]!)) j += 1
    if (j === i) j += 1
    yield { type: 'operateur', valeur: source.slice(i, j) }
    i = j
  }
}

/**
 * Suit la machine à écrire du PDF et relève chaque fragment posé.
 *
 * La largeur est estimée à la moitié du corps par caractère : sans les
 * métriques de la police, on ne peut pas faire mieux — et ce n'est pas
 * nécessaire, puisque cette largeur ne sert qu'à repérer de larges blancs entre
 * colonnes, jamais à afficher quoi que ce soit.
 */
function fragmentsDuContenu(contenu: string, polices: Map<string, Police>): Fragment[] {
  const fragments: Fragment[] = []
  const pile: number[] = []
  let ctm: Matrice = [1, 0, 0, 1, 0, 0]
  let matriceTexte: Matrice = [1, 0, 0, 1, 0, 0]
  let matriceLigne: Matrice = [1, 0, 0, 1, 0, 0]
  let taille = 10
  let interligne = 0
  let police: Police | undefined
  let dansTexte = false

  const nombres: number[] = []
  const prendre = (combien: number) =>
    nombres.splice(Math.max(0, nombres.length - combien), combien)

  const poser = (texte: string) => {
    if (texte === '') return
    const complet = multiplier(matriceTexte, ctm)
    const echelle = Math.sqrt(Math.abs(complet[0] * complet[3] - complet[1] * complet[2])) || 1
    const corps = taille * echelle
    const largeur = texte.length * corps * 0.5
    fragments.push({ x: complet[4], y: complet[5], largeur, taille: corps, texte })
    // Le curseur avance : deux `Tj` de suite s'écrivent l'un après l'autre.
    matriceTexte = multiplier([1, 0, 0, 1, largeur / (echelle || 1), 0], matriceTexte)
  }

  const decoder = (brut: string): string => {
    if (police === undefined) return brut
    if (police.deuxOctets) {
      let texte = ''
      for (let i = 0; i + 1 < brut.length; i += 2) {
        const code = (brut.charCodeAt(i) << 8) | brut.charCodeAt(i + 1)
        texte += police.table.get(code) ?? ''
      }
      return texte
    }
    let texte = ''
    for (const caractere of brut) {
      const code = caractere.charCodeAt(0)
      texte += police.table.get(code) ?? winAnsi(code)
    }
    return texte
  }

  let dernierNom = ''
  let dernierTexte = ''
  let dansTableau = false
  let tableau = ''

  for (const jeton of jetonsContenu(contenu)) {
    if (jeton.type === 'nombre') {
      nombres.push(Number(jeton.valeur))
      continue
    }
    if (jeton.type === 'nom') {
      dernierNom = jeton.valeur
      continue
    }
    if (jeton.type === 'texte') {
      if (dansTableau) tableau += decoder(jeton.valeur)
      else dernierTexte = jeton.valeur
      continue
    }
    if (jeton.type === 'crochet') {
      if (jeton.valeur === '[') {
        dansTableau = true
        tableau = ''
      } else dansTableau = false
      continue
    }

    switch (jeton.valeur) {
      case 'BT':
        dansTexte = true
        matriceTexte = [1, 0, 0, 1, 0, 0]
        matriceLigne = [1, 0, 0, 1, 0, 0]
        break
      case 'ET':
        dansTexte = false
        break
      case 'q':
        pile.push(...ctm)
        break
      case 'Q': {
        const reprise = pile.splice(Math.max(0, pile.length - 6), 6)
        if (reprise.length === 6) ctm = reprise as unknown as Matrice
        break
      }
      case 'cm': {
        const v = prendre(6)
        if (v.length === 6) ctm = multiplier(v as Matrice, ctm)
        break
      }
      case 'Tf': {
        const v = prendre(1)
        taille = v[0] ?? taille
        police = polices.get(dernierNom)
        break
      }
      case 'TL':
        interligne = prendre(1)[0] ?? interligne
        break
      case 'Tm': {
        const v = prendre(6)
        if (v.length === 6) {
          matriceLigne = v as Matrice
          matriceTexte = [...matriceLigne] as Matrice
        }
        break
      }
      case 'Td': {
        const v = prendre(2)
        matriceLigne = multiplier([1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0], matriceLigne)
        matriceTexte = [...matriceLigne] as Matrice
        break
      }
      case 'TD': {
        const v = prendre(2)
        interligne = -(v[1] ?? 0)
        matriceLigne = multiplier([1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0], matriceLigne)
        matriceTexte = [...matriceLigne] as Matrice
        break
      }
      case 'T*':
        matriceLigne = multiplier([1, 0, 0, 1, 0, -interligne], matriceLigne)
        matriceTexte = [...matriceLigne] as Matrice
        break
      case 'Tj':
        if (dansTexte) poser(decoder(dernierTexte))
        break
      case 'TJ':
        if (dansTexte) poser(tableau)
        break
      case "'":
        matriceLigne = multiplier([1, 0, 0, 1, 0, -interligne], matriceLigne)
        matriceTexte = [...matriceLigne] as Matrice
        if (dansTexte) poser(decoder(dernierTexte))
        break
      case '"':
        prendre(2)
        matriceLigne = multiplier([1, 0, 0, 1, 0, -interligne], matriceLigne)
        matriceTexte = [...matriceLigne] as Matrice
        if (dansTexte) poser(decoder(dernierTexte))
        break
      default:
        nombres.length = 0
    }
    if (jeton.type === 'operateur') nombres.length = 0
  }

  return fragments
}

// --- Du nuage de fragments à un tableau ---------------------------------------------

/** Regroupe les fragments qui partagent la même ligne de base. */
function grouperEnLignes(fragments: readonly Fragment[]): Fragment[][] {
  if (fragments.length === 0) return []
  const tries = [...fragments].sort((a, b) => (Math.abs(a.y - b.y) > 0.6 ? b.y - a.y : a.x - b.x))
  const lignes: Fragment[][] = []
  let courante: Fragment[] = []
  let reference = tries[0]!.y

  for (const fragment of tries) {
    // Deux fragments sont sur la même ligne si leurs bases se tiennent à moins
    // de la moitié d'un corps : un exposant ou un décalage typographique ne doit
    // pas ouvrir une ligne, un interligne serré ne doit pas les fondre.
    const tolerance = Math.max(2, fragment.taille * 0.5)
    if (courante.length > 0 && Math.abs(fragment.y - reference) > tolerance) {
      lignes.push(courante.sort((a, b) => a.x - b.x))
      courante = []
    }
    if (courante.length === 0) reference = fragment.y
    courante.push(fragment)
  }
  if (courante.length > 0) lignes.push(courante.sort((a, b) => a.x - b.x))
  return lignes
}

/**
 * Trouve les frontières de colonnes, par vote des lignes.
 *
 * La méthode évidente — chercher les bandes verticales que *personne* n'occupe
 * — ne marche pas sur un vrai relevé : le titre de la banque, l'adresse et la
 * ligne de solde traversent la page de part en part et comblent tous les blancs
 * à eux seuls. Deux colonnes disparaissent à cause de trois lignes.
 *
 * On compte donc les voix. Pour chaque abscisse, on regarde combien de lignes
 * **la traversent** (leur texte commence avant et finit après) et, parmi
 * elles, combien y ont un **blanc intérieur**. Une abscisse où la grande
 * majorité des lignes se taisent est une frontière, même si deux ou trois
 * lignes écrivent par-dessus.
 *
 * Seuls les blancs *entre* les fragments d'une ligne comptent : ce qui suit son
 * dernier mot n'est pas un blanc de colonne, c'est une ligne plus courte, et le
 * compter ferait voter toutes les lignes courtes pour n'importe quelle
 * frontière à leur droite.
 */
export function frontieresDeColonnes(
  lignes: readonly (readonly Fragment[])[],
  ecartMinimal = 5,
  proportion = 0.6,
): number[] {
  type Bande = { debut: number; fin: number }
  const portees: Bande[] = []
  const blancs: Bande[] = []
  let maximum = 0

  for (const ligne of lignes) {
    if (ligne.length === 0) continue
    const tries = [...ligne].sort((a, b) => a.x - b.x)
    const debut = tries[0]!.x
    let fin = debut
    for (const fragment of tries) fin = Math.max(fin, fragment.x + fragment.largeur)
    portees.push({ debut, fin })
    maximum = Math.max(maximum, fin)

    let bord = tries[0]!.x + tries[0]!.largeur
    for (const fragment of tries.slice(1)) {
      if (fragment.x > bord) blancs.push({ debut: bord, fin: fragment.x })
      bord = Math.max(bord, fragment.x + fragment.largeur)
    }
  }
  if (portees.length === 0) return []

  const largeur = Math.ceil(maximum) + 2
  const traversent = new Int32Array(largeur)
  const muettes = new Int32Array(largeur)
  const marquer = (tableau: Int32Array, bande: Bande) => {
    const de = Math.max(0, Math.floor(bande.debut))
    const a = Math.min(largeur - 1, Math.ceil(bande.fin))
    for (let x = de; x <= a; x++) tableau[x] = (tableau[x] ?? 0) + 1
  }
  for (const portee of portees) marquer(traversent, portee)
  for (const blanc of blancs) marquer(muettes, blanc)

  const frontieres: number[] = []
  let debutRun = -1
  for (let x = 0; x < largeur; x++) {
    const total = traversent[x]!
    const separateur = total >= 2 && muettes[x]! / total >= proportion
    if (separateur) {
      if (debutRun === -1) debutRun = x
    } else if (debutRun !== -1) {
      if (x - debutRun >= ecartMinimal) frontieres.push((debutRun + x) / 2)
      debutRun = -1
    }
  }
  if (debutRun !== -1 && largeur - debutRun >= ecartMinimal) {
    frontieres.push((debutRun + largeur) / 2)
  }
  return frontieres
}

function enTableau(lignes: readonly Fragment[][], frontieres: readonly number[]): string[][] {
  return lignes.map((ligne) => {
    const cellules: string[] = Array.from({ length: frontieres.length + 1 }, () => '')
    for (const fragment of ligne) {
      let colonne = 0
      while (colonne < frontieres.length && fragment.x >= frontieres[colonne]!) colonne += 1
      cellules[colonne] =
        cellules[colonne] === '' ? fragment.texte : `${cellules[colonne]} ${fragment.texte}`
    }
    return cellules.map((cellule) => cellule.trim())
  })
}

// --- Entrée publique ------------------------------------------------------------------

export type TableauPdf = {
  /** Nombre de pages lues. Une page sans texte compte quand même. */
  pages: number
  lignes: string[][]
}

/**
 * Lit un PDF et en tire un seul tableau.
 *
 * Les colonnes sont décidées sur **l'ensemble des pages**, pas page par page :
 * un relevé garde la même mise en page d'un bout à l'autre, et une page deux
 * fois moins remplie que la première y trouverait des colonnes différentes —
 * donc des cellules décalées au moment de recoller.
 *
 * Les lignes de toutes les pages se suivent ensuite dans l'ordre. Les en-têtes
 * répétés en haut de chaque page ne sont pas retirés : ils n'ont ni date ni
 * montant, l'import les refusera en le disant, et les retirer d'autorité
 * reviendrait à deviner lesquels sont des en-têtes.
 */
export async function lirePdf(octets: Uint8Array): Promise<TableauPdf> {
  if (!ressembleAUnPdf(octets)) throw new ErreurPdf('ce fichier n’est pas un PDF')
  const objets = relever(octets)
  if (objets.size === 0) throw new ErreurPdf('PDF illisible : aucun objet trouvé')

  // Les objets peuvent être rangés dans des flux d'objets ; on les déplie.
  for (const objet of [...objets.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(objet.dictionnaire)) continue
    try {
      const clair = LATIN1.decode(await decoder(objet))
      const nombre = Number(/\/N\s+(\d+)/.exec(objet.dictionnaire)?.[1] ?? '0')
      const premier = Number(/\/First\s+(\d+)/.exec(objet.dictionnaire)?.[1] ?? '0')
      const entete = clair.slice(0, premier).trim().split(/\s+/).map(Number)
      for (let rang = 0; rang < nombre; rang++) {
        const numero = entete[rang * 2]
        const decalage = entete[rang * 2 + 1]
        if (numero === undefined || decalage === undefined) continue
        const suivant = entete[rang * 2 + 3]
        const fin = suivant === undefined ? clair.length : premier + suivant
        if (!objets.has(numero)) {
          objets.set(numero, { dictionnaire: clair.slice(premier + decalage, fin), flux: null })
        }
      }
    } catch {
      // Un flux d'objets illisible ne doit pas empêcher de lire le reste.
    }
  }

  const reference = (source: string, cle: string): number | null => {
    const trouve = new RegExp(`/${cle}\\s+(\\d+)\\s+\\d+\\s+R`).exec(source)
    return trouve ? Number(trouve[1]) : null
  }

  // --- Polices d'une page -------------------------------------------------------
  async function policesDe(dictionnaire: string): Promise<Map<string, Police>> {
    const polices = new Map<string, Police>()
    let ressources = /\/Resources\s*<<([\s\S]*?)>>\s*(?:\/|>>)/.exec(dictionnaire)?.[1] ?? ''
    const renvoiRessources = reference(dictionnaire, 'Resources')
    if (ressources === '' && renvoiRessources !== null) {
      ressources = objets.get(renvoiRessources)?.dictionnaire ?? ''
    }

    let dictPolices = /\/Font\s*<<([\s\S]*?)>>/.exec(ressources)?.[1] ?? ''
    const renvoiPolices = reference(ressources, 'Font')
    if (dictPolices === '' && renvoiPolices !== null) {
      dictPolices = objets.get(renvoiPolices)?.dictionnaire ?? ''
    }

    for (const entree of dictPolices.matchAll(/\/([^\s/]+)\s+(\d+)\s+\d+\s+R/g)) {
      const objet = objets.get(Number(entree[2]))
      if (objet === undefined) continue
      const table = new Map<number, string>()

      const renvoiUnicode = reference(objet.dictionnaire, 'ToUnicode')
      if (renvoiUnicode !== null) {
        const source = objets.get(renvoiUnicode)
        if (source !== undefined) {
          try {
            for (const [code, texte] of lireToUnicode(LATIN1.decode(await decoder(source)))) {
              table.set(code, texte)
            }
          } catch {
            // Sans table de correspondance, on retombe sur l'encodage déclaré.
          }
        }
      }

      // `/Differences` : une table de glyphes nommés, qui prime sur l'encodage.
      const differences = /\/Differences\s*\[([\s\S]*?)\]/.exec(objet.dictionnaire)?.[1]
      if (differences !== undefined) {
        let code = 0
        for (const jeton of differences.trim().split(/\s+/)) {
          if (/^\d+$/.test(jeton)) code = Number(jeton)
          else {
            const glyphe = GLYPHES[jeton.replace(/^\//, '')]
            if (glyphe !== undefined) table.set(code, glyphe)
            code += 1
          }
        }
      }

      polices.set(entree[1]!, {
        table,
        deuxOctets: /\/Subtype\s*\/Type0\b/.test(objet.dictionnaire),
      })
    }
    return polices
  }

  // --- Pages --------------------------------------------------------------------
  const parPage: Fragment[][][] = []
  for (const [, objet] of objets) {
    if (!/\/Type\s*\/Page\b/.test(objet.dictionnaire)) continue

    const contenus: number[] = []
    const unique = reference(objet.dictionnaire, 'Contents')
    if (unique !== null) contenus.push(unique)
    else {
      const tableau = /\/Contents\s*\[([\s\S]*?)\]/.exec(objet.dictionnaire)?.[1] ?? ''
      for (const renvoi of tableau.matchAll(/(\d+)\s+\d+\s+R/g)) contenus.push(Number(renvoi[1]))
    }

    let contenu = ''
    for (const numeroContenu of contenus) {
      const source = objets.get(numeroContenu)
      if (source === undefined) continue
      try {
        contenu += `${LATIN1.decode(await decoder(source))}\n`
      } catch {
        // Une page illisible est une page vide : l'aperçu le montrera.
      }
    }
    if (contenu.trim() === '') {
      parPage.push([])
      continue
    }

    const fragments = fragmentsDuContenu(contenu, await policesDe(objet.dictionnaire))
    parPage.push(grouperEnLignes(fragments))
  }

  if (parPage.length === 0) throw new ErreurPdf('ce PDF ne contient aucune page lisible')

  const toutes = parPage.flat()
  const frontieres = frontieresDeColonnes(toutes)
  const lignes: string[][] = []
  for (const page of parPage) lignes.push(...enTableau(page, frontieres))
  return { pages: parPage.length, lignes }
}
