/**
 * Résumer un libellé de banque.
 *
 * Une banque ne décrit pas une opération, elle **concatène des champs** :
 *
 *     PRELEVEMENT PAYPAL EUROPE S.A.R.L. ET CIE S.C.A DU 04/09/26 - EMETTEUR :
 *     LU96ZZZ00000000000000058 MDT - MOTIF : 1052796022080 - REF :
 *     1052796022080 LIB
 *
 * Deux cent dix caractères pour dire « Prélèvement PayPal ». Dans une liste de
 * mouvements, cela ne se lit pas : chaque ligne occupe un écran, et le montant
 * — la seule chose qu'on cherchait — disparaît dans la masse.
 *
 * **Le texte d'origine n'est jamais perdu.** Le journal garde ce que la banque a
 * écrit, mot pour mot, et l'écran du mouvement le montre en entier. Ce module
 * ne sert qu'à l'affichage en liste : une règle de présentation, pas une
 * réécriture. C'est ce qui permet de l'améliorer plus tard sans avoir à
 * retoucher un seul événement, et c'est aussi pourquoi l'empreinte qui
 * reconnaît les doublons continue de porter sur le texte brut.
 *
 * ## Pourquoi des règles et non un modèle de langage
 *
 * La question s'est posée d'embarquer une petite intelligence artificielle
 * locale. Elle ne se justifie pas ici, et pour trois raisons qui tiennent :
 *
 * - **La taille.** Le plus petit modèle utilisable pèse quelques centaines de
 *   méga-octets, contre six cents kilo-octets pour toute l'application. Sur un
 *   téléphone, installée pour fonctionner hors ligne, la proportion est absurde.
 * - **Le réseau.** Les poids se téléchargent depuis un service tiers. Cette
 *   application ne parle à personne, et la politique de sécurité du contenu
 *   l'interdit — l'ouvrir pour cela reviendrait à laisser une trace à chaque
 *   ouverture, pour du confort d'affichage.
 * - **La justesse.** Un modèle de langage produit un texte *plausible*. Sur un
 *   nom de commerçant, plausible n'est pas juste : il écrirait parfois un nom
 *   voisin, et rien ne le signalerait. Ici, ce qui est retiré est toujours une
 *   suite reconnaissable — une référence, un mandat, un IBAN, une date déjà
 *   affichée à côté — et ce qui reste n'est jamais inventé.
 *
 * Il reste une place pour un peu d'apprentissage local, mais ailleurs : deviner
 * le **poste de dépense** d'une opération, où une erreur se corrige d'un geste
 * et ne réécrit rien. Ce n'est pas ce que fait ce module.
 */

/**
 * Les champs techniques que les banques accolent au libellé.
 *
 * Chacun introduit une valeur qui ne dit rien à un humain : un identifiant de
 * créancier, une référence de mandat, un numéro de remise. Le seul qui porte
 * parfois du sens est `MOTIF`, d'où son traitement à part.
 */
