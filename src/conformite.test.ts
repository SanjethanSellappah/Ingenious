/**
 * Conformité au contexte.
 *
 * Chaque test porte le numéro de l'article de `docs/CONTEXTE.md` qu'il vérifie.
 * C'est une relecture exécutable du cahier des charges : une prose qui affirme
 * « les virements sortent des dépenses » vieillit mal, un test qui l'échoue
 * prévient.
 *
 * Les tests unitaires par module vérifient *comment* chaque brique fonctionne.
 * Celui-ci vérifie *que ce qui était demandé est fait*, et rien d'autre.
 */
import { describe, expect, it } from 'vitest'
import { dateCivile, nomDuJour } from './core/civilDate'
import { echeancesDeLaRecurrence, type Recurrence } from './core/echeances'
import { estimer, mediane } from './core/estimation'
import { joursFeries, paques } from './core/holidaysFR'
import { analyserMontant, arrondirCents, cents, formaterMontant, type Cents } from './core/money'
import { montantValideA } from './core/prixAbonnement'
import { dateAffichee, occurrencesTheoriques } from './core/recurrence'
import { projeterSolde } from './core/projection'
import { resteAVivre } from './core/resteAVivre'
import { plier } from './domain/etat'
import {
  TYPES_EVENEMENT,
  validerEvenement,
  type Evenement,
  type TypeEvenement,
} from './domain/events'
import { depensesParLabel, soldeDuCompte } from './domain/selecteurs'

const d = dateCivile
const e = (euros: number): Cents => cents(Math.round(euros * 100))
let sequence = 0

