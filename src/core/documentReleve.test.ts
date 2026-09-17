import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lireDocumentReleve } from './documentReleve'
import { dateDepuisSerie, formatEstDate, lireClasseur } from './xlsx'
import { lireClasseurAncien, nombreRK } from './xls'
import { lirePdf } from './pdf'
import { ouvrirArchive, ressembleAUneArchive } from './zip'
import { ressembleAUnConteneur } from './cfb'
import { detecterEntete, evenementsImport, lireOperations, preparerImport } from '../domain/releve'
import { plier } from '../domain/etat'
import { validerEvenement, type Evenement } from '../domain/events'

/**
 * Ces épreuves portent sur de **vrais fichiers**, produits par des outils qui
 * n'ont rien à voir avec ces lecteurs : openpyxl et XlsxWriter pour le
 * `.xlsx`, xlwt pour le `.xls`, ReportLab pour le PDF. C'est le seul moyen de
 * vérifier qu'on lit le format, et non ses propres hypothèses sur le format.
 *
 * Le script qui les fabrique est versionné : `scripts/fixtures/releves.py`.
 */
const lire = (nom: string) => new Uint8Array(readFileSync(`src/core/__fixtures__/${nom}`))

/** Les opérations telles que les outils les ont écrites. La vérité de référence. */
const ATTENDU = [
  { date: '2026-09-01', montant_cents: -250, libelle: 'CB BOULANGERIE' },
  { date: '2026-09-01', montant_cents: -250, libelle: 'CB BOULANGERIE' },
  { date: '2026-09-03', montant_cents: 200000, libelle: 'VIR SALAIRE SEPTEMBRE' },
  { date: '2026-09-05', montant_cents: -78000, libelle: 'PRLV LOYER' },
  { date: '2026-09-08', montant_cents: -4520, libelle: 'CB LECLERC, ROUEN' },
  { date: '2026-09-12', montant_cents: -4000, libelle: 'RETRAIT DAB DÉCEMBRE' },
  { date: '2026-09-14', montant_cents: 14580, libelle: 'VIR REMBOURSEMENT MUTUELLE' },
  { date: '2026-09-15', montant_cents: -123456, libelle: 'PRLV ASSURANCE HABITATION' },
]

/** Le chemin complet d'un import : lecture du fichier, colonnes, opérations. */
async function operationsDe(nom: string) {
  const document = await lireDocumentReleve(lire(nom), nom)
  const grille = document.grilles[0]!
  const { rang, correspondance } = detecterEntete(grille.lignes)
  return {
    document,
    ...lireOperations(grille.lignes, correspondance, { depuis: rang + 1 }),
  }
}

// --- Reconnaissance des formats -------------------------------------------------

describe('reconnaissance du format', () => {
  it('reconnaît chaque format à ses octets, pas à son nom', async () => {
    expect((await lireDocumentReleve(lire('releve.xlsx'), 'peu-importe.txt')).format).toBe('xlsx')
    expect((await lireDocumentReleve(lire('releve.xls'), 'peu-importe.txt')).format).toBe('xls')
    expect((await lireDocumentReleve(lire('releve-banque.pdf'), 'peu-importe.txt')).format).toBe(
      'pdf',
    )
    const csv = new TextEncoder().encode('Date;Libelle;Montant\n01/09/2026;X;-1,00')
    expect((await lireDocumentReleve(csv, 'releve.xls')).format).toBe('csv')
  })

  it('distingue une archive d’un conteneur ancien', () => {
    expect(ressembleAUneArchive(lire('releve.xlsx'))).toBe(true)
    expect(ressembleAUnConteneur(lire('releve.xlsx'))).toBe(false)
    expect(ressembleAUnConteneur(lire('releve.xls'))).toBe(true)
    expect(ressembleAUneArchive(lire('releve.xls'))).toBe(false)
  })

  it('refuse un fichier binaire plutôt que d’en tirer du charabia', async () => {
    // Sans garde-fou, une image « réussirait » à s'ouvrir comme un CSV et
    // rendrait une ligne illisible, sans que rien n'explique pourquoi.
    const image = new Uint8Array(200).map((_, rang) => (rang * 7) % 256)
    await expect(lireDocumentReleve(image, 'photo.png')).rejects.toThrow(/Formats acceptés/)
  })
})

