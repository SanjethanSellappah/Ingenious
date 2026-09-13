import { describe, expect, it } from 'vitest'
import { dateCivile } from '../core/civilDate'
import { analyserCsv } from '../core/csv'
import { cents, type Cents } from '../core/money'
import { plier, type Etat } from './etat'
import { validerEvenement, type Evenement, type TypeEvenement } from './events'
import {
  analyserDateReleve,
  analyserMontantReleve,
  correspondanceUtilisable,
  detecterCorrespondance,
  detecterSeparateurDecimal,
  empreinteOperation,
  evenementsImport,
  identifiantsOperation,
  lireOperations,
  preparerImport,
  premiereLigneEstEntete,
  reconciliationsCouvertes,
  type OperationBrute,
} from './releve'

const d = dateCivile
const e = (euros: number): Cents => cents(Math.round(euros * 100))

let horloge = 1_757_000_000_000
let sequence = 0

function ev(type: TypeEvenement, payload: Record<string, unknown>, ts?: number): Evenement {
  sequence += 1
  return validerEvenement({
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    ts: ts ?? horloge++,
    device: 'test',
    type,
    payload,
  })
}

const COMPTE = {
  id: 'c1',
  nom: 'Courant',
  type: 'courant',
  groupe: 'bancaire',
  mode: 'saisi',
} as const

// --- Dates ------------------------------------------------------------------

describe('lecture des dates', () => {
  it('lit le format français', () => {
    expect(analyserDateReleve('12/09/2025')).toBe('2025-09-12')
    expect(analyserDateReleve('05.03.2026')).toBe('2026-03-05')
    expect(analyserDateReleve('5-3-2026')).toBe('2026-03-05')
  })

  it('lit l’ISO, y compris en tête d’un horodatage', () => {
    expect(analyserDateReleve('2025-09-12')).toBe('2025-09-12')
    expect(analyserDateReleve('2025-09-12T14:32:00Z')).toBe('2025-09-12')
  })

  it('complète une année sur deux chiffres', () => {
    expect(analyserDateReleve('12/09/25')).toBe('2025-09-12')
    expect(analyserDateReleve('12/09/99')).toBe('1999-09-12')
  })

  it('refuse une date qui n’existe pas plutôt que de la glisser au mois suivant', () => {
    expect(analyserDateReleve('31/04/2025')).toBeNull()
    expect(analyserDateReleve('29/02/2025')).toBeNull()
    expect(analyserDateReleve('29/02/2024')).toBe('2024-02-29')
  })

  it('refuse ce qui n’est pas une date', () => {
    expect(analyserDateReleve('Date operation')).toBeNull()
    expect(analyserDateReleve('')).toBeNull()
  })
})

// --- Montants ---------------------------------------------------------------

describe('lecture des montants', () => {
  it('lit les écritures françaises', () => {
    expect(analyserMontantReleve('-45,20')).toBe(-4520)
    expect(analyserMontantReleve('1 234,56')).toBe(123456)
    expect(analyserMontantReleve('1.234,56')).toBe(123456)
    expect(analyserMontantReleve('2 000,00 EUR')).toBe(200000)
  })

  it('lit les écritures anglaises', () => {
    expect(analyserMontantReleve('1,234.56')).toBe(123456)
    expect(analyserMontantReleve('-2.50')).toBe(-250)
  })

  it('lit un signe posé après le nombre, ou des parenthèses', () => {
    expect(analyserMontantReleve('12,50-')).toBe(-1250)
    expect(analyserMontantReleve('(12,50)')).toBe(-1250)
    expect(analyserMontantReleve('+12,50')).toBe(1250)
  })

  it('lit un nombre sans séparateur', () => {
    expect(analyserMontantReleve('1 234')).toBe(123400)
    expect(analyserMontantReleve('780')).toBe(78000)
  })

  it('refuse un séparateur ambigu plutôt que de risquer un facteur mille', () => {
    // « 1.234 » vaut 1 234,00 € dans un fichier français et 1,234 € dans un
    // fichier anglais : seul le fichier entier peut trancher.
    expect(analyserMontantReleve('1.234')).toBeNull()
    expect(analyserMontantReleve('1,234')).toBeNull()
  })

  it('lève l’ambiguïté quand on lui donne le séparateur décimal du fichier', () => {
    expect(analyserMontantReleve('1.234', ',')).toBe(123400)
    expect(analyserMontantReleve('1,234', '.')).toBe(123400)
    expect(analyserMontantReleve('1.234,56', ',')).toBe(123456)
    expect(analyserMontantReleve('1,234.56', '.')).toBe(123456)
    // Trois décimales restent trois décimales, séparateur connu ou non.
    expect(analyserMontantReleve('12,505', ',')).toBeNull()
  })

  it('déduit le séparateur décimal d’une colonne', () => {
    expect(detecterSeparateurDecimal(['-45,20', '2 000,00', '1.234'])).toBe(',')
    expect(detecterSeparateurDecimal(['-45.20', '2,000.00'])).toBe('.')
    expect(detecterSeparateurDecimal(['780', '1200'])).toBeNull()
  })

  it('refuse un montant à trois décimales plutôt que de le tronquer', () => {
    // Tronquer en silence, c'est perdre de l'argent sans le dire.
    expect(analyserMontantReleve('12,505')).toBeNull()
    expect(analyserMontantReleve('12,5055')).toBeNull()
  })

  it('refuse un groupement de milliers incohérent', () => {
    expect(analyserMontantReleve('1.23.456,00')).toBeNull()
  })

  it('refuse ce qui n’est pas un montant', () => {
    expect(analyserMontantReleve('')).toBeNull()
    expect(analyserMontantReleve('Montant')).toBeNull()
    expect(analyserMontantReleve('-')).toBeNull()
  })
})

