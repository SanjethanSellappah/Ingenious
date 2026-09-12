import { describe, expect, it } from 'vitest'
import { dateCivile } from '../core/civilDate'
import { cents, type Cents } from '../core/money'
import { normaliserNom, plier, type Etat } from './etat'
import { validerEvenement, type Evenement, type TypeEvenement } from './events'
import {
  ancreDuCompte,
  depensesParLabel,
  labelParNom,
  mouvementsDuCompte,
  patrimoine,
  realiseesDe,
  soldeDuCompte,
} from './selecteurs'

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

const courant = {
  id: 'c1',
  nom: 'Courant',
  type: 'courant',
  groupe: 'bancaire',
  mode: 'saisi',
} as const
const livret = {
  id: 'c2',
  nom: 'Livret A',
  type: 'livret',
  groupe: 'bancaire',
  mode: 'saisi',
} as const

describe('pliage', () => {
  it('reconstruit les comptes', () => {
    const etat = plier([ev('account.created', { ...courant })])
    expect(etat.comptes.get('c1')).toMatchObject({ nom: 'Courant', mode: 'saisi' })
  })

  it('applique une modification sans réécrire l’événement d’origine', () => {
    const etat = plier([
      ev('account.created', { ...courant }),
      ev('account.updated', { id: 'c1', nom: 'Compte courant' }),
    ])
    expect(etat.comptes.get('c1')!.nom).toBe('Compte courant')
  })

  it('archive puis désarchive', () => {
    const archive = plier([
      ev('account.created', { ...courant }),
      ev('account.archived', { id: 'c1', date: '2026-09-11' }),
    ])
    expect(archive.comptes.get('c1')!.archived_at).toBe('2026-09-11')
    const restaure = plier([
      ev('account.created', { ...courant }),
      ev('account.archived', { id: 'c1', date: '2026-09-11' }),
      ev('account.unarchived', { id: 'c1' }),
    ])
    expect(restaure.comptes.get('c1')!.archived_at).toBeUndefined()
  })

  it('ne dépend pas de l’ordre de réception — le tri est fait au pliage', () => {
    const creation = ev('account.created', { ...courant }, 100)
    const modification = ev('account.updated', { id: 'c1', nom: 'Renommé' }, 200)
    expect(plier([modification, creation]).comptes.get('c1')!.nom).toBe('Renommé')
  })

  it('ignore un événement qui porte sur une entité inconnue', () => {
    // Cas normal d'un journal partiel : on n'invente pas l'entité manquante.
    const etat = plier([ev('account.updated', { id: 'inexistant', nom: 'X' })])
    expect(etat.comptes.size).toBe(0)
  })

  it('supprime une transaction sans laisser de trace dans l’état', () => {
    const etat = plier([
      ev('account.created', { ...courant }),
      ev('transaction.created', {
        id: 't1',
        account_id: 'c1',
        date: '2026-09-11',
        montant_cents: -1000,
        origine: 'manuel',
      }),
      ev('transaction.deleted', { id: 't1' }),
    ])
    expect(etat.transactions.size).toBe(0)
  })
})

describe('historique de prix d’un abonnement', () => {
  const abonnement = {
    id: 'a1',
    nom: 'Netflix',
    account_id: 'c1',
    sens: 'depense',
    montant_mode: 'fixe',
    frequence: 'mensuel',
    jour_du_mois: 15,
    date_debut: '2025-01-15',
  }

  it('clôt la période précédente la veille du changement', () => {
    const etat = plier([
      ev('subscription.created', { ...abonnement }),
      ev('subscription.price_changed', {
        subscription_id: 'a1',
        montant_cents: 999,
        valide_du: '2025-01-01',
      }),
      ev('subscription.price_changed', {
        subscription_id: 'a1',
        montant_cents: 1299,
        valide_du: '2026-03-01',
      }),
    ])
    // Sans cette clôture, deux périodes se chevaucheraient et le montant d'une
    // échéance passée deviendrait ambigu.
    expect(etat.abonnements.get('a1')!.prix).toEqual([
      { montant_cents: 999, valide_du: '2025-01-01', valide_au: '2026-02-28' },
      { montant_cents: 1299, valide_du: '2026-03-01' },
    ])
  })

  it('la fin d’abonnement pose la date de fin et le désactive', () => {
    const etat = plier([
      ev('subscription.created', { ...abonnement }),
      ev('subscription.ended', { subscription_id: 'a1', date_fin: '2026-12-31' }),
    ])
    expect(etat.abonnements.get('a1')!.actif).toBe(false)
    expect(etat.abonnements.get('a1')!.regle.date_fin).toBe('2026-12-31')
  })
})

