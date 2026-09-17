/**
 * Lecture d'XML, réduite à ce que demandent les formats de tableur.
 *
 * Le noyau de cette application est pur : aucun DOM, donc pas de `DOMParser`.
 * Ce n'est pas une contrainte subie mais ce qui permet d'éprouver la lecture
 * d'un classeur dans un test ordinaire, sans navigateur — et c'est là que les
 * erreurs de lecture se trouvent.
 *
 * Ce lecteur ne prétend pas être complet : il parcourt un flux de balises et de
 * texte, sans construire d'arbre. Les documents d'un `.xlsx` sont produits par
 * des machines, réguliers, et parfois très gros — un tableur de dix mille lignes
 * fait plusieurs mégaoctets. Les parcourir une fois sans rien garder en mémoire
 * est à la fois plus simple et plus sobre que de les matérialiser.
 *
 * Les espaces de noms sont ignorés : `<x:c>` et `<c>` désignent la même chose
 * ici, parce que deux tableurs écrivent le même fichier avec et sans préfixe.
 */

export type Jeton =
  | { type: 'ouvrante'; nom: string; attributs: Record<string, string>; autonome: boolean }
  | { type: 'fermante'; nom: string }
  | { type: 'texte'; valeur: string }

const ENTITES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** Remplace les entités XML. Une entité inconnue est laissée telle quelle. */
export function decoderEntites(texte: string): string {
  if (!texte.includes('&')) return texte
  return texte.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entier, corps: string) => {
    if (corps.startsWith('#x') || corps.startsWith('#X')) {
      const point = Number.parseInt(corps.slice(2), 16)
      return Number.isFinite(point) ? String.fromCodePoint(point) : entier
    }
    if (corps.startsWith('#')) {
      const point = Number.parseInt(corps.slice(1), 10)
      return Number.isFinite(point) ? String.fromCodePoint(point) : entier
    }
    return ENTITES[corps] ?? entier
  })
}

/** Retire le préfixe d'espace de noms : `x:c` devient `c`. */
function sansPrefixe(nom: string): string {
  const deuxPoints = nom.indexOf(':')
  return deuxPoints === -1 ? nom : nom.slice(deuxPoints + 1)
}

const ATTRIBUT = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g

function lireAttributs(source: string): Record<string, string> {
  const attributs: Record<string, string> = {}
  ATTRIBUT.lastIndex = 0
  let trouve: RegExpExecArray | null
  while ((trouve = ATTRIBUT.exec(source)) !== null) {
    attributs[sansPrefixe(trouve[1]!)] = decoderEntites(trouve[3] ?? trouve[4] ?? '')
  }
  return attributs
}

/**
 * Parcourt le document, balise après balise.
 *
 * Les commentaires, instructions de traitement et déclarations sont sautés : ils
 * ne portent aucune donnée dans un classeur. Le contenu d'une section `CDATA`
 * est en revanche restitué tel quel — c'est du texte, et le perdre perdrait un
 * libellé.
 */
export function* jetonsXml(xml: string): Generator<Jeton> {
  let i = 0
  while (i < xml.length) {
    const chevron = xml.indexOf('<', i)
    if (chevron === -1) {
      const reste = xml.slice(i)
      if (reste.trim() !== '') yield { type: 'texte', valeur: decoderEntites(reste) }
      return
    }
    if (chevron > i) {
      const texte = xml.slice(i, chevron)
      if (texte !== '') yield { type: 'texte', valeur: decoderEntites(texte) }
    }

    if (xml.startsWith('<!--', chevron)) {
      const fin = xml.indexOf('-->', chevron)
      i = fin === -1 ? xml.length : fin + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', chevron)) {
      const fin = xml.indexOf(']]>', chevron)
      const contenu = xml.slice(chevron + 9, fin === -1 ? xml.length : fin)
      if (contenu !== '') yield { type: 'texte', valeur: contenu }
      i = fin === -1 ? xml.length : fin + 3
      continue
    }
    if (xml.startsWith('<?', chevron) || xml.startsWith('<!', chevron)) {
      const fin = xml.indexOf('>', chevron)
      i = fin === -1 ? xml.length : fin + 1
      continue
    }

    // Une balise ordinaire. Le chevron fermant ne peut pas apparaître dans une
    // valeur d'attribut sans être échappé, mais on respecte quand même les
    // guillemets : un fichier produit à la main peut ne pas l'avoir échappé.
    let j = chevron + 1
    let guillemet: string | null = null
    while (j < xml.length) {
      const c = xml[j]!
      if (guillemet !== null) {
        if (c === guillemet) guillemet = null
      } else if (c === '"' || c === "'") guillemet = c
      else if (c === '>') break
      j += 1
    }
    const corps = xml.slice(chevron + 1, j)
    i = j + 1

    if (corps.startsWith('/')) {
      yield { type: 'fermante', nom: sansPrefixe(corps.slice(1).trim()) }
      continue
    }
    const autonome = corps.endsWith('/')
    const utile = autonome ? corps.slice(0, -1) : corps
    const espace = /\s/.exec(utile)
    const nom = sansPrefixe((espace ? utile.slice(0, espace.index) : utile).trim())
    if (nom === '') continue
    yield {
      type: 'ouvrante',
      nom,
      attributs: espace ? lireAttributs(utile.slice(espace.index)) : {},
      autonome,
    }
  }
}

/**
 * Concatène le texte d'un élément et de ses descendants, jusqu'à sa fermeture.
 *
 * `exclus` permet d'écarter des sous-éléments : un classeur japonais range la
 * prononciation d'un libellé dans `rPh`, au milieu du libellé lui-même, et la
 * prendre pour du texte double chaque mot.
 */
export function texteJusqua(
  jetons: Generator<Jeton>,
  nomElement: string,
  exclus: readonly string[] = [],
): string {
  let texte = ''
  let profondeur = 0
  let ignore = 0
  // Lecture à la main, et non `for...of` : sortir d'une boucle `for...of` par
  // un `return` appelle `return()` sur l'itérateur, ce qui **termine** le
  // générateur. Comme il est partagé avec l'appelant, la lecture du document
  // s'arrêterait net à la première cellule — sans erreur, avec une feuille vide.
  for (;;) {
    const pas = jetons.next()
    if (pas.done === true) break
    const jeton = pas.value
    if (jeton.type === 'ouvrante') {
      if (jeton.autonome) continue
      if (ignore > 0 || exclus.includes(jeton.nom)) ignore += 1
      else if (jeton.nom === nomElement) profondeur += 1
      continue
    }
    if (jeton.type === 'fermante') {
      if (ignore > 0) {
        ignore -= 1
        continue
      }
      if (jeton.nom === nomElement) {
        if (profondeur === 0) return texte
        profondeur -= 1
      }
      continue
    }
    if (ignore === 0) texte += jeton.valeur
  }
  return texte
}