// --- Les trois formats disent la même chose ---------------------------------------

describe('un même relevé, trois formats', () => {
  it('lit le classeur moderne', async () => {
    const { operations, rejets } = await operationsDe('releve.xlsx')
    expect(rejets).toEqual([])
    expect(
      operations.map((o) => ({ date: o.date, montant_cents: o.montant_cents, libelle: o.libelle })),
    ).toEqual(ATTENDU)
  })

  it('lit le classeur d’Excel 97', async () => {
    const { operations, rejets } = await operationsDe('releve.xls')
    expect(rejets).toEqual([])
    expect(
      operations.map((o) => ({ date: o.date, montant_cents: o.montant_cents, libelle: o.libelle })),
    ).toEqual(ATTENDU)
  })

  it('lit le PDF, colonnes débit et crédit comprises', async () => {
    const { operations } = await operationsDe('releve-banque.pdf')
    expect(
      operations.map((o) => ({ date: o.date, montant_cents: o.montant_cents, libelle: o.libelle })),
    ).toEqual(ATTENDU)
  })

  it('lit un classeur en colonnes débit et crédit', async () => {
    const { operations, rejets } = await operationsDe('releve-debit-credit.xlsx')
    expect(rejets).toEqual([])
    expect(operations.map((o) => o.montant_cents)).toEqual(ATTENDU.map((o) => o.montant_cents))
  })

  it('donne les mêmes montants au centime près, quel que soit le format', async () => {
    const formats = ['releve.xlsx', 'releve.xls', 'releve-banque.pdf', 'releve-debit-credit.xlsx']
    const totaux = []
    for (const nom of formats) {
      const { operations } = await operationsDe(nom)
      totaux.push(operations.reduce((somme, operation) => somme + operation.montant_cents, 0))
    }
    // Un écart d'un seul centime entre deux formats voudrait dire qu'un arrondi
    // s'est glissé quelque part, et un arrondi qui apparaît est un arrondi qui
    // se répétera.
    expect(new Set(totaux).size).toBe(1)
    expect(totaux[0]).toBe(ATTENDU.reduce((somme, o) => somme + o.montant_cents, 0))
  })

  it('garde les accents intacts dans les trois formats', async () => {
    for (const nom of ['releve.xlsx', 'releve.xls', 'releve-banque.pdf']) {
      const { operations } = await operationsDe(nom)
      expect(operations.map((o) => o.libelle)).toContain('RETRAIT DAB DÉCEMBRE')
    }
  })
})

