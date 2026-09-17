/**
 * Import d'un relevé bancaire.
 *
 * Le journal est en ajout seul : un import **ne modifie jamais** ce qui existe,
 * il ne peut qu'ajouter. C'est une garantie forte — vos saisies ne seront pas
 * écrasées — mais elle a un revers, et c'est tout l'objet de ce module :
 * l'erreur possible n'est pas la perte, c'est le **doublon**.
 *
 * Il y en a trois espèces, de plus en plus sournoises :
 *
 * 1. **Réimporter le même fichier.** L'import du journal JSON se protège par
 *    l'`id` d'événement : deux exemplaires du même `id` sont le même événement.
 *    Un relevé bancaire n'a pas d'`id`, alors on lui en fabrique un — voir
 *    `identifiantsOperation`. La même ligne redonne le même identifiant, donc
 *    l'union sur `id` refait son travail toute seule, y compris entre deux
 *    appareils qui importent chacun le fichier de leur côté.
 * 2. **Une ligne déjà saisie à la main.** Aucune empreinte ne peut la
 *    reconnaître à coup sûr, parce que le libellé de la banque n'est pas celui
 *    qu'on a tapé. On repère donc les ressemblances (même compte, même jour,
 *    même montant) et on les **montre** plutôt que de trancher en silence.
 * 3. **La réconciliation.** C'est la plus vicieuse, et elle ne se voit pas :
 *    chaque réconciliation écrit un « Non catégorisé » égal à l'écart, qui
 *    *représente déjà* les dépenses non saisies de la période. Importer le
 *    relevé de cette même période les fait revenir une seconde fois, en détail.
 *    Rien dans les montants ne permet de le deviner — un « Non catégorisé » de
 *    −214,30 € ne ressemble à aucune des neuf lignes qu'il résume. Seules les
 *    **dates** le disent, et c'est ce que calcule `reconciliationsCouvertes`.
 *
 * Un quatrième effet n'est pas un doublon mais surprend autant : le solde se
 * calcule à partir du dernier relevé et des mouvements **postérieurs**. Des
 * lignes antérieures enrichissent l'historique et les totaux par poste, mais ne
 * bougent pas le solde d'un centime. Mieux vaut le dire avant l'import que de
 * laisser croire à une panne.
 */
import { ajouterJours, depuisComposantes, estDans, type CivilDate } from '../core/civilDate'
import { cents, type Cents } from '../core/money'
import { normaliserNom } from './etat'
import type { Etat, Transaction } from './etat'
import type { EntreeJournal, Evenement } from './events'
import { ancreDuCompte } from './selecteurs'

// --- Dates ---------------------------------------------------------------------

const JOUR_MOIS_AN = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/
const ISO = /^(\d{4})-(\d{2})-(\d{2})/

/**
 * Lit une date de relevé.
 *
 * Le format français d'abord — c'est celui des banques françaises — puis l'ISO,
 * qu'on reconnaît aussi en tête d'un horodatage complet. Une date impossible
 * (le 31 avril, le 29 février d'une année ordinaire) est refusée par
 * `depuisComposantes` plutôt que glissée au 1er mai : un relevé qui contient une
 * date pareille n'a pas été lu correctement, et il vaut mieux le dire.
 */