const CLES =
  /\b(MOTIF|MOTIFS|LIB|LIBELLE|REF|REFERENCE|RÉF|RÉFÉRENCE|EMETTEUR|ÉMETTEUR|BENEFICIAIRE|BÉNÉFICIAIRE|DONNEUR D'ORDRE|MANDAT|MDT|RUM|ICS|ID CREANCIER|IDENTIFIANT|NUM|NUMERO|N°)\s*:/gi

/** Nature de l'opération, telle qu'on veut la lire — accentuée, en français. */
const NATURES: [RegExp, string][] = [
  [/^PRE?LE?VE?MENTS?\b/i, 'Prélèvement'],
  [/^PRLV\b/i, 'Prélèvement'],
  [/^VIREMENTS?\b/i, 'Virement'],
  [/^VIR\b/i, 'Virement'],
  [/^RETRAITS?\b/i, 'Retrait'],
  [/^(PAIEMENT (PAR )?)?CARTE\b/i, 'Carte'],
  [/^CB\b/i, 'Carte'],
  [/^CHE?QUES?\b/i, 'Chèque'],
  [/^COTISATIONS?\b/i, 'Cotisation'],
  [/^FACTURES?\b/i, 'Facture'],
  [/^ACHATS?\b/i, 'Achat'],
  [/^REMISES?\b/i, 'Remise'],
  [/^ECHEANCES?\b/i, 'Échéance'],
  [/^AVOIRS?\b/i, 'Avoir'],
  [/^FRAIS\b/i, 'Frais'],
  [/^ABONNEMENTS?\b/i, 'Abonnement'],
]

/**
 * Mots de liaison bancaires, retirés seulement en tête.
 *
 * « Virement instantané reçu de » ne dit rien de plus que « Virement » : ce qui
 * compte vient après. Ils ne sont retirés qu'au début, parce que « de » ou
 * « au » au milieu d'un nom — « Banque de France » — sont le nom lui-même.
 *
 * « A » n'y figure pas, et c'est délibéré : dans « virement à Durandel » c'est
 * une liaison, mais dans « virement A Durandel » c'est l'initiale d'un prénom.
 * Rien ne permet de les distinguer, et retirer l'initiale de quelqu'un est une
 * perte d'information là où la garder ne coûte qu'une lettre.
 */
const LIAISONS =
  /^(INSTANTANE|INSTANTANÉ|SEPA|RECU|REÇU|RECUS|EMIS|ÉMIS|PERMANENT|UNIQUE|EUROPEEN|EUROPÉEN|WEB|INTERNET|EN VOTRE FAVEUR|EN FAVEUR DE|AU PROFIT DE|DE|DU|DES|PAR|POUR|VERS)\b\s*/i

/** Civilités : elles n'identifient personne. */
const CIVILITES = /\b(M OU MME|MR OU MME|MME OU M|MONSIEUR|MADAME|MLLE|MME|MR|M\.)\b\s*/gi

/**
 * Formes juridiques : « Orange » se lit mieux que « Orange SA ».
 *
 * Le point final fait partie de la forme, sinon « S.A.R.L. » laisse un point
 * orphelin au milieu du libellé. Et la suite ne doit pas être une lettre :
 * autrement « SALAIRE » perdrait son « SA ».
 */
const FORMES =
  /\b(S\.?A\.?R\.?L|S\.?A\.?S\.?U?|S\.?C\.?A|S\.?N\.?C|S\.?C\.?I|E\.?U\.?R\.?L|S\.?A|GMBH|LTD|INC|ET CIE|& CIE)\.?(?!\p{L})/giu

/** Une date déjà affichée dans la colonne d'à côté n'a pas à figurer deux fois. */
const DATE_REPETEE = /\bDU\s+\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/gi
const DATE_COMPACTE = /\bDU\s+\d{6,8}\b/gi

/** Le montant, que certains relevés répètent à la fin du libellé. */
const MONTANT_FINAL = /\s[-+−]?\d[\d\s ]*,\d{2}\s*(?:€|EUR)?\s*$/i

/**
 * Le numéro de carte que les banques accolent au paiement.
 *
 * « CB LECLERC ROUEN CARTE 4979 » : les quatre chiffres sont ceux de la carte,
 * pas du commerçant. Ils sont trop courts pour tomber sous la règle des longues
 * suites, et ne disent rien à quelqu'un qui n'a qu'une carte.
 */
const NUMERO_DE_CARTE = /\b(?:CARTE|CB|N°\s*CARTE)\s*(?:N°\s*)?\d{4}\b\s*$/i

/** Identifiants : IBAN, identifiant de créancier, longues suites de chiffres. */
const IDENTIFIANTS = /\b(?=[A-Z0-9]*\d)[A-Z]{2}[A-Z0-9]{8,}\b|\b\d{6,}\b/g

/** Tout ce qui, une fois nettoyé, ne porte aucune information. */
const SANS_INFORMATION = /^[\s\-–—:;,./*·]*$/

function compacter(texte: string): string {
  return texte
    .replace(/[\s ]+/g, ' ')
    .replace(/\s*[-–—]\s*$/, '')
    .replace(/^\s*[-–—:]\s*/, '')
    .trim()
}

/**
 * Met en forme un libellé crié en majuscules.
 *
 * Les sigles restent tels quels : dans un relevé, `EDF`, `CAF`, `RATP` ou
 * `SNCF` se lisent lettre à lettre, et les écrire « Edf » les rendrait
 * méconnaissables. Partout ailleurs la majuscule initiale suffit — au pire on
 * écrit « Paypal » là où la marque met un P, ce qui se lit très bien.
 *
 * Les mots grammaticaux courts font exception : « DES » n'est pas un sigle, et
 * « Caisse DES Depots » se lit plus mal que l'original.
 */
const MOTS_DE_LIAISON = new Set([
  'DE',
  'DU',
  'DES',
  'LE',
  'LA',
  'LES',
  'ET',
  'EN',
  'AU',
  'AUX',
  'SUR',
  'PAR',
  'POUR',
  'CHEZ',
])

const VOYELLES = /[AEIOUYÀÂÄÉÈÊËÎÏÔÖÙÛÜ]/gu

/**
 * Vrai si le mot a l'allure d'un sigle.
 *
 * Court, et pauvre en voyelles : `SNCF`, `RATP`, `EDF`, `CPAM`, `FNAC` se
 * prononcent lettre à lettre et se reconnaissent à leur consonnes serrées.
 * `FREE` ou `IKEA`, aussi courts, en ont trop pour en être — ce sont des mots,
 * et « Free » se lit mieux que « FREE » au milieu d'une phrase.
 *
 * C'est une approximation, et elle se trompera : `AXA` deviendra « Axa ». Le
 * coût d'une erreur est une majuscule de trop ou de moins, jamais un chiffre
 * faux — c'est pourquoi on peut se permettre une règle aussi simple.
 */