// --- Colonnes ----------------------------------------------------------------

describe('détection des colonnes', () => {
  it('reconnaît un en-tête bancaire français', () => {
    const detectee = detecterCorrespondance(['Date operation', 'Libelle', 'Montant', 'Devise'])
    expect(detectee).toEqual(['date', 'libelle', 'montant', 'ignore'])
    expect(correspondanceUtilisable(detectee)).toBe(true)
  })

  it('ne prend pas « date de valeur » pour un montant', () => {
    // « valeur » désigne un montant ailleurs ; ici c'est une date.
    const detectee = detecterCorrespondance([
      'Date comptable',
      'Date de valeur',
      'Libelle',
      'Montant',
    ])
    expect(detectee[1]).not.toBe('montant')
    expect(detectee[3]).toBe('montant')
  })

  it('reconnaît des colonnes débit et crédit séparées', () => {
    const detectee = detecterCorrespondance(['Date', 'Nature', 'Debit', 'Credit'])
    expect(detectee).toEqual(['date', 'libelle', 'debit', 'credit'])
    expect(correspondanceUtilisable(detectee)).toBe(true)
  })

  it('refuse une correspondance sans date ni montant', () => {
    expect(correspondanceUtilisable(['libelle', 'ignore'])).toBe(false)
    expect(correspondanceUtilisable(['date', 'libelle'])).toBe(false)
  })

  it('repère l’en-tête en regardant si la colonne de date contient une date', () => {
    const lignes = [
      ['Date', 'Libelle', 'Montant'],
      ['12/09/2025', 'LOYER', '-780,00'],
    ]
    expect(premiereLigneEstEntete(lignes, ['date', 'libelle', 'montant'])).toBe(true)
    expect(premiereLigneEstEntete(lignes.slice(1), ['date', 'libelle', 'montant'])).toBe(false)
  })
})

// --- Lecture des lignes --------------------------------------------------------

const FICHIER = [
  'Date;Libelle;Montant',
  '01/09/2025;CB BOULANGERIE;-2,50',
  '01/09/2025;CB BOULANGERIE;-2,50',
  '03/09/2025;VIR SALAIRE;2 000,00',
  '05/09/2025;PRLV LOYER;-780,00',
].join('\n')

function lireFichier(texte = FICHIER): OperationBrute[] {
  const { lignes } = analyserCsv(texte)
  const correspondance = detecterCorrespondance(lignes[0]!)
  const { operations, rejets } = lireOperations(lignes, correspondance)
  expect(rejets).toEqual([])
  return operations
}