export function analyserDateReleve(texte: string): CivilDate | null {
  const propre = texte.trim()
  if (propre === '') return null
  try {
    const iso = ISO.exec(propre)
    if (iso) return depuisComposantes(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    const fr = JOUR_MOIS_AN.exec(propre)
    if (!fr) return null
    const brut = Number(fr[3])
    // Un relevé bancaire ne parle jamais du siècle dernier autrement que par
    // convention : 00–68 se lit 2000–2068, le reste 1969–1999.
    const annee = fr[3]!.length === 4 ? brut : brut <= 68 ? 2000 + brut : 1900 + brut
    return depuisComposantes(annee, Number(fr[2]), Number(fr[1]))
  } catch {
    return null
  }
}

// --- Montants ------------------------------------------------------------------

const ESPACES = /[\s']/g
const DEVISE = /€|EUR/gi

export type SeparateurDecimal = ',' | '.'

/**
 * Devine le séparateur décimal d'une colonne de montants.
 *
 * Pris isolément, « 1.234 » est indécidable : mille deux cent trente-quatre dans
 * un fichier français, un virgule deux trois quatre dans un fichier anglais — et
 * se tromper fait une erreur d'un facteur mille. Le fichier entier, lui, tranche
 * presque toujours : dès qu'une seule ligne montre deux décimales derrière un
 * séparateur, on sait lequel des deux porte les centimes.
 */
export function detecterSeparateurDecimal(valeurs: readonly string[]): SeparateurDecimal | null {
  let virgule = 0
  let point = 0
  for (const brut of valeurs) {
    const propre = brut
      .replace(ESPACES, '')
      .replace(DEVISE, '')
      .replace(/[-+()]/g, '')
    if (/,\d{1,2}$/.test(propre)) virgule += 1
    if (/\.\d{1,2}$/.test(propre)) point += 1
  }
  if (virgule > point) return ','
  if (point > virgule) return '.'
  return null
}

/**
 * Lit un montant de relevé.
 *
 * Plus permissif que la saisie à la main, parce qu'on ne choisit pas le format
 * de son relevé : « 1 234,56 », « 1.234,56 », « 1,234.56 », « 12.50- »,
 * « (12,50) », « +2 000,00 EUR ».
 *
 * Deux règles, et la seconde vaut d'être dite :
 *
 * - **Trois décimales sont refusées, jamais tronquées.** Rogner un centime en
 *   silence, c'est perdre de l'argent sans le dire.
 * - **Un séparateur ambigu est refusé aussi.** Sans le contexte du fichier,
 *   « 1.234 » peut valoir 1 234,00 € ou 1,234 € : on ne devine pas au hasard sur
 *   un facteur mille. Donnez `decimale` — `lireOperations` le fait pour vous, en
 *   le déduisant de toute la colonne — et l'ambiguïté disparaît.
 */
export function analyserMontantReleve(texte: string, decimale?: SeparateurDecimal): Cents | null {
  let propre = texte.replace(ESPACES, '').replace(DEVISE, '').trim()
  if (propre === '') return null

  let negatif = false
  if (propre.startsWith('(') && propre.endsWith(')')) {
    negatif = true
    propre = propre.slice(1, -1)
  }
  // Le signe peut suivre le nombre : certains exports écrivent « 12,50- ».
  if (propre.endsWith('-')) {
    negatif = true
    propre = propre.slice(0, -1)
  } else if (propre.endsWith('+')) {
    propre = propre.slice(0, -1)
  }
  if (propre.startsWith('-')) {
    negatif = !negatif
    propre = propre.slice(1)
  } else if (propre.startsWith('+')) {
    propre = propre.slice(1)
  }
  if (propre === '' || !/^[\d.,]+$/.test(propre)) return null

  let entiere: string
  let centimes: string

  if (decimale !== undefined) {
    // Tout séparateur qui n'est pas le décimal groupe des milliers, et un
    // groupe de milliers compte exactement trois chiffres.
    const milliers = decimale === ',' ? '.' : ','
    const morceaux = propre.split(milliers)
    if (morceaux.length > 1) {
      if (morceaux[0] === '') return null
      if (morceaux.slice(1).some((morceau) => !/^\d{3}(?:$|[.,])/.test(morceau))) return null
      propre = morceaux.join('')
    }
    const pos = propre.indexOf(decimale)
    if (pos === -1) {
      entiere = propre
      centimes = ''
    } else {
      if (propre.lastIndexOf(decimale) !== pos) return null
      entiere = propre.slice(0, pos)
      centimes = propre.slice(pos + 1)
      if (centimes.length < 1 || centimes.length > 2) return null
    }
  } else {
    const dernier = Math.max(propre.lastIndexOf(','), propre.lastIndexOf('.'))
    if (dernier === -1) {
      entiere = propre
      centimes = ''
    } else {
      const suivantes = propre.length - dernier - 1
      // Un seul séparateur suivi de trois chiffres : indécidable hors contexte.
      if (suivantes !== 1 && suivantes !== 2) return null
      entiere = propre.slice(0, dernier)
      centimes = propre.slice(dernier + 1)
    }
  }

  const groupes = entiere.split(/[.,]/)
  if (groupes.slice(1).some((groupe) => groupe.length !== 3)) return null
  const chiffres = groupes.join('')
  if (chiffres === '' && centimes === '') return null
  if (!/^\d*$/.test(chiffres) || !/^\d*$/.test(centimes)) return null

  const total = Number(chiffres || '0') * 100 + Number(centimes.padEnd(2, '0') || '0')
  if (!Number.isSafeInteger(total)) return null
  return cents(negatif ? -total : total)
}

// --- Colonnes ------------------------------------------------------------------

export const ROLES = [
  'ignore',
  'date',
  'libelle',
  'montant',
  'debit',
  'credit',
  'reference',
] as const
export type RoleColonne = (typeof ROLES)[number]

export const NOMS_ROLE: Record<RoleColonne, string> = {
  ignore: 'Ignorer',
  date: 'Date',
  libelle: 'Libellé',
  montant: 'Montant (signé)',
  debit: 'Débit',
  credit: 'Crédit',
  reference: 'Référence',
}

/** Une correspondance donne un rôle à chaque colonne du fichier. */
export type Correspondance = RoleColonne[]

const INDICES: { role: RoleColonne; mots: string[] }[] = [
  { role: 'debit', mots: ['debit', 'sortie', 'retrait', 'depense'] },
  { role: 'credit', mots: ['credit', 'entree', 'depot', 'recette'] },
  { role: 'montant', mots: ['montant', 'amount', 'valeur'] },
  { role: 'date', mots: ['date', 'jour'] },
  {
    role: 'libelle',
    mots: ['libelle', 'description', 'nature', 'intitule', 'detail', 'motif', 'communication'],
  },
  { role: 'reference', mots: ['reference', 'numero', 'num ', 'id'] },
]

/**
 * Devine le rôle de chaque colonne d'après son en-tête.
 *
 * L'ordre d'examen compte : « montant » apparaît dans « montant du débit », donc
 * débit et crédit sont testés en premier. Et « valeur » ne désigne un montant
 * qu'à défaut de mieux, parce que « date de valeur » existe aussi — d'où le test
 * de la date sur les en-têtes qui commencent par « date ».
 */
export function detecterCorrespondance(entete: readonly string[]): Correspondance {
  const pris = new Set<RoleColonne>()
  return entete.map((brut) => {
    const nom = normaliserNom(brut)
    if (nom === '') return 'ignore'
    if (nom.startsWith('date')) {
      if (pris.has('date')) return 'ignore'
      pris.add('date')
      return 'date'
    }
    for (const { role, mots } of INDICES) {
      if (pris.has(role)) continue
      if (mots.some((mot) => nom.includes(mot))) {
        pris.add(role)
        return role
      }
    }
    return 'ignore'
  })
}

/**
 * Vrai si la correspondance permet de lire une opération.
 *
 * Une date et un montant, rien de plus : le libellé est confortable mais pas
 * indispensable, et l'exiger empêcherait d'importer un relevé qui n'en a pas.
 */
export function correspondanceUtilisable(correspondance: readonly RoleColonne[]): boolean {
  const a = (role: RoleColonne) => correspondance.includes(role)
  return a('date') && (a('montant') || a('debit') || a('credit'))
}

/** Nombre de lignes examinées avant de renoncer à trouver un en-tête. */
const PORTEE_ENTETE = 25

export type Entete = { rang: number; correspondance: Correspondance }

/**
 * Cherche la ligne d'en-tête, qui n'est pas toujours la première.
 *
 * Un CSV commence par ses noms de colonnes ; un relevé en PDF commence par le
 * nom de la banque, une adresse, un numéro de compte, et ne nomme ses colonnes
 * qu'au bout de quelques lignes. Ne regarder que la première ligne rendrait
 * tout PDF illisible pour une raison que personne ne pourrait deviner.
 *
 * La première ligne dont les intitulés donnent une correspondance utilisable
 * gagne. Si aucune ne convient, on renvoie la plus large, de sorte que
 * l'utilisateur ait quand même des menus à corriger plutôt qu'un écran vide.
 */
export function detecterEntete(lignes: readonly (readonly string[])[]): Entete {
  const largeur = lignes.length === 0 ? 0 : Math.max(...lignes.map((ligne) => ligne.length))
  const complete = (ligne: readonly string[]) =>
    Array.from({ length: largeur }, (_, rang) => ligne[rang] ?? '')

  for (const [rang, ligne] of lignes.slice(0, PORTEE_ENTETE).entries()) {
    const correspondance = detecterCorrespondance(complete(ligne))
    if (correspondanceUtilisable(correspondance)) return { rang, correspondance }
  }
  return { rang: 0, correspondance: detecterCorrespondance(complete(lignes[0] ?? [])) }
}

// --- Lecture des lignes ---------------------------------------------------------

export type OperationBrute = {
  /** Numéro de ligne dans le fichier, en comptant l'en-tête. Sert aux messages. */
  ligne: number
  date: CivilDate
  /** Signé : négatif = sortie du compte. */
  montant_cents: Cents
  libelle: string
  reference?: string
}

export type RejetLigne = { ligne: number; raison: string }

/**
 * Vrai si la première ligne est un en-tête plutôt qu'une opération.
 *
 * On ne se fie pas aux mots : on regarde si la colonne de date contient une
 * date. Un en-tête n'en contient jamais, une opération toujours — et cette
 * question se pose avant même de savoir comment la banque nomme ses colonnes.
 */
export function premiereLigneEstEntete(
  lignes: readonly (readonly string[])[],
  correspondance?: readonly RoleColonne[],
): boolean {
  const premiere = lignes[0]
  if (!premiere) return false
  const rang = correspondance?.indexOf('date') ?? -1
  if (rang >= 0) return analyserDateReleve(premiere[rang] ?? '') === null
  return premiere.every((champ) => analyserDateReleve(champ) === null)
}

function champ(
  ligne: readonly string[],
  correspondance: readonly RoleColonne[],
  role: RoleColonne,
) {
  const rang = correspondance.indexOf(role)
  return rang >= 0 ? (ligne[rang] ?? '').trim() : ''
}

/**
 * Transforme les lignes du fichier en opérations.
 *
 * Une ligne illisible est **refusée en le disant**, jamais avalée : « ligne 14 :
 * montant illisible (« 12,505 ») » se corrige, « 3 lignes ignorées » ne se
 * corrige pas.
 */
export function lireOperations(
  lignes: readonly (readonly string[])[],
  correspondance: readonly RoleColonne[],
  options: { premiereEstEntete?: boolean; depuis?: number } = {},
): { operations: OperationBrute[]; rejets: RejetLigne[] } {
  // `depuis` l'emporte quand il est donné : un relevé en PDF a des lignes de
  // garde avant son en-tête, et les refuser une à une remplirait la liste des
  // rejets de bruit au milieu duquel une vraie erreur passerait inaperçue.
  const premiereLigne =
    options.depuis ??
    ((options.premiereEstEntete ?? premiereLigneEstEntete(lignes, correspondance)) ? 1 : 0)
  const operations: OperationBrute[] = []
  const rejets: RejetLigne[] = []

  // Le séparateur décimal se décide sur tout le fichier, jamais ligne par ligne :
  // « 1.234 » seul est indécidable, mais un fichier où d'autres lignes finissent
  // par « ,56 » ne l'est plus. Sans cette passe, une ligne à trois décimales
  // passerait pour un montant mille fois trop grand.
  const chiffres: string[] = []
  lignes.forEach((ligne, index) => {
    if (index < premiereLigne) return
    for (const role of ['montant', 'debit', 'credit'] as const) {
      const valeur = champ(ligne, correspondance, role)
      if (valeur !== '') chiffres.push(valeur)
    }
  })
  const decimale = detecterSeparateurDecimal(chiffres) ?? undefined
  const montantDe = (valeur: string) => analyserMontantReleve(valeur, decimale)

  lignes.forEach((ligne, index) => {
    if (index < premiereLigne) return
    const numero = index + 1
    const date = analyserDateReleve(champ(ligne, correspondance, 'date'))
    if (date === null) {
      rejets.push({
        ligne: numero,
        raison: `date illisible (« ${champ(ligne, correspondance, 'date')} »)`,
      })
      return
    }

    let montant: Cents | null = null
    const brutMontant = champ(ligne, correspondance, 'montant')
    if (brutMontant !== '') {
      montant = montantDe(brutMontant)
      if (montant === null) {
        rejets.push({ ligne: numero, raison: `montant illisible (« ${brutMontant} »)` })
        return
      }
    } else {
      // Colonnes séparées : le débit sort, le crédit entre. On force le signe au
      // lieu de le lire — certaines banques écrivent leurs débits en positif,
      // d'autres en négatif, et une colonne nommée « débit » ne peut vouloir
      // dire qu'une chose.
      const debit = montantDe(champ(ligne, correspondance, 'debit'))
      const credit = montantDe(champ(ligne, correspondance, 'credit'))
      if (debit !== null && debit !== 0) montant = cents(-Math.abs(debit))
      else if (credit !== null && credit !== 0) montant = cents(Math.abs(credit))
    }

    if (montant === null || montant === 0) {
      rejets.push({ ligne: numero, raison: 'aucun montant sur cette ligne' })
      return
    }

    const reference = champ(ligne, correspondance, 'reference')
    operations.push({
      ligne: numero,
      date,
      montant_cents: montant,
      libelle: champ(ligne, correspondance, 'libelle').slice(0, 200),
      ...(reference !== '' ? { reference } : {}),
    })
  })

  return { operations, rejets }
}

// --- Empreinte et identifiants ---------------------------------------------------

/** Séparateur d'empreinte : un caractère qu'aucun libellé ne contient. */
const SEP = '\u001f'

/**
 * Empreinte d'une opération.
 *
 * Tout ce qui la compose doit être **le même sur deux appareils et à deux
 * moments** : pas d'identifiant d'appareil, pas d'horodatage, pas de numéro de
 * ligne — la banque peut réexporter la même période dans un autre ordre.
 *
 * Le `rang` est le seul ajout non évident, et il est indispensable : deux cafés
 * à 2,50 € le même jour chez le même commerçant sont deux opérations réelles et
 * indiscernables. Sans lui, la seconde serait prise pour un doublon de la
 * première et disparaîtrait. Il compte les lignes identiques **entre elles**,
 * donc il ne bouge pas si le fichier suivant couvre une période plus large.
 */
export function empreinteOperation(
  compteId: string,
  operation: OperationBrute,
  rang: number,
): string {
  // Une référence bancaire, quand elle existe, identifie l'opération mieux que
  // n'importe quelle empreinte reconstituée.
  if (operation.reference !== undefined && operation.reference !== '') {
    return ['v1', compteId, 'ref', operation.reference].join(SEP)
  }
  return [
    'v1',
    compteId,
    operation.date,
    String(operation.montant_cents),
    normaliserNom(operation.libelle),
    String(rang),
  ].join(SEP)
}

function hexa(octets: Uint8Array): string {
  let texte = ''
  for (const octet of octets) texte += octet.toString(16).padStart(2, '0')
  return texte
}

/**
 * Fabrique les identifiants d'une opération à partir de son empreinte.
 *
 * C'est un **UUID nommé** : la même empreinte donne toujours le même
 * identifiant, sur n'importe quel appareil et à n'importe quelle date. C'est ce
 * qui fait que réimporter le même relevé n'ajoute rien — la fusion par union sur
 * `id` reconnaît l'événement comme déjà connu, exactement comme pour un journal
 * réimporté.
 *
 * Le chiffre de version est celui des UUID nommés ; l'empreinte est un SHA-256
 * tronqué plutôt que le SHA-1 d'origine, parce qu'il est plus sûr et déjà
 * présent partout.
 */
export async function identifiantsOperation(
  empreinte: string,
): Promise<{ idEvenement: string; idTransaction: string }> {
  const condense = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(empreinte)),
  )
  const octets = condense.slice(0, 16)
  octets[6] = (octets[6]! & 0x0f) | 0x50
  octets[8] = (octets[8]! & 0x3f) | 0x80
  const h = hexa(octets)
  return {
    idEvenement: `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`,
    // Lisible dans un export en clair, et dérivé de la même empreinte : on peut
    // relier une transaction à sa ligne de relevé sans rien stocker de plus.
    idTransaction: `csv-${hexa(condense.slice(16, 22))}`,
  }
}