function ressembleAUnSigle(mot: string): boolean {
  if (mot.length > 4) return false
  const voyelles = (mot.match(VOYELLES) ?? []).length
  return voyelles / mot.length < 0.5
}

export function casseLisible(texte: string): string {
  if (texte !== texte.toUpperCase()) return texte
  return texte.replace(/[\p{L}][\p{L}'’-]*/gu, (mot) => {
    if (MOTS_DE_LIAISON.has(mot)) return mot.toLowerCase()
    if (ressembleAUnSigle(mot)) return mot
    return mot[0] + mot.slice(1).toLowerCase()
  })
}

/** Découpe le libellé en tête et en champs nommés. */
function decouper(brut: string): { tete: string; motif: string } {
  CLES.lastIndex = 0
  const positions: { debut: number; finCle: number; cle: string }[] = []
  let trouve: RegExpExecArray | null
  while ((trouve = CLES.exec(brut)) !== null) {
    positions.push({ debut: trouve.index, finCle: CLES.lastIndex, cle: trouve[1]!.toUpperCase() })
  }
  if (positions.length === 0) return { tete: brut, motif: '' }

  const tete = brut.slice(0, positions[0]!.debut)
  let motif = ''
  for (const [rang, position] of positions.entries()) {
    const fin = positions[rang + 1]?.debut ?? brut.length
    if (position.cle.startsWith('MOTIF') && motif === '') {
      motif = brut.slice(position.finCle, fin)
    }
  }
  return { tete, motif }
}

/** Retire tout ce qui n'apprend rien, et rend la nature reconnue s'il y en a une. */
function degager(texte: string): { nature: string | null; reste: string } {
  let travail = texte
    .replace(MONTANT_FINAL, '')
    .replace(NUMERO_DE_CARTE, ' ')
    .replace(DATE_REPETEE, ' ')
    .replace(DATE_COMPACTE, ' ')
    .replace(IDENTIFIANTS, ' ')
    .replace(FORMES, ' ')
    .replace(CIVILITES, ' ')
  travail = compacter(travail)

  let nature: string | null = null
  for (const [motif, nom] of NATURES) {
    if (motif.test(travail)) {
      nature = nom
      travail = compacter(travail.replace(motif, ''))
      break
    }
  }

  // Les liaisons se retirent une à une, tant que le début en porte.
  for (let passe = 0; passe < 6; passe++) {
    const apres = compacter(travail.replace(LIAISONS, ''))
    if (apres === travail) break
    travail = apres
  }

  return { nature, reste: compacter(travail) }
}

/** Vrai si le texte contient au moins un mot qui désigne quelque chose. */
function porteUnSens(texte: string): boolean {
  return /[\p{L}]{3,}/u.test(texte)
}

/** Longueur au-delà de laquelle une liste redevient illisible. */
const LONGUEUR_MAXIMALE = 64

/**
 * Rend la version courte d'un libellé de banque.
 *
 * La tête du libellé est privilégiée — c'est là qu'une banque met la nature et
 * le commerçant. Le `MOTIF` ne prend le relais que lorsque la tête ne dit rien :
 * « MOTIF : NAVIGO ANNUEL - REF : 3 » n'a pas d'autre information que son motif.
 *
 * En cas de doute, **le texte d'origine est rendu tel quel**, simplement
 * raccourci. Mieux vaut un libellé long qu'un libellé faux : le premier se lit
 * mal, le second fait croire à autre chose.
 */
export function resumerLibelleBancaire(brut: string): string {
  const source = compacter(brut)
  if (source === '') return ''

  const { tete, motif } = decouper(source)
  const principal = degager(tete)
  const secondaire = degager(motif)

  let corps = principal.reste
  if (!porteUnSens(corps) && porteUnSens(secondaire.reste)) corps = secondaire.reste

  const nature = principal.nature ?? secondaire.nature
  // La casse se décide sur le corps seul : la nature est déjà écrite comme on
  // veut la lire, et la lui appliquer la laisserait telle quelle de toute façon
  // — mais son accent suffirait à faire croire à un texte déjà en casse mixte,
  // et le corps ne serait jamais traité.
  const assemble = compacter(`${nature ?? ''} ${casseLisible(corps)}`)

  // Rien de reconnaissable n'a été retenu : on rend l'original plutôt que de
  // présenter une ligne vide ou un mot isolé qui ne désigne rien.
  const resultat = SANS_INFORMATION.test(assemble) || !porteUnSens(assemble) ? source : assemble

  return resultat.length > LONGUEUR_MAXIMALE
    ? `${resultat.slice(0, LONGUEUR_MAXIMALE - 1).trimEnd()}…`
    : resultat
}

/** Vrai si le résumé apporte quelque chose : inutile de montrer deux fois le même texte. */
export function libelleRaccourci(brut: string): boolean {
  return resumerLibelleBancaire(brut) !== compacter(brut)
}