describe('lecture des lignes', () => {
  it('lit un relevé simple', () => {
    const operations = lireFichier()
    expect(operations).toHaveLength(4)
    expect(operations[2]).toMatchObject({
      date: '2025-09-03',
      montant_cents: 200000,
      libelle: 'VIR SALAIRE',
    })
  })

  it('force le signe d’après la colonne, débit ou crédit', () => {
    // Certaines banques écrivent leurs débits en positif : une colonne nommée
    // « débit » ne peut vouloir dire qu'une chose.
    const texte = [
      'Date;Nature;Debit;Credit',
      '01/09/2025;LOYER;780,00;',
      '03/09/2025;SALAIRE;;2000,00',
      '04/09/2025;FRAIS;-12,00;',
    ].join('\n')
    const { lignes } = analyserCsv(texte)
    const { operations } = lireOperations(lignes, detecterCorrespondance(lignes[0]!))
    expect(operations.map((o) => o.montant_cents)).toEqual([-78000, 200000, -1200])
  })

  it('nomme la ligne et la raison de chaque refus', () => {
    const texte = [
      'Date;Libelle;Montant',
      '01/09/2025;OK;-2,50',
      'pas une date;CASSE;-1,00',
      '02/09/2025;CASSE;12,505',
      '03/09/2025;VIDE;',
    ].join('\n')
    const { lignes } = analyserCsv(texte)
    const { operations, rejets } = lireOperations(lignes, detecterCorrespondance(lignes[0]!))
    expect(operations).toHaveLength(1)
    expect(rejets).toEqual([
      { ligne: 3, raison: 'date illisible (« pas une date »)' },
      { ligne: 4, raison: 'montant illisible (« 12,505 »)' },
      { ligne: 5, raison: 'aucun montant sur cette ligne' },
    ])
  })
})

// --- Empreintes ------------------------------------------------------------------

describe('empreintes et identifiants', () => {
  it('donne un UUID valide, reconnu par la validation du journal', async () => {
    const { idEvenement } = await identifiantsOperation('quelconque')
    expect(idEvenement).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(() =>
      validerEvenement({
        id: idEvenement,
        ts: 1,
        device: 'test',
        type: 'transaction.deleted',
        payload: { id: 'x' },
      }),
    ).not.toThrow()
  })

  it('redonne le même identifiant pour la même empreinte', async () => {
    const a = await identifiantsOperation('meme-graine')
    const b = await identifiantsOperation('meme-graine')
    expect(a).toEqual(b)
  })

  it('donne un identifiant différent à une autre empreinte', async () => {
    const a = await identifiantsOperation('graine-a')
    const b = await identifiantsOperation('graine-b')
    expect(a.idEvenement).not.toBe(b.idEvenement)
  })

  it('ne fait pas dépendre l’empreinte du numéro de ligne', () => {
    // La banque peut réexporter la même période dans un autre ordre.
    const base = { date: d('2025-09-01'), montant_cents: e(-2.5), libelle: 'CB BOULANGERIE' }
    expect(empreinteOperation('c1', { ...base, ligne: 2 }, 0)).toBe(
      empreinteOperation('c1', { ...base, ligne: 47 }, 0),
    )
  })

  it('ne confond pas deux comptes', () => {
    const operation = {
      ligne: 2,
      date: d('2025-09-01'),
      montant_cents: e(-2.5),
      libelle: 'CB BOULANGERIE',
    }
    expect(empreinteOperation('c1', operation, 0)).not.toBe(empreinteOperation('c2', operation, 0))
  })

  it('préfère la référence bancaire quand elle existe', () => {
    const a = empreinteOperation(
      'c1',
      { ligne: 1, date: d('2025-09-01'), montant_cents: e(-2.5), libelle: 'A', reference: 'R7' },
      0,
    )
    // Même référence, tout le reste différent : c'est la même opération.
    const b = empreinteOperation(
      'c1',
      { ligne: 9, date: d('2025-09-04'), montant_cents: e(-9), libelle: 'B', reference: 'R7' },
      3,
    )
    expect(a).toBe(b)
  })
})

// --- Plan d'import ------------------------------------------------------------------

function etatDeBase(supplements: Evenement[] = []): Etat {
  return plier([
    ev('account.created', { ...COMPTE }),
    ev('account.balance_set', { account_id: 'c1', date: '2025-08-31', solde_cents: e(1000) }),
    ...supplements,
  ])
}