// --- Réconciliations recouvertes --------------------------------------------------

export type ReconciliationCouverte = {
  transaction: Transaction
  /** Début de la période que cet écart résume, ou `null` si elle remonte à l'origine. */
  depuis: CivilDate | null
  /** Vrai si l'import couvre toute la période résumée par cet écart. */
  pleinementCouverte: boolean
}

/**
 * Dernier relevé posé strictement avant un instant donné.
 *
 * « Strictement avant » se lit sur la date **et** sur l'instant : la
 * réconciliation écrit son écart puis son ancre le même jour, et confondre les
 * deux ferait croire que l'écart ne résume rien.
 */
function ancrePrecedente(
  etat: Etat,
  account_id: string,
  date: CivilDate,
  ts: number,
): CivilDate | null {
  let trouvee: { date: CivilDate; ts: number } | null = null
  for (const releve of etat.releves) {
    if (releve.account_id !== account_id) continue
    if (releve.date > date || (releve.date === date && releve.ts >= ts)) continue
    if (
      trouvee === null ||
      releve.date > trouvee.date ||
      (releve.date === trouvee.date && releve.ts > trouvee.ts)
    ) {
      trouvee = { date: releve.date, ts: releve.ts }
    }
  }
  return trouvee?.date ?? null
}

/**
 * Les écarts de réconciliation que l'import ferait compter deux fois.
 *
 * Un écart résume la période qui va du relevé précédent à sa propre date. Si le
 * relevé importé couvre toute cette période, l'écart fait double emploi avec le
 * détail et doit disparaître ; s'il n'en couvre qu'une partie, le supprimer
 * effacerait des dépenses que le fichier ne remplace pas — on le signale alors
 * sans rien décider.
 *
 * Supprimer un écart **ne change pas le solde affiché** : il a été écrit juste
 * avant l'ancre qui l'a suivi, donc il est déjà derrière elle et ne comptait
 * plus. Ce qu'on corrige, ce sont les totaux du mois et la part « Non
 * catégorisé » des dépenses.
 */