describe('le même relevé, importé deux fois sous deux formats', () => {
  /** Écrit le plan dans un journal, comme le ferait le dépôt. */
  function journalDe(entrees: ReturnType<typeof evenementsImport>): Evenement[] {
    return entrees.map((entree, rang) =>
      validerEvenement({
        id: entree.id,
        ts: 1_757_000_000_000 + rang,
        device: 'test',
        type: entree.type,
        payload: entree.payload,
      }),
    )
  }

  const COMPTE = {
    id: 'c1',
    nom: 'Courant',
    type: 'courant',
    groupe: 'bancaire',
    mode: 'saisi',
  } as const

  it('ne duplique rien : l’empreinte vient du contenu, pas du format', async () => {
    // Quelqu'un importe le relevé Excel de son mois, puis reçoit le même relevé
    // en PDF et l'importe aussi. Les deux fichiers n'ont rien de commun dans
    // leurs octets — mais les opérations, si. Aucune ne doit être ajoutée deux
    // fois : c'est exactement la promesse faite pour le CSV, et elle doit tenir
    // d'un format à l'autre.
    const compte = validerEvenement({
      id: '00000000-0000-4000-8000-000000000001',
      ts: 1,
      device: 'test',
      type: 'account.created',
      payload: { ...COMPTE },
    })

    const premier = await operationsDe('releve.xlsx')
    const planXlsx = await preparerImport(plier([compte]), [compte], 'c1', premier.operations)
    expect(planXlsx.nouvelles).toHaveLength(8)

    const journal = [compte, ...journalDe(evenementsImport(planXlsx))]
    const second = await operationsDe('releve-banque.pdf')
    const planPdf = await preparerImport(plier(journal), journal, 'c1', second.operations)

    expect(planPdf.deja).toHaveLength(8)
    expect(planPdf.nouvelles).toHaveLength(0)
  })

  it('ne duplique pas davantage entre les deux formats de classeur', async () => {
    const compte = validerEvenement({
      id: '00000000-0000-4000-8000-000000000002',
      ts: 1,
      device: 'test',
      type: 'account.created',
      payload: { ...COMPTE },
    })
    const moderne = await operationsDe('releve.xlsx')
    const plan = await preparerImport(plier([compte]), [compte], 'c1', moderne.operations)
    const journal = [compte, ...journalDe(evenementsImport(plan))]

    const ancien = await operationsDe('releve.xls')
    const suivant = await preparerImport(plier(journal), journal, 'c1', ancien.operations)
    expect(suivant.nouvelles).toHaveLength(0)
  })
})

// --- Classeurs -----------------------------------------------------------------