function ev(type: TypeEvenement, payload: Record<string, unknown>, ts?: number): Evenement {
  sequence += 1
  return validerEvenement({
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    ts: ts ?? 1_757_000_000_000 + sequence,
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

// §3 — Décisions d'architecture non négociables ------------------------------

describe('§3.1 les montants sont des entiers en centimes', () => {
  it('refuse tout flottant à la construction', () => {
    expect(() => cents(12.5)).toThrow()
  })

  it('refuse un flottant dans le journal', () => {
    expect(() =>
      ev('account.balance_set', { account_id: 'c1', date: '2026-09-11', solde_cents: 10.5 }),
    ).toThrow()
  })

  it('n’accumule aucune dérive sur mille additions', () => {
    // Le même calcul en euros flottants dérive dès la centième addition.
    let total = 0
    for (let i = 0; i < 1000; i++) total += e(0.1)
    expect(total).toBe(e(100))
  })
})

describe('§3.2 le journal est append-only, l’état est dérivé', () => {
  it('une correction est un nouvel événement, pas une réécriture', () => {
    const journal = [
      ev('account.created', { ...courant }),
      ev('account.updated', { id: 'c1', nom: 'Renommé' }),
    ]
    // Les deux événements coexistent ; c'est le pliage qui tranche.
    expect(journal).toHaveLength(2)
    expect(plier(journal).comptes.get('c1')!.nom).toBe('Renommé')
    // Et l'événement d'origine dit toujours la même chose.
    expect(journal[0]!.payload.nom).toBe('Courant')
  })

  it('replier deux fois le même journal donne le même état', () => {
    const journal = [ev('account.created', { ...courant })]
    expect(plier(journal)).toEqual(plier(journal))
  })
})

describe('§3.3 les occurrences futures ne sont jamais stockées', () => {
  it('aucun type d’événement ne matérialise une occurrence à venir', () => {
    // Seules les exceptions sont stockées : override et effacement d'override.
    const surOccurrence = TYPES_EVENEMENT.filter((type) => type.startsWith('occurrence.'))
    expect(surOccurrence).toEqual(['occurrence.overridden', 'occurrence.override_cleared'])
  })

  it('les occurrences se calculent à la volée depuis la règle', () => {
    const regle = { frequence: 'mensuel' as const, jour_du_mois: 5, date_debut: d('2026-01-01') }
    expect(occurrencesTheoriques(regle, d('2030-01-01'), d('2030-03-31'))).toEqual([
      '2030-01-05',
      '2030-02-05',
      '2030-03-05',
    ])
  })
})

describe('§3.4 les dates stockées sont les dates théoriques', () => {
  it('la clé de l’occurrence est la théorique, l’affichage est décalé', () => {
    const recurrence: Recurrence = {
      id: 'loyer',
      libelle: 'Loyer',
      sens: 'depense',
      montant_mode: 'fixe',
      prix: [{ montant_cents: e(700), valide_du: d('2025-01-01') }],
      regle: {
        frequence: 'mensuel',
        jour_du_mois: 1,
        regle_weekend: 'jour_ouvre_precedent',
        date_debut: d('2025-01-01'),
      },
    }
    const echeance = echeancesDeLaRecurrence(recurrence, d('2026-10-02'), d('2026-10-31'))
      .echeances[0]!
    // Le 1er novembre 2026 est un dimanche.
    expect(echeance.reference!.date_theorique).toBe('2026-11-01')
    expect(echeance.date).toBe('2026-10-30')
  })

  it('la règle ne dérive pas de mois en mois', () => {
    const regle = {
      frequence: 'mensuel' as const,
      jour_du_mois: 31,
      date_debut: d('2026-01-01'),
    }
    const dates = occurrencesTheoriques(regle, d('2026-01-01'), d('2026-05-31'))
    // Février rogne au 28, mars retrouve le 31 : aucune dérive en cascade.
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
  })
})

describe('§3.5 un virement est une entité distincte', () => {
  const journal = [
    ev('account.created', { ...courant }),
    ev('account.created', {
      id: 'c2',
      nom: 'Livret',
      type: 'livret',
      groupe: 'bancaire',
      mode: 'saisi',
    }),
    ev('transfer.created', {
      id: 'v1',
      date: '2026-09-10',
      from_account_id: 'c1',
      to_account_id: 'c2',
      montant_cents: 50000,
    }),
    ev('transaction.created', {
      id: 't1',
      account_id: 'c1',
      date: '2026-09-11',
      montant_cents: -3000,
      origine: 'manuel',
    }),
  ]

  it('n’est pas deux transactions', () => {
    const etat = plier(journal)
    expect(etat.virements.size).toBe(1)
    expect(etat.transactions.size).toBe(1)
  })

  it('est exclu par construction des totaux de dépenses', () => {
    const total = depensesParLabel(plier(journal), '2026-09').reduce(
      (somme, ligne) => somme + ligne.total_cents,
      0,
    )
    // Seule la dépense de 30 € compte ; le virement de 500 € n'y est pas.
    expect(total).toBe(e(30))
  })
})

describe('§3.6 les instantanés sont quotidiens et par compte', () => {
  it('un instantané porte un compte, une date et une valeur', () => {
    const etat = plier([
      ev('snapshot.recorded', { account_id: 'c1', date: '2026-09-11', valeur_cents: 120000 }),
    ])
    expect(etat.instantanes).toEqual([
      { account_id: 'c1', date: '2026-09-11', valeur_cents: 120000 },
    ])
  })
})

// §4 — Modèle de données ------------------------------------------------------

describe('§4.1 le journal porte tous les types d’événements annoncés', () => {
  it('couvre la liste du contexte', () => {
    const attendus = [
      'account.created',
      'account.updated',
      'account.archived',
      'account.balance_set',
      'transaction.created',
      'transaction.updated',
      'transaction.deleted',
      'transfer.created',
      'subscription.created',
      'subscription.updated',
      'subscription.price_changed',
      'subscription.ended',
      'label.created',
      'label.renamed',
      'label.budget_set',
      'holding.created',
      'holding.updated',
      'snapshot.recorded',
    ]
    for (const type of attendus) {
      expect(TYPES_EVENEMENT).toContain(type)
    }
  })

  it('ajoute ceux que le contexte avait oubliés', () => {
    for (const type of [
      'occurrence.overridden',
      'occurrence.override_cleared',
      'transfer.updated',
      'transfer.deleted',
      'label.archived',
      'account.unarchived',
      'settings.updated',
    ]) {
      expect(TYPES_EVENEMENT).toContain(type)
    }
  })
})

describe('§4.2 l’historique des prix empêche la réécriture du passé', () => {
  it('une hausse ne recalcule pas les échéances passées', () => {
    const historique = [
      { montant_cents: e(9.99), valide_du: d('2025-01-01'), valide_au: d('2026-02-28') },
      { montant_cents: e(12.99), valide_du: d('2026-03-01') },
    ]
    expect(montantValideA(historique, d('2026-02-15'))).toBe(e(9.99))
    expect(montantValideA(historique, d('2026-03-15'))).toBe(e(12.99))
  })
})

// §5 — Règles métier ----------------------------------------------------------

describe('§5.1 projection de solde', () => {
  const echeances = [
    {
      date: d('2026-09-15'),
      montant_cents: e(-300),
      borne_basse_cents: e(-300),
      borne_haute_cents: e(-300),
      estime: false,
    },
    {
      date: d('2026-09-25'),
      montant_cents: e(2000),
      borne_basse_cents: e(1800),
      borne_haute_cents: e(2200),
      estime: true,
    },
  ]
  const projection = projeterSolde({
    soldeActuel: e(1000),
    echeances,
    debut: d('2026-09-11'),
    fin: d('2026-09-30'),
  })

  it('est calculée par compte, jour par jour', () => {
    expect(projection.serie).toHaveLength(20)
    expect(projection.serie[0]!.solde_cents).toBe(e(1000))
  })

  it('rend le point bas et sa date', () => {
    expect(projection.pointBas).toEqual({ date: '2026-09-15', solde_cents: e(700) })
  })

  it('rend la date de la première occurrence estimée', () => {
    expect(projection.premiereEstimation).toBe('2026-09-25')
  })

  it('ne dépend d’aucune estimation avant cette date', () => {
    const veille = projection.serie.find((p) => p.date === '2026-09-24')!
    expect(veille.borne_basse_cents).toBe(veille.solde_cents)
    expect(veille.borne_haute_cents).toBe(veille.solde_cents)
  })

  it('encadre au-delà', () => {
    const apres = projection.serie.at(-1)!
    expect(apres.borne_basse_cents).toBeLessThan(apres.solde_cents)
    expect(apres.borne_haute_cents).toBeGreaterThan(apres.solde_cents)
  })

  it('dit de quoi le chiffre est composé', () => {
    expect(projection.composition).toMatchObject({ echeances: 2, echeancesEstimees: 1 })
  })
})

describe('§5.2 reste à vivre', () => {
  it('utilise la borne basse pour une rentrée estimée, jamais l’estimation centrale', () => {
    const rav = resteAVivre({
      soldeCourant: e(1000),
      echeances: [
        {
          date: d('2026-09-15'),
          montant_cents: e(-100),
          borne_basse_cents: e(-150),
          borne_haute_cents: e(-80),
          estime: true,
        },
        {
          date: d('2026-09-30'),
          montant_cents: e(2000),
          borne_basse_cents: e(1800),
          borne_haute_cents: e(2200),
          estime: true,
        },
      ],
      reserve_cents: e(200),
      depuis: d('2026-09-11'),
    })
    // 1 000 − 150 (la facture au pire) − 200 de réserve.
    expect(rav.montant_cents).toBe(e(650))
    // L'estimation centrale donnerait 50 € de plus : elle reste disponible mais
    // n'est pas ce qu'on lit en gros.
    expect(rav.montant_central_cents).toBe(e(700))
  })

  it('retire la réserve paramétrée', () => {
    const sansReserve = resteAVivre({
      soldeCourant: e(1000),
      echeances: [],
      reserve_cents: e(0),
      depuis: d('2026-09-11'),
    })
    expect(sansReserve.montant_cents).toBe(e(1000))
  })
})

describe('§5.3 décalage jour ouvré', () => {
  it('applique les trois règles', () => {
    const samedi = d('2026-08-01')
    expect(nomDuJour(samedi)).toBe('samedi')
    expect(dateAffichee(samedi, 'exact')).toBe('2026-08-01')
    expect(dateAffichee(samedi, 'jour_ouvre_suivant')).toBe('2026-08-03')
    expect(dateAffichee(samedi, 'jour_ouvre_precedent')).toBe('2026-07-31')
  })

  it('calcule les onze fériés français, Pâques par Meeus', () => {
    expect(joursFeries(2026).size).toBe(11)
    expect(paques(2026)).toBe('2026-04-05')
    const noms = [...joursFeries(2026).values()]
    expect(noms).toContain('Ascension')
    expect(noms).toContain('lundi de Pentecôte')
  })

  it('traite un 1er mai comme non ouvré', () => {
    expect(dateAffichee(d('2026-05-01'), 'jour_ouvre_precedent')).toBe('2026-04-30')
  })
})

describe('§5.4 mois trop court', () => {
  it('ramène au dernier jour par défaut', () => {
    const regle = { frequence: 'mensuel' as const, jour_du_mois: 31, date_debut: d('2026-01-01') }
    expect(occurrencesTheoriques(regle, d('2026-02-01'), d('2026-02-28'))).toEqual(['2026-02-28'])
  })

  it('peut ignorer le mois', () => {
    const regle = {
      frequence: 'mensuel' as const,
      jour_du_mois: 31,
      regle_mois_court: 'ignorer' as const,
      date_debut: d('2026-01-01'),
    }
    expect(occurrencesTheoriques(regle, d('2026-02-01'), d('2026-02-28'))).toEqual([])
  })
})

describe('§5.5 réconciliation hebdomadaire', () => {
  it('écrit l’écart en transaction « Non catégorisé » et recale le solde', () => {
    // Séquence exacte de l'écran : l'écart d'abord, la nouvelle ancre ensuite.
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
          note: 'Non catégorisé',
        },
        2000,
      ),
      ev(
        'account.balance_set',
        { account_id: 'c1', date: '2026-09-11', solde_cents: 115790 },
        2001,
      ),
    ])
    // Le solde est recalé, l'écart n'est pas compté deux fois.
    expect(soldeDuCompte(etat, 'c1', d('2026-09-11'))).toBe(e(1157.9))
    // Et il apparaît bien dans les dépenses du mois.
    const sansLabel = depensesParLabel(etat, '2026-09').find((l) => l.label === null)!
    expect(sansLabel.total_cents).toBe(e(42.1))
  })
})