export function reconciliationsCouvertes(
  etat: Etat,
  account_id: string,
  debut: CivilDate,
  fin: CivilDate,
): ReconciliationCouverte[] {
  const couvertes: ReconciliationCouverte[] = []
  for (const transaction of etat.transactions.values()) {
    if (transaction.account_id !== account_id) continue
    if (transaction.origine !== 'reconciliation') continue
    if (!estDans(transaction.date, debut, fin)) continue
    const depuis = ancrePrecedente(etat, account_id, transaction.date, transaction.ts)
    couvertes.push({
      transaction,
      depuis,
      // La période résumée s'ouvre au lendemain du relevé précédent : si l'import
      // commence ce jour-là ou avant, il la couvre entièrement.
      pleinementCouverte: depuis !== null && debut <= ajouterJours(depuis, 1),
    })
  }
  return couvertes.sort((a, b) => (a.transaction.date < b.transaction.date ? -1 : 1))
}

// --- Plan d'import ----------------------------------------------------------------

export type OperationPreparee = OperationBrute & {
  idEvenement: string
  idTransaction: string
  /** Déjà dans le journal : cette ligne a déjà été importée. */
  deja: boolean
  /** Antérieure au dernier relevé : elle n'entrera pas dans le solde. */
  sansEffetSurSolde: boolean
  /** Transaction existante de même jour et même montant, saisie autrement. */
  ressemblance?: Transaction
}