describe('labels', () => {
  it('normalise la casse et les accents', () => {
    expect(normaliserNom('  Courses  ')).toBe('courses')
    expect(normaliserNom('Énergie')).toBe('energie')
    expect(normaliserNom('Frais   bancaires')).toBe('frais bancaires')
  })

  it('retrouve un label quelle que soit la façon de l’écrire', () => {
    const etat = plier([ev('label.created', { id: 'l1', nom: 'Courses', couleur: '#4ade80' })])
    expect(labelParNom(etat, 'COURSES')?.id).toBe('l1')
    expect(labelParNom(etat, ' courses ')?.id).toBe('l1')
    expect(labelParNom(etat, 'course')).toBeNull()
  })

  it('met à jour la normalisation au renommage', () => {
    const etat = plier([
      ev('label.created', { id: 'l1', nom: 'Courses', couleur: '#fff' }),
      ev('label.renamed', { id: 'l1', nom: 'Alimentation' }),
    ])
    expect(etat.labels.get('l1')!.nom_normalise).toBe('alimentation')
  })

  it('pose puis retire un budget', () => {
    const avec = plier([
      ev('label.created', { id: 'l1', nom: 'Courses', couleur: '#fff' }),
      ev('label.budget_set', { id: 'l1', budget_mensuel_cents: 40000 }),
    ])
    expect(avec.labels.get('l1')!.budget_mensuel_cents).toBe(40000)
    const sans = plier([
      ev('label.created', { id: 'l1', nom: 'Courses', couleur: '#fff' }),
      ev('label.budget_set', { id: 'l1', budget_mensuel_cents: 40000 }),
      ev('label.budget_set', { id: 'l1' }),
    ])
    expect(sans.labels.get('l1')!.budget_mensuel_cents).toBeUndefined()
  })
})

describe('invariant de solde', () => {
  function etatAvecSolde(): Etat {
    return plier([
      ev('account.created', { ...courant }),
      ev('account.balance_set', { account_id: 'c1', date: '2026-09-01', solde_cents: 120000 }),
      ev('transaction.created', {
        id: 't1',
        account_id: 'c1',
        date: '2026-09-05',
        montant_cents: -2000,
        origine: 'manuel',
      }),
    ])
  }

  it('part de l’ancre et ajoute ce qui suit', () => {
    expect(soldeDuCompte(etatAvecSolde(), 'c1', d('2026-09-30'))).toBe(e(1180))
  })

  it('ignore les mouvements postérieurs à la date demandée', () => {
    expect(soldeDuCompte(etatAvecSolde(), 'c1', d('2026-09-03'))).toBe(e(1200))
  })

  it('ignore les mouvements antérieurs à l’ancre — ils y sont déjà', () => {
    const etat = plier([
      ev('account.created', { ...courant }),
      ev('transaction.created', {
        id: 't0',
        account_id: 'c1',
        date: '2026-08-15',
        montant_cents: -50000,
        origine: 'manuel',
      }),
      ev('account.balance_set', { account_id: 'c1', date: '2026-09-01', solde_cents: 120000 }),
    ])
    expect(soldeDuCompte(etat, 'c1', d('2026-09-30'))).toBe(e(1200))
  })

  it('vaut zéro sans aucun relevé', () => {
    const etat = plier([ev('account.created', { ...courant })])
    expect(soldeDuCompte(etat, 'c1', d('2026-09-30'))).toBe(0)
    expect(ancreDuCompte(etat, 'c1')).toBeNull()
  })

  it('prend le relevé le plus récent quand il y en a plusieurs le même jour', () => {
    const etat = plier([
      ev('account.created', { ...courant }),
      ev(
        'account.balance_set',
        { account_id: 'c1', date: '2026-09-01', solde_cents: 100000 },
        1000,
      ),
      ev(
        'account.balance_set',
        { account_id: 'c1', date: '2026-09-01', solde_cents: 110000 },
        2000,
      ),
    ])
    expect(soldeDuCompte(etat, 'c1', d('2026-09-30'))).toBe(e(1100))
  })
})