describe('classeurs', () => {
  it('rend toutes les feuilles, dans l’ordre du classeur', async () => {
    const feuilles = await lireClasseur(lire('releve.xlsx'))
    expect(feuilles.map((feuille) => feuille.nom)).toEqual(['Operations', 'Notes'])
    expect(feuilles[1]!.lignes).toEqual([['Ceci', 'ne doit pas', 'etre importe']])
  })

  it('convertit les dates, qui ne sont que des nombres dans le fichier', async () => {
    const feuilles = await lireClasseur(lire('releve.xlsx'))
    expect(feuilles[0]!.lignes[1]![0]).toBe('01/09/2026')
  })

  it('rend les nombres tels qu’ils sont écrits, sans arrondi de passage', async () => {
    const feuilles = await lireClasseur(lire('releve.xlsx'))
    expect(feuilles[0]!.lignes[8]![2]).toBe('-1234.56')
  })

  it('lit le même contenu depuis le format binaire de 1997', () => {
    const feuilles = lireClasseurAncien(lire('releve.xls'))
    expect(feuilles[0]!.nom).toBe('Operations')
    expect(feuilles[0]!.lignes[1]).toEqual(['01/09/2026', 'CB BOULANGERIE', '-2.5'])
    expect(feuilles[0]!.lignes[8]![2]).toBe('-1234.56')
  })

  it('lit un classeur dont les libellés sont rangés dans une table commune', async () => {
    // Excel n'écrit pas le texte dans la cellule : il range les libellés à part
    // et n'y met qu'un renvoi. Sans épreuve sur un fichier écrit ainsi, tout ce
    // chemin — la moitié des classeurs du monde — resterait non vérifié.
    const feuilles = await lireClasseur(lire('releve-partage.xlsx'))
    expect(feuilles[0]!.lignes[0]).toEqual(['Date operation', 'Libelle', 'Montant'])
    expect(feuilles[0]!.lignes[1]).toEqual(['01/09/2026', 'CB BOULANGERIE', '-2.5'])
    expect(feuilles[0]!.lignes[6]![1]).toBe('RETRAIT DAB DÉCEMBRE')
  })

  it('rend le résultat d’une formule, jamais la formule elle-même', () => {
    // Une banque calcule parfois un total dans une colonne. Lire « SUM(C2:C9) »
    // à la place de « 41.04 » ne lèverait rien : la ligne serait simplement
    // refusée plus loin, pour une raison incompréhensible.
    return lireClasseur(lire('releve-partage.xlsx')).then((feuilles) => {
      const total = feuilles[0]!.lignes[9]!
      expect(total[1]).toBe('TOTAL')
      expect(total[2]).toBe('41.04')
    })
  })

  it('recolle une table de textes qui déborde sur des continuations', () => {
    // Un enregistrement du format de 1997 ne dépasse pas 8 224 octets : au-delà,
    // la table des libellés se poursuit ailleurs, et **chaque suite recommence
    // par son propre octet d'encodage**. Un texte coupé au mauvais endroit
    // décale tout ce qui suit — quatre cents libellés, ici, pour l'atteindre.
    const feuilles = lireClasseurAncien(lire('releve-long.xls'))
    const lignes = feuilles[0]!.lignes
    expect(lignes).toHaveLength(401)
    expect(lignes[1]![1]).toBe('OPERATION NUMERO 0001 CHEZ UN COMMERCANT AU NOM TRES LONG')
    // Une ligne accentuée bien après la première coupure : c'est elle qui dit
    // si l'octet d'encodage a été relu au bon endroit.
    expect(lignes[399]![1]).toBe(
      'OPERATION NUMERO 0399 CHEZ UN COMMERCANT AU NOM TRES LONG RETRAIT DÉCEMBRE ŒUVRE',
    )
    expect(lignes[400]![1]).toBe('OPERATION NUMERO 0400 CHEZ UN COMMERCANT AU NOM TRES LONG')
    // Et aucun libellé ne doit s'être mélangé avec son voisin.
    const distincts = new Set(lignes.slice(1).map((ligne) => ligne[1]))
    expect(distincts.size).toBe(400)
  })

  it('refuse une entrée qui annonce une taille démesurée', async () => {
    // Une archive de quelques octets peut en annoncer plusieurs gigas une fois
    // dépliée. Le fichier vient d'ailleurs que de cette application : il n'a
    // aucune raison d'être honnête, et le lecteur ne doit pas le croire.
    const nom = new TextEncoder().encode('gros.bin')
    const contenu = new TextEncoder().encode('court')
    const octets = new Uint8Array(30 + nom.length + contenu.length + 46 + nom.length + 22)
    const vue = new DataView(octets.buffer)
    let p = 0

    vue.setUint32(p, 0x04034b50, true) // en-tête local
    vue.setUint16(p + 8, 0, true) // stocké, sans compression
    vue.setUint32(p + 18, contenu.length, true)
    vue.setUint32(p + 22, 0x7fffffff, true) // taille réelle : mensongère
    vue.setUint16(p + 26, nom.length, true)
    octets.set(nom, p + 30)
    octets.set(contenu, p + 30 + nom.length)
    p += 30 + nom.length + contenu.length

    const debutCatalogue = p
    vue.setUint32(p, 0x02014b50, true) // catalogue
    vue.setUint16(p + 10, 0, true)
    vue.setUint32(p + 20, contenu.length, true)
    vue.setUint32(p + 24, 0x7fffffff, true) // la même taille mensongère
    vue.setUint16(p + 28, nom.length, true)
    vue.setUint32(p + 42, 0, true)
    octets.set(nom, p + 46)
    p += 46 + nom.length

    vue.setUint32(p, 0x06054b50, true) // fin de catalogue
    vue.setUint16(p + 10, 1, true)
    vue.setUint32(p + 16, debutCatalogue, true)

    const archive = await ouvrirArchive(octets)
    expect(archive.noms).toEqual(['gros.bin'])
    await expect(archive.lire('gros.bin')).rejects.toThrow(/démesurée/)
  })

  it('refuse une archive qui n’est pas un classeur, en disant quoi faire', async () => {
    // Une archive ZIP valide, mais sans classeur dedans.
    const archive = await ouvrirArchive(lire('releve.xlsx'))
    expect(archive.noms).toContain('xl/workbook.xml')
    await expect(
      lireClasseur(new Uint8Array([0x50, 0x4b, 5, 6, ...Array.from({ length: 18 }, () => 0)])),
    ).rejects.toThrow(/classeur/)
  })
})

// --- Les pièges des tableurs ----------------------------------------------------