describe('§5.6 montants estimés et régularisation', () => {
  const historique = [
    { date_theorique: d('2026-04-30'), montant_cents: e(2000) },
    { date_theorique: d('2026-05-30'), montant_cents: e(2050) },
    { date_theorique: d('2026-06-30'), montant_cents: e(1950) },
    { date_theorique: d('2026-07-30'), montant_cents: e(2000) },
    { date_theorique: d('2026-08-30'), montant_cents: e(4000), exclu_de_estimation: true },
  ]

  it('utilise la médiane, pas la moyenne', () => {
    const valeurs = [e(2000), e(2000), e(2050), e(2000), e(1980), e(4000)]
    const moyenne = valeurs.reduce((a, b) => a + b, 0) / valeurs.length
    expect(mediane(valeurs)).toBe(e(2000))
    expect(moyenne).toBeGreaterThan(e(2330))
  })

  it('ignore les occurrences écartées', () => {
    const estimation = estimer(historique, 6)!
    expect(estimation.max).toBe(e(2050))
    expect(estimation.echantillon).toBe(4)
  })

  it('calcule sur ce qui existe si la fenêtre n’est pas remplie', () => {
    const estimation = estimer(historique.slice(0, 2), 6)!
    expect(estimation.echantillon).toBe(2)
    expect(estimation.echantillonIncomplet).toBe(true)
  })

  it('ne rend rien s’il n’existe aucune occurrence réalisée', () => {
    expect(estimer([], 6)).toBeNull()
  })

  it('rend aussi le min et le max, bornes de la projection', () => {
    const estimation = estimer(historique, 6)!
    expect(estimation.min).toBe(e(1950))
    expect(estimation.max).toBe(e(2050))
  })

  it('la régularisation remplace le montant, elle ne crée pas de seconde ligne', () => {
    const recurrence: Recurrence = {
      id: 'salaire',
      libelle: 'Salaire',
      sens: 'rentree',
      montant_mode: 'estime',
      regle: { frequence: 'mensuel', jour_du_mois: 30, date_debut: d('2026-01-30') },
      realisees: historique,
      exceptions: [{ date_theorique: d('2026-09-30'), montant_cents: e(2143), statut: 'realise' }],
    }
    const echeances = echeancesDeLaRecurrence(
      recurrence,
      d('2026-09-01'),
      d('2026-09-30'),
    ).echeances
    expect(echeances).toHaveLength(1)
    expect(echeances[0]!.montant_cents).toBe(e(2143))
  })
})

