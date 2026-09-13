/**
 * Lecture d'un fichier CSV.
 *
 * Rien de bancaire ici : on transforme des octets en tableau de champs, et c'est
 * tout. Le sens des colonnes se décide ailleurs (`domain/releve.ts`), parce que
 * deux banques ne nomment jamais leurs colonnes pareil alors qu'elles produisent
 * toutes le même genre de fichier.
 *
 * Deux pièges valent d'être nommés, parce qu'ils ne lèvent aucune erreur — ils
 * produisent silencieusement des données fausses :
 *
 * - **L'encodage.** Beaucoup de banques françaises exportent en Windows-1252.
 *   Décodé en UTF-8, « VIREMENT RETRAITÉ » devient « VIREMENT RETRAIT<?> », et
 *   l'empreinte qui sert à reconnaître un doublon change avec lui. On essaie
 *   donc l'UTF-8 en mode strict d'abord : s'il refuse, le fichier n'est pas de
 *   l'UTF-8, et Windows-1252 est le seul autre candidat sérieux.
 * - **Le séparateur.** Le point-virgule domine en France, mais pas partout, et
 *   un libellé contient souvent une virgule. Deviner d'après le nombre de champs
 *   obtenus est plus sûr que de supposer.
 */

export const SEPARATEURS = [';', ',', '\t', '|'] as const
export type Separateur = (typeof SEPARATEURS)[number]

export const NOMS_SEPARATEUR: Record<Separateur, string> = {
  ';': 'point-virgule',
  ',': 'virgule',
  '\t': 'tabulation',
  '|': 'barre verticale',
}

/**
 * Décode les octets du fichier.
 *
 * L'UTF-8 est tenté **en mode strict** : sans `fatal`, un octet invalide se
 * changerait en « <?> » sans rien dire, et le fichier paraîtrait lisible tout en
 * ayant perdu tous ses accents.
 */
export function decoderTexte(octets: ArrayBuffer): { texte: string; encodage: string } {
  try {
    return { texte: new TextDecoder('utf-8', { fatal: true }).decode(octets), encodage: 'UTF-8' }
  } catch {
    // Ce n'est pas de l'UTF-8 : on retombe sur l'encodage des exports bancaires
    // français. Windows-1252 accepte tous les octets, il ne peut pas échouer
    // pour la même raison — mais un environnement sans table de caractères
    // complète peut ne pas le connaître, d'où le dernier recours tolérant.
    try {
      return {
        texte: new TextDecoder('windows-1252').decode(octets),
        encodage: 'Windows-1252',
      }
    } catch {
      return { texte: new TextDecoder('utf-8').decode(octets), encodage: 'UTF-8 (approché)' }
    }
  }
}

/**
 * Découpe le texte en lignes de champs.
 *
 * Guillemets conformes au RFC 4180 : un champ entre guillemets peut contenir le
 * séparateur et des retours à la ligne, et deux guillemets consécutifs valent un
 * guillemet littéral. Sans cela, un libellé comme « CB "LE PETIT MARCHE" » ou
 * un montant entre guillemets décalerait toutes les colonnes de la ligne.
 */
export function decouper(texte: string, separateur: string): string[][] {
  const lignes: string[][] = []
  let champs: string[] = []
  let courant = ''
  let entreGuillemets = false
  let debutDeChamp = true

  const finirChamp = () => {
    champs.push(courant)
    courant = ''
    debutDeChamp = true
  }
  const finirLigne = () => {
    finirChamp()
    lignes.push(champs)
    champs = []
  }

  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]!
    if (entreGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') {
          courant += '"'
          i += 1
        } else entreGuillemets = false
      } else courant += c
      continue
    }
    if (c === '"' && debutDeChamp) {
      entreGuillemets = true
      debutDeChamp = false
      continue
    }
    if (c === separateur) {
      finirChamp()
      continue
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i += 1
      finirLigne()
      continue
    }
    courant += c
    debutDeChamp = false
  }
  if (courant !== '' || champs.length > 0) finirLigne()

  // Les lignes vides sont du bruit de fin de fichier, pas des opérations.
  return lignes.filter((ligne) => ligne.some((champ) => champ.trim() !== ''))
}

/** Valeur la plus fréquente d'une liste de nombres. */
function modale(valeurs: readonly number[]): number {
  const comptes = new Map<number, number>()
  for (const valeur of valeurs) comptes.set(valeur, (comptes.get(valeur) ?? 0) + 1)
  let meilleure = 0
  let meilleurCompte = 0
  for (const [valeur, compte] of comptes) {
    if (compte > meilleurCompte || (compte === meilleurCompte && valeur > meilleure)) {
      meilleure = valeur
      meilleurCompte = compte
    }
  }
  return meilleure
}

/**
 * Devine le séparateur.
 *
 * Le bon séparateur est celui qui découpe le fichier en lignes **de largeur
 * constante** : une virgule qui tombe dans des libellés donne un nombre de
 * champs qui varie d'une ligne à l'autre, un point-virgule qui sépare vraiment
 * les colonnes donne toujours le même. On préfère donc la régularité, et le
 * nombre de colonnes ne sert qu'à départager.
 */
export function detecterSeparateur(texte: string): Separateur {
  let meilleur: Separateur = ';'
  let meilleurScore = -1
  for (const separateur of SEPARATEURS) {
    const lignes = decouper(texte, separateur).slice(0, 30)
    if (lignes.length === 0) continue
    const tailles = lignes.map((ligne) => ligne.length)
    const largeur = modale(tailles)
    if (largeur < 2) continue
    const regulieres = tailles.filter((taille) => taille === largeur).length
    const score = (regulieres / tailles.length) * 1000 + largeur
    if (score > meilleurScore) {
      meilleurScore = score
      meilleur = separateur
    }
  }
  return meilleur
}

export type FichierCsv = {
  separateur: Separateur
  /** Toutes les lignes, en-tête comprise : c'est à l'appelant de la désigner. */
  lignes: string[][]
}

export function analyserCsv(texte: string, separateur?: Separateur): FichierCsv {
  const choisi = separateur ?? detecterSeparateur(texte)
  return { separateur: choisi, lignes: decouper(texte, choisi) }
}