describe('plan d’import', () => {
  it('prépare toutes les lignes d’un fichier jamais importé', async () => {
    const plan = await preparerImport(etatDeBase(), [], 'c1', lireFichier())
    expect(plan.nouvelles).toHaveLength(4)
    expect(plan.deja).toHaveLength(0)
    expect(plan.debut).toBe('2025-09-01')
    expect(plan.fin).toBe('2025-09-05')
  })

  it('ne confond pas deux dépenses identiques du même jour', async () => {
    // Deux cafés à 2,50 € chez le même commerçant sont deux opérations réelles.
    const plan = await preparerImport(etatDeBase(), [], 'c1', lireFichier())
    const boulangerie = plan.nouvelles.filter((o) => o.libelle === 'CB BOULANGERIE')
    expect(boulangerie).toHaveLength(2)
    expect(boulangerie[0]!.idEvenement).not.toBe(boulangerie[1]!.idEvenement)
  })

  it('reconnaît un fichier déjà importé, et n’ajoute rien', async () => {
    const operations = lireFichier()
    const premier = await preparerImport(etatDeBase(), [], 'c1', operations)
    // Le journal contient maintenant les événements du premier import.
    const journal = premier.nouvelles.map((operation) =>
      validerEvenement({
        id: operation.idEvenement,
        ts: horloge++,
        device: 'test',
        type: 'transaction.created',
        payload: {
          id: operation.idTransaction,
          account_id: 'c1',
          date: operation.date,
          montant_cents: operation.montant_cents,
          origine: 'csv',
          note: operation.libelle,
        },
      }),
    )
    const second = await preparerImport(plier(journal), journal, 'c1', lireFichier())
    expect(second.nouvelles).toHaveLength(0)
    expect(second.deja).toHaveLength(4)
  })

  it('reconnaît les lignes communes quand le second fichier couvre une période plus large', async () => {
    const septembre = lireFichier()
    const plus = lireFichier(
      [FICHIER, '10/09/2025;CB PHARMACIE;-18,90', '12/09/2025;CB ESSENCE;-62,00'].join('\n'),
    )
    const premier = await preparerImport(etatDeBase(), [], 'c1', septembre)
    const journal = premier.nouvelles.map((operation) =>
      validerEvenement({
        id: operation.idEvenement,
        ts: horloge++,
        device: 'test',
        type: 'transaction.created',
        payload: {
          id: operation.idTransaction,
          account_id: 'c1',
          date: operation.date,
          montant_cents: operation.montant_cents,
          origine: 'csv',
          note: operation.libelle,
        },
      }),
    )
    const second = await preparerImport(plier(journal), journal, 'c1', plus)
    expect(second.deja).toHaveLength(4)
    expect(second.nouvelles.map((o) => o.libelle)).toEqual(['CB PHARMACIE', 'CB ESSENCE'])
  })

  it('signale les lignes antérieures au dernier relevé', async () => {
    const etat = etatDeBase([
      ev('account.balance_set', { account_id: 'c1', date: '2025-09-04', solde_cents: e(900) }),
    ])
    const plan = await preparerImport(etat, [], 'c1', lireFichier())
    expect(plan.ancre).toBe('2025-09-04')
    // Les trois du 1er et du 3 septembre n'entreront pas dans le solde.
    expect(plan.sansEffetSurSolde).toHaveLength(3)
    expect(plan.nouvelles.filter((o) => !o.sansEffetSurSolde)).toHaveLength(1)
  })

  it('signale une ligne qui ressemble à une saisie déjà présente', async () => {
    const etat = etatDeBase([
      ev('transaction.created', {
        id: 't-main',
        account_id: 'c1',
        date: '2025-09-05',
        montant_cents: e(-780),
        origine: 'manuel',
        note: 'Loyer',
      }),
    ])
    const plan = await preparerImport(etat, [], 'c1', lireFichier())
    expect(plan.ressemblances).toHaveLength(1)
    expect(plan.ressemblances[0]!.libelle).toBe('PRLV LOYER')
    expect(plan.ressemblances[0]!.ressemblance?.id).toBe('t-main')
  })

  it('ne prend pas une ligne déjà importée pour une ressemblance', async () => {
    const etat = etatDeBase([
      ev('transaction.created', {
        id: 'csv-abc',
        account_id: 'c1',
        date: '2025-09-05',
        montant_cents: e(-780),
        origine: 'csv',
        note: 'PRLV LOYER',
      }),
    ])
    const plan = await preparerImport(etat, [], 'c1', lireFichier())
    expect(plan.ressemblances).toHaveLength(0)
  })
})

// --- Réconciliations recouvertes -------------------------------------------------