// §10 — Pièges connus ---------------------------------------------------------

describe('§10 pièges connus', () => {
  it('jamais de flottant sur les montants', () => {
    expect(() => cents(0.1 + 0.2)).toThrow()
    expect(arrondirCents(0.1 + 0.2)).toBe(0)
  })

  it('les virements sortent des totaux de dépenses', () => {
    // Vérifié en §3.5 ; répété ici parce que c'est l'erreur classique du
    // multi-comptes et qu'elle mérite d'échouer deux fois si elle revient.
    const etat = plier([
      ev('account.created', { ...courant }),
      ev('account.created', {
        id: 'c2',
        nom: 'L',
        type: 'livret',
        groupe: 'bancaire',
        mode: 'saisi',
      }),
      ev('transfer.created', {
        id: 'v1',
        date: '2026-09-10',
        from_account_id: 'c1',
        to_account_id: 'c2',
        montant_cents: 50000,
      }),
    ])
    expect(depensesParLabel(etat, '2026-09')).toEqual([])
  })

  it('la casse des labels est normalisée à l’enregistrement', () => {
    const etat = plier([
      ev('label.created', { id: 'l1', nom: 'Courses', couleur: '#fff' }),
      ev('label.created', { id: 'l2', nom: 'COURSES', couleur: '#fff' }),
    ])
    // Deux labels existent, mais leur nom normalisé est identique : l'écran de
    // saisie retrouve le premier et n'en crée pas un troisième.
    const normalises = [...etat.labels.values()].map((l) => l.nom_normalise)
    expect(new Set(normalises).size).toBe(1)
  })

  it('le parsing des montants accepte la virgule du clavier français', () => {
    expect(analyserMontant('12,50')).toBe(e(12.5))
    expect(analyserMontant('12.50')).toBe(e(12.5))
  })

  it('le formatage porte le signe, jamais la couleur seule', () => {
    expect(formaterMontant(e(12.5), { signeExplicite: true })).toMatch(/^\+/)
    expect(formaterMontant(e(-12.5), { signeExplicite: true })).toMatch(/^-/)
  })
})