export type PlanImport = {
  compteId: string
  debut: CivilDate
  fin: CivilDate
  operations: OperationPreparee[]
  nouvelles: OperationPreparee[]
  deja: OperationPreparee[]
  sansEffetSurSolde: OperationPreparee[]
  ressemblances: OperationPreparee[]
  reconciliations: ReconciliationCouverte[]
  /** Date du dernier relevé du compte : au-dessous, rien ne bouge le solde. */
  ancre: CivilDate | null
}

/**
 * Prépare l'import sans rien écrire.
 *
 * Tout se décide ici, et rien n'est écrit : l'écran peut donc montrer exactement
 * ce qui va se passer avant que l'utilisateur accepte. Un import qui s'exécute
 * d'abord et s'explique ensuite serait irréversible — le journal ne se réécrit
 * pas.
 */
export async function preparerImport(
  etat: Etat,
  journal: readonly Evenement[],
  compteId: string,
  operations: readonly OperationBrute[],
): Promise<PlanImport> {
  const connus = new Set(journal.map((evenement) => evenement.id))
  const ancre = ancreDuCompte(etat, compteId)?.date ?? null

  // Rang d'occurrence : compté par groupe de lignes indiscernables, pour que
  // deux dépenses réellement identiques restent deux dépenses.
  const rangs = new Map<string, number>()
  const preparees: OperationPreparee[] = []

  for (const operation of operations) {
    const cle = [
      operation.date,
      String(operation.montant_cents),
      normaliserNom(operation.libelle),
      operation.reference ?? '',
    ].join(SEP)
    const rang = rangs.get(cle) ?? 0
    rangs.set(cle, rang + 1)

    const { idEvenement, idTransaction } = await identifiantsOperation(
      empreinteOperation(compteId, operation, rang),
    )
    const ressemblance = chercherRessemblance(etat, compteId, operation)
    preparees.push({
      ...operation,
      idEvenement,
      idTransaction,
      deja: connus.has(idEvenement),
      sansEffetSurSolde: ancre !== null && operation.date < ancre,
      ...(ressemblance !== null ? { ressemblance } : {}),
    })
  }

  const dates = preparees.map((operation) => operation.date).sort()
  const debut = dates[0] ?? ('1970-01-01' as CivilDate)
  const fin = dates[dates.length - 1] ?? debut
  const nouvelles = preparees.filter((operation) => !operation.deja)

  return {
    compteId,
    debut,
    fin,
    operations: preparees,
    nouvelles,
    deja: preparees.filter((operation) => operation.deja),
    sansEffetSurSolde: nouvelles.filter((operation) => operation.sansEffetSurSolde),
    ressemblances: nouvelles.filter((operation) => operation.ressemblance !== undefined),
    reconciliations:
      preparees.length === 0 ? [] : reconciliationsCouvertes(etat, compteId, debut, fin),
    ancre,
  }
}