describe('écarts de réconciliation recouverts', () => {
  /** Une réconciliation : l'écart, puis l'ancre, dans cet ordre. */
  function reconcilier(date: string, ecart: Cents, solde: Cents, id: string): Evenement[] {
    return [
      ev('transaction.created', {
        id,
        account_id: 'c1',
        date,
        montant_cents: ecart,
        origine: 'reconciliation',
        note: 'Non catégorisé',
      }),
      ev('account.balance_set', { account_id: 'c1', date, solde_cents: solde }),
    ]
  }

  it('marque pleinement couvert un écart dont toute la période est importée', () => {
    const etat = etatDeBase(reconcilier('2025-09-07', e(-214.3), e(785.7), 't-rec'))
    const couvertes = reconciliationsCouvertes(etat, 'c1', d('2025-09-01'), d('2025-09-30'))
    expect(couvertes).toHaveLength(1)
    expect(couvertes[0]!.depuis).toBe('2025-08-31')
    expect(couvertes[0]!.pleinementCouverte).toBe(true)
  })

  it('ne marque pas pleinement couvert un écart qui déborde de l’import', () => {
    // L'écart du 7 résume depuis le 31 août ; un import qui commence le 3
    // septembre ne remplace pas les 1er et 2.
    const etat = etatDeBase(reconcilier('2025-09-07', e(-214.3), e(785.7), 't-rec'))
    const couvertes = reconciliationsCouvertes(etat, 'c1', d('2025-09-03'), d('2025-09-30'))
    expect(couvertes[0]!.pleinementCouverte).toBe(false)
  })

  it('ignore un écart hors de la période importée', () => {
    const etat = etatDeBase(reconcilier('2025-10-05', e(-50), e(700), 't-rec'))
    expect(reconciliationsCouvertes(etat, 'c1', d('2025-09-01'), d('2025-09-30'))).toHaveLength(0)
  })

  it('ignore les transactions qui ne viennent pas d’une réconciliation', () => {
    const etat = etatDeBase([
      ev('transaction.created', {
        id: 't-main',
        account_id: 'c1',
        date: '2025-09-05',
        montant_cents: e(-780),
        origine: 'manuel',
      }),
    ])
    expect(reconciliationsCouvertes(etat, 'c1', d('2025-09-01'), d('2025-09-30'))).toHaveLength(0)
  })

  it('ne confond pas l’ancre posée par la réconciliation avec celle qui la précède', () => {
    // L'écart et son ancre portent la même date. Prendre la seconde ferait
    // croire que l'écart ne résume rien, et donc qu'il est toujours couvert.
    const etat = etatDeBase(reconcilier('2025-09-07', e(-214.3), e(785.7), 't-rec'))
    const couvertes = reconciliationsCouvertes(etat, 'c1', d('2025-09-01'), d('2025-09-30'))
    expect(couvertes[0]!.depuis).not.toBe('2025-09-07')
  })

  it('rattache chaque écart à la période qui le précède quand il y en a plusieurs', () => {
    const etat = etatDeBase([
      ...reconcilier('2025-09-07', e(-100), e(900), 't-rec1'),
      ...reconcilier('2025-09-14', e(-80), e(820), 't-rec2'),
    ])
    const couvertes = reconciliationsCouvertes(etat, 'c1', d('2025-09-08'), d('2025-09-30'))
    expect(couvertes).toHaveLength(1)
    expect(couvertes[0]!.transaction.id).toBe('t-rec2')
    expect(couvertes[0]!.depuis).toBe('2025-09-07')
    expect(couvertes[0]!.pleinementCouverte).toBe(true)
  })
})

// --- Écriture ---------------------------------------------------------------------