describe('dates et nombres des tableurs', () => {
  it('compense le 29 février 1900 qu’Excel croit exister', () => {
    // 60 est le jour fantôme ; 61 est le 1er mars 1900, et tout ce qui suit en
    // dépend. Une erreur d'un jour ici décale toutes les dates du fichier.
    expect(dateDepuisSerie(59)).toBe('28/02/1900')
    expect(dateDepuisSerie(61)).toBe('01/03/1900')
    expect(dateDepuisSerie(25569)).toBe('01/01/1970')
    expect(dateDepuisSerie(46266)).toBe('01/09/2026')
  })

  it('lit aussi le calendrier d’Excel pour Mac', () => {
    expect(dateDepuisSerie(0, true)).toBe('01/01/1904')
    expect(dateDepuisSerie(44804, true)).toBe('01/09/2026')
  })

  it('reconnaît un format de date sans se laisser prendre par un texte entre guillemets', () => {
    expect(formatEstDate('DD/MM/YYYY')).toBe(true)
    expect(formatEstDate('yyyy-mm-dd')).toBe(true)
    expect(formatEstDate('#,##0.00')).toBe(false)
    // Un « m » dans un libellé n'est pas un mois.
    expect(formatEstDate('#,##0.00 "mois"')).toBe(false)
    expect(formatEstDate('[$€-40C]#,##0.00')).toBe(false)
  })

  it('décode les quatre formes d’un nombre compressé', () => {
    // Entier, entier au centième, flottant, flottant au centième : les quatre
    // cohabitent dans un même fichier, et confondre deux branches fait cent fois.
    expect(nombreRK((100 << 2) | 0x02)).toBe(100)
    expect(nombreRK(((12345 << 2) | 0x03) >>> 0)).toBeCloseTo(123.45, 10)
    expect(nombreRK((-250 << 2) | 0x02)).toBe(-250)
    expect(nombreRK(0x3ff00000)).toBe(1)
    expect(nombreRK(0x3ff00001)).toBeCloseTo(0.01, 12)
  })
})

// --- PDF -----------------------------------------------------------------------

describe('PDF', () => {
  it('retrouve quatre colonnes là où le fichier n’en décrit aucune', async () => {
    const { lignes, pages } = await lirePdf(lire('releve-banque.pdf'))
    expect(pages).toBe(1)
    const entete = lignes.find((ligne) => ligne[0] === 'Date')
    expect(entete).toEqual(['Date', 'Libellé', 'Débit', 'Crédit'])
  })

  it('ne laisse pas le titre et le pied de page souder les colonnes', async () => {
    // « BANQUE DE L’OUEST » et « SOLDE AU… » traversent la largeur de la page :
    // une détection par blancs absolus perdrait la colonne des dates.
    const { lignes } = await lirePdf(lire('releve-banque.pdf'))
    const operation = lignes.find((ligne) => ligne[0] === '01/09/2026')
    expect(operation).toEqual(['01/09/2026', 'CB BOULANGERIE', '2,50', ''])
  })

  it('décode les accents et la typographie de la page', async () => {
    const { lignes } = await lirePdf(lire('releve-banque.pdf'))
    const tout = lignes.flat().join(' ')
    expect(tout).toContain('BANQUE DE L’OUEST')
    expect(tout).toContain('Relevé de compte n° 0123456789 — septembre 2026')
  })

  it('refuse un PDF sans texte en expliquant pourquoi', async () => {
    // Un PDF valide dont la page ne porte aucun texte : c'est la forme d'un
    // relevé scanné, et dire « illisible » n'aiderait personne.
    const vide = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj\n<< /Type /Page /Contents 2 0 R >>\nendobj\n' +
        '2 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
    )
    await expect(lireDocumentReleve(vide, 'scan.pdf')).rejects.toThrow(/scanné|image/)
  })

  it('rejette la ligne de solde, qui n’est pas une opération', async () => {
    const { rejets } = await operationsDe('releve-banque.pdf')
    expect(rejets.some((rejet) => /SOLDE/.test(rejet.raison))).toBe(true)
  })
})