/**
 * Cherche une transaction déjà présente qui pourrait être la même opération.
 *
 * Même compte, même jour, même montant, et **pas déjà venue d'un relevé** : les
 * lignes importées se reconnaissent par leur identifiant, elles n'ont pas besoin
 * de cette heuristique. Celle-ci ne vise que la saisie manuelle et les
 * échéances confirmées, dont le libellé n'a aucune raison de ressembler à celui
 * de la banque.
 */
function chercherRessemblance(
  etat: Etat,
  compteId: string,
  operation: OperationBrute,
): Transaction | null {
  for (const transaction of etat.transactions.values()) {
    if (transaction.account_id !== compteId) continue
    if (transaction.origine === 'csv') continue
    if (transaction.date !== operation.date) continue
    if (transaction.montant_cents !== operation.montant_cents) continue
    return transaction
  }
  return null
}

export type OptionsEcriture = {
  /** Ne pas écrire les lignes qui ressemblent à une saisie déjà présente. */
  ecarterRessemblances?: boolean
  /** Ne pas écrire les lignes antérieures au dernier relevé. */
  ecarterAnterieures?: boolean
  /** Écarts de réconciliation à supprimer, par identifiant de transaction. */
  reconciliationsASupprimer?: readonly string[]
}

/**
 * Traduit le plan en événements.
 *
 * Les suppressions d'écarts viennent **en premier** : elles décrivent l'état
 * qu'on corrige, les lignes importées celui qu'on installe, et un journal se
 * relit mieux dans cet ordre.
 */
export function evenementsImport(plan: PlanImport, options: OptionsEcriture = {}): EntreeJournal[] {
  const entrees: EntreeJournal[] = []

  for (const id of options.reconciliationsASupprimer ?? []) {
    entrees.push({ type: 'transaction.deleted', payload: { id } })
  }

  for (const operation of plan.nouvelles) {
    if (options.ecarterRessemblances === true && operation.ressemblance !== undefined) continue
    if (options.ecarterAnterieures === true && operation.sansEffetSurSolde) continue
    entrees.push({
      // L'identifiant d'événement est celui de l'empreinte : c'est lui qui rend
      // l'import idempotent, ici comme à la fusion entre appareils.
      id: operation.idEvenement,
      type: 'transaction.created',
      payload: {
        id: operation.idTransaction,
        account_id: plan.compteId,
        date: operation.date,
        montant_cents: operation.montant_cents,
        origine: 'csv',
        ...(operation.libelle.trim() !== '' ? { note: operation.libelle.trim() } : {}),
      },
    })
  }

  return entrees
}