describe('réconciliation', () => {
  it('ne compte pas l’écart deux fois', () => {
    // Séquence réelle : l'écart est écrit, puis la nouvelle ancre. L'ancre
    // contient déjà l'écart ; le compter en plus doublerait la correction.
    const etat = plier([
      ev('account.created', { ...courant }),
      ev(
        'account.balance_set',
        { account_id: 'c1', date: '2026-09-01', solde_cents: 120000 },
        1000,
      ),
      ev(
        'transaction.created',
        {
          id: 'ecart',
          account_id: 'c1',
          date: '2026-09-11',
          montant_cents: -4210,
          origine: 'reconciliation',
        },
        2000,
      ),
      ev(
        'account.balance_set',
        { account_id: 'c1', date: '2026-09-11', solde_cents: 115790 },
        2001,
      ),
    ])
    expect(soldeDuCompte(etat, 'c1', d('2026-09-11'))).toBe(e(1157.9))
  })

  it('compte une dépense saisie après la réconciliation du même jour', () => {
    // Sans départage par instant, cette dépense serait ignorée en silence :
    // même date que l'ancre, donc « pas postérieure ».
    const etat = plier([
      ev('account.created', { ...courant }),
      ev(
        'account.balance_set',
        { account_id: 'c1', date: '2026-09-11', solde_cents: 115790 },
        2001,
      ),
      ev(
        'transaction.created',
        {
          id: 't2',
          account_id: 'c1',
          date: '2026-09-11',
          montant_cents: -1500,
          origine: 'manuel',
        },
        3000,
      ),
    ])
    expect(soldeDuCompte(etat, 'c1', d('2026-09-11'))).toBe(e(1142.9))
  })
})

describe('virements', () => {
  const avecVirement = () =>
    plier([
      ev('account.created', { ...courant }),
      ev('account.created', { ...livret }),
      ev('account.balance_set', { account_id: 'c1', date: '2026-09-01', solde_cents: 120000 }),
      ev('account.balance_set', { account_id: 'c2', date: '2026-09-01', solde_cents: 500000 }),
      ev('transfer.created', {
        id: 'v1',
        date: '2026-09-10',
        from_account_id: 'c1',
        to_account_id: 'c2',
        montant_cents: 30000,
      }),
    ])

  it('sort d’un compte et entre dans l’autre, une seule entité', () => {
    const etat = avecVirement()
    expect(soldeDuCompte(etat, 'c1', d('2026-09-30'))).toBe(e(900))
    expect(soldeDuCompte(etat, 'c2', d('2026-09-30'))).toBe(e(5300))
    expect(etat.virements.size).toBe(1)
  })

  it('ne change pas le patrimoine total', () => {
    expect(patrimoine(avecVirement(), d('2026-09-30')).total).toBe(e(6200))
  })

  it('porte sa nature, ce qui l’exclut des dépenses', () => {
    const mouvements = mouvementsDuCompte(avecVirement(), 'c1')
    expect(mouvements.map((m) => m.nature)).toEqual(['virement'])
  })

  it('est refusé vers son propre compte', () => {
    expect(() =>
      ev('transfer.created', {
        id: 'v2',
        date: '2026-09-10',
        from_account_id: 'c1',
        to_account_id: 'c1',
        montant_cents: 1000,
      }),
    ).toThrow(/son compte de départ/)
  })
})

describe('patrimoine', () => {
  it('groupe bancaire et investissement', () => {
    const etat = plier([
      ev('account.created', { ...courant }),
      ev('account.created', {
        id: 'p1',
        nom: 'PEA',
        type: 'pea',
        groupe: 'investissement',
        mode: 'saisi',
      }),
      ev('account.balance_set', { account_id: 'c1', date: '2026-09-01', solde_cents: 120000 }),
      ev('account.balance_set', { account_id: 'p1', date: '2026-09-01', solde_cents: 800000 }),
    ])
    const { total, parGroupe } = patrimoine(etat, d('2026-09-30'))
    expect(total).toBe(e(9200))
    expect(parGroupe.get('bancaire')).toBe(e(1200))
    expect(parGroupe.get('investissement')).toBe(e(8000))
  })

  it('exclut un compte archivé', () => {
    const etat = plier([
      ev('account.created', { ...courant }),
      ev('account.created', { ...livret }),
      ev('account.balance_set', { account_id: 'c1', date: '2026-09-01', solde_cents: 120000 }),
      ev('account.balance_set', { account_id: 'c2', date: '2026-09-01', solde_cents: 500000 }),
      ev('account.archived', { id: 'c2', date: '2026-09-05' }),
    ])
    expect(patrimoine(etat, d('2026-09-30')).total).toBe(e(1200))
  })
})