describe('événements produits', () => {
  it('porte l’identifiant d’empreinte sur chaque événement', async () => {
    const plan = await preparerImport(etatDeBase(), [], 'c1', lireFichier())
    const entrees = evenementsImport(plan)
    expect(entrees).toHaveLength(4)
    expect(entrees.map((entree) => entree.id)).toEqual(
      plan.nouvelles.map((operation) => operation.idEvenement),
    )
    expect(entrees[0]!.payload).toMatchObject({ account_id: 'c1', origine: 'csv' })
  })

  it('produit des événements que la validation du journal accepte', async () => {
    const plan = await preparerImport(etatDeBase(), [], 'c1', lireFichier())
    for (const entree of evenementsImport(plan)) {
      expect(() =>
        validerEvenement({
          id: entree.id,
          ts: horloge++,
          device: 'test',
          type: entree.type,
          payload: entree.payload,
        }),
      ).not.toThrow()
    }
  })

  it('écarte les ressemblances quand on le demande', async () => {
    const etat = etatDeBase([
      ev('transaction.created', {
        id: 't-main',
        account_id: 'c1',
        date: '2025-09-05',
        montant_cents: e(-780),
        origine: 'manuel',
      }),
    ])
    const plan = await preparerImport(etat, [], 'c1', lireFichier())
    expect(evenementsImport(plan, { ecarterRessemblances: true })).toHaveLength(3)
    expect(evenementsImport(plan, { ecarterRessemblances: false })).toHaveLength(4)
  })

  it('écarte les lignes antérieures au relevé quand on le demande', async () => {
    const etat = etatDeBase([
      ev('account.balance_set', { account_id: 'c1', date: '2025-09-04', solde_cents: e(900) }),
    ])
    const plan = await preparerImport(etat, [], 'c1', lireFichier())
    expect(evenementsImport(plan, { ecarterAnterieures: true })).toHaveLength(1)
  })

  it('supprime les écarts désignés, avant d’écrire les lignes', async () => {
    const plan = await preparerImport(etatDeBase(), [], 'c1', lireFichier())
    const entrees = evenementsImport(plan, { reconciliationsASupprimer: ['t-rec'] })
    expect(entrees[0]).toEqual({ type: 'transaction.deleted', payload: { id: 't-rec' } })
    expect(entrees).toHaveLength(5)
  })

  it('deux appareils qui importent le même relevé ne font qu’un seul jeu de lignes', async () => {
    // C'est la promesse de la recette : chaque appareil importe de son côté,
    // puis on échange les sauvegardes. Les identifiants étant tirés du contenu,
    // l'union sur `id` reconnaît les mêmes événements — sans arbitrage.
    const { fusionnerJournaux } = await import('./events')
    const etat = etatDeBase()

    const journalDe = async (device: string) => {
      const plan = await preparerImport(etat, [], 'c1', lireFichier())
      return evenementsImport(plan).map((entree, rang) =>
        validerEvenement({
          id: entree.id,
          // Instants et appareils différents : rien de tout cela ne doit compter.
          ts: horloge + rang,
          device,
          type: entree.type,
          payload: entree.payload,
        }),
      )
    }

    const appareilA = await journalDe('android')
    horloge += 10_000
    const appareilB = await journalDe('bureau')
    expect(appareilA.map((e) => e.id)).toEqual(appareilB.map((e) => e.id))

    const fusionne = fusionnerJournaux(appareilA, appareilB)
    expect(fusionne).toHaveLength(4)
    expect(plier(fusionne).transactions.size).toBe(4)
  })

  it('supprimer le même écart depuis deux appareils reste sans effet', () => {
    const journal = [
      ev('account.created', { ...COMPTE }),
      ev('transaction.created', {
        id: 't-rec',
        account_id: 'c1',
        date: '2025-09-07',
        montant_cents: e(-50),
        origine: 'reconciliation',
      }),
      ev('transaction.deleted', { id: 't-rec' }),
      ev('transaction.deleted', { id: 't-rec' }),
    ]
    expect(() => plier(journal)).not.toThrow()
    expect(plier(journal).transactions.size).toBe(0)
  })

  it('supprimer un écart ne déplace pas le solde, seulement les totaux', async () => {
    // L'écart a été écrit juste avant l'ancre qui l'a suivi : il est déjà
    // derrière elle, donc il ne comptait plus dans le solde.
    const journal = [
      ev('account.created', { ...COMPTE }),
      ev('account.balance_set', { account_id: 'c1', date: '2025-08-31', solde_cents: e(1000) }),
      ev('transaction.created', {
        id: 't-rec',
        account_id: 'c1',
        date: '2025-09-07',
        montant_cents: e(-214.3),
        origine: 'reconciliation',
        note: 'Non catégorisé',
      }),
      ev('account.balance_set', { account_id: 'c1', date: '2025-09-07', solde_cents: e(785.7) }),
    ]
    const { soldeDuCompte } = await import('./selecteurs')
    const avant = soldeDuCompte(plier(journal), 'c1', d('2025-09-30'))
    const apres = soldeDuCompte(
      plier([...journal, ev('transaction.deleted', { id: 't-rec' })]),
      'c1',
      d('2025-09-30'),
    )
    expect(avant).toBe(e(785.7))
    expect(apres).toBe(avant)
  })
})