describe('dépenses par label', () => {
  const etat = () =>
    plier([
      ev('account.created', { ...courant }),
      ev('account.created', { ...livret }),
      ev('label.created', { id: 'l1', nom: 'Courses', couleur: '#4ade80' }),
      ev('label.budget_set', { id: 'l1', budget_mensuel_cents: 40000 }),
      ev('transaction.created', {
        id: 't1',
        account_id: 'c1',
        date: '2026-09-05',
        montant_cents: -12000,
        label_id: 'l1',
        origine: 'manuel',
      }),
      ev('transaction.created', {
        id: 't2',
        account_id: 'c1',
        date: '2026-09-07',
        montant_cents: -8000,
        label_id: 'l1',
        origine: 'manuel',
      }),
      ev('transaction.created', {
        id: 't3',
        account_id: 'c1',
        date: '2026-09-08',
        montant_cents: -3000,
        origine: 'reconciliation',
      }),
      ev('transaction.created', {
        id: 't4',
        account_id: 'c1',
        date: '2026-09-09',
        montant_cents: 200000,
        origine: 'manuel',
      }),
      ev('transfer.created', {
        id: 'v1',
        date: '2026-09-10',
        from_account_id: 'c1',
        to_account_id: 'c2',
        montant_cents: 50000,
      }),
      ev('transaction.created', {
        id: 't5',
        account_id: 'c1',
        date: '2026-08-20',
        montant_cents: -9900,
        label_id: 'l1',
        origine: 'manuel',
      }),
    ])

  it('totalise le mois demandé, et lui seul', () => {
    const lignes = depensesParLabel(etat(), '2026-09')
    const courses = lignes.find((l) => l.label?.id === 'l1')!
    expect(courses.total_cents).toBe(e(200))
    expect(courses.nombre).toBe(2)
  })

  it('exclut les virements et les rentrées', () => {
    const total = depensesParLabel(etat(), '2026-09').reduce((s, l) => s + l.total_cents, 0)
    // 120 + 80 de courses, 30 de non catégorisé. Ni le virement de 500 €, ni la
    // rentrée de 2 000 € n'y figurent.
    expect(total).toBe(e(230))
  })

  it('range les dépenses sans label sous « non catégorisé »', () => {
    const lignes = depensesParLabel(etat(), '2026-09')
    const sansLabel = lignes.find((l) => l.label === null)!
    expect(sansLabel.total_cents).toBe(e(30))
  })

  it('rapporte la consommation au budget', () => {
    const courses = depensesParLabel(etat(), '2026-09').find((l) => l.label?.id === 'l1')!
    expect(courses.partBudget).toBeCloseTo(0.5, 5)
  })

  it('trie du plus gros au plus petit', () => {
    const lignes = depensesParLabel(etat(), '2026-09')
    expect(lignes.map((l) => l.total_cents)).toEqual(
      [...lignes.map((l) => l.total_cents)].sort((a, b) => b - a),
    )
  })
})

describe('exceptions d’occurrence', () => {
  it('ne retient que les réalisées pour l’estimation', () => {
    const etat = plier([
      ev('occurrence.overridden', {
        subscription_id: 'a1',
        date_theorique: '2026-08-30',
        montant_cents: 190000,
        statut: 'realise',
      }),
      ev('occurrence.overridden', {
        subscription_id: 'a1',
        date_theorique: '2026-09-30',
        montant_cents: 200000,
        statut: 'previsionnel',
      }),
    ])
    expect(realiseesDe(etat, 'a1')).toEqual([
      { date_theorique: '2026-08-30', montant_cents: 190000 },
    ])
  })

  it('la dernière exception écrite gagne, pour un même couple', () => {
    const etat = plier([
      ev('occurrence.overridden', {
        subscription_id: 'a1',
        date_theorique: '2026-09-30',
        montant_cents: 200000,
        statut: 'previsionnel',
      }),
      ev('occurrence.overridden', {
        subscription_id: 'a1',
        date_theorique: '2026-09-30',
        montant_cents: 214367,
        statut: 'realise',
      }),
    ])
    expect(etat.exceptions.size).toBe(1)
    expect(realiseesDe(etat, 'a1')[0]!.montant_cents).toBe(214367)
  })

  it('une exception effacée disparaît de l’état', () => {
    const etat = plier([
      ev('occurrence.overridden', {
        subscription_id: 'a1',
        date_theorique: '2026-09-30',
        montant_cents: 200000,
        statut: 'realise',
      }),
      ev('occurrence.override_cleared', { subscription_id: 'a1', date_theorique: '2026-09-30' }),
    ])
    expect(etat.exceptions.size).toBe(0)
  })
})

describe('réglages', () => {
  it('vivent dans le journal, donc suivent l’export', () => {
    const etat = plier([ev('settings.updated', { reserve_cents: 20000 })])
    expect(etat.reglages.reserve_cents).toBe(e(200))
  })
})
