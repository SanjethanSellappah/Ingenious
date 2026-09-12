import { describe, expect, it } from 'vitest'
import { dateCivile, nomDuJour } from './civilDate'
import {
  dateAffichee,
  occurrences,
  occurrencesTheoriques,
  preparerRegle,
  prochainesOccurrences,
  type RegleRecurrence,
} from './recurrence'

const d = dateCivile

/** Règle mensuelle au 5, sans décalage, démarrée le 1er janvier 2026. */
function mensuelleAu(jour: number, surcharge: Partial<RegleRecurrence> = {}): RegleRecurrence {
  return {
    frequence: 'mensuel',
    jour_du_mois: jour,
    date_debut: d('2026-01-01'),
    ...surcharge,
  }
}

const theoriques = (regle: RegleRecurrence, debut: string, fin: string) =>
  occurrencesTheoriques(regle, d(debut), d(fin))

const affichees = (regle: RegleRecurrence, debut: string, fin: string) =>
  occurrences(regle, d(debut), d(fin)).map((o) => o.date_affichee)

describe('préparation de la règle', () => {
  it('reprend le quantième de la date de début quand il n’est pas donné', () => {
    const regle = preparerRegle({ frequence: 'mensuel', date_debut: d('2026-01-17') })
    expect(regle.jour_du_mois).toBe(17)
  })

  it('applique les défauts du contexte', () => {
    const regle = preparerRegle(mensuelleAu(5))
    expect(regle.intervalle).toBe(1)
    expect(regle.regle_mois_court).toBe('dernier_jour')
    expect(regle.regle_weekend).toBe('exact')
  })

  it('refuse une règle incohérente', () => {
    expect(() => preparerRegle(mensuelleAu(0))).toThrow(/Jour du mois/)
    expect(() => preparerRegle(mensuelleAu(32))).toThrow(/Jour du mois/)
    expect(() => preparerRegle(mensuelleAu(5, { intervalle: 0 }))).toThrow(/Intervalle/)
    expect(() => preparerRegle(mensuelleAu(5, { intervalle: 1.5 }))).toThrow(/Intervalle/)
    expect(() => preparerRegle(mensuelleAu(5, { date_fin: d('2025-12-01') }))).toThrow(/antérieure/)
  })
})

describe('périodicité', () => {
  it('mensuel', () => {
    expect(theoriques(mensuelleAu(5), '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-05',
      '2026-02-05',
      '2026-03-05',
      '2026-04-05',
    ])
  })

  it('mensuel avec intervalle 2', () => {
    expect(theoriques(mensuelleAu(5, { intervalle: 2 }), '2026-01-01', '2026-07-31')).toEqual([
      '2026-01-05',
      '2026-03-05',
      '2026-05-05',
      '2026-07-05',
    ])
  })

  it('trimestriel', () => {
    expect(
      theoriques({ ...mensuelleAu(15), frequence: 'trimestriel' }, '2026-01-01', '2026-12-31'),
    ).toEqual(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'])
  })

  it('annuel, ancré sur le mois de la date de début', () => {
    const regle: RegleRecurrence = {
      frequence: 'annuel',
      jour_du_mois: 15,
      date_debut: d('2026-09-01'),
    }
    expect(theoriques(regle, '2026-01-01', '2029-12-31')).toEqual([
      '2026-09-15',
      '2027-09-15',
      '2028-09-15',
      '2029-09-15',
    ])
  })

  it('personnalisé en jours', () => {
    const regle: RegleRecurrence = {
      frequence: 'personnalise',
      unite_intervalle: 'jour',
      intervalle: 10,
      date_debut: d('2026-01-01'),
    }
    expect(theoriques(regle, '2026-01-01', '2026-02-01')).toEqual([
      '2026-01-01',
      '2026-01-11',
      '2026-01-21',
      '2026-01-31',
    ])
  })

  it('personnalisé en semaines', () => {
    const regle: RegleRecurrence = {
      frequence: 'personnalise',
      unite_intervalle: 'semaine',
      intervalle: 2,
      date_debut: d('2026-01-02'),
    }
    expect(theoriques(regle, '2026-01-01', '2026-02-28')).toEqual([
      '2026-01-02',
      '2026-01-16',
      '2026-01-30',
      '2026-02-13',
      '2026-02-27',
    ])
  })

  it('ne rend rien avant la date de début ni après la date de fin', () => {
    const regle = mensuelleAu(5, { date_debut: d('2026-03-10'), date_fin: d('2026-06-30') })
    expect(theoriques(regle, '2026-01-01', '2026-12-31')).toEqual([
      '2026-04-05',
      '2026-05-05',
      '2026-06-05',
    ])
  })

  it('ne dérive pas sur dix ans — chaque occurrence repart de l’ancre', () => {
    const dates = theoriques(mensuelleAu(31), '2026-01-01', '2036-01-31')
    // 121 mois, chacun ramené au dernier jour quand il le faut, jamais rogné en cascade.
    expect(dates).toHaveLength(121)
    // Sept mois de 31 jours par an, plus janvier 2036 : le quantième est toujours
    // retrouvé, alors que des additions successives l'auraient perdu dès mars 2026.
    expect(dates.filter((x) => x.endsWith('-31'))).toHaveLength(7 * 10 + 1)
    expect(dates[dates.length - 1]).toBe('2036-01-31')
  })
})

describe('mois trop court', () => {
  it('ramène au dernier jour par défaut', () => {
    expect(theoriques(mensuelleAu(31), '2026-01-01', '2026-06-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ])
  })

  it('tient compte de l’année bissextile', () => {
    expect(theoriques(mensuelleAu(31), '2028-02-01', '2028-02-29')).toEqual(['2028-02-29'])
  })

  it('saute le mois quand la règle est « ignorer »', () => {
    const regle = mensuelleAu(31, { regle_mois_court: 'ignorer' })
    expect(theoriques(regle, '2026-01-01', '2026-06-30')).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ])
  })

  it('un 30 saute février mais pas avril', () => {
    const regle = mensuelleAu(30, { regle_mois_court: 'ignorer' })
    expect(theoriques(regle, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-30',
      '2026-03-30',
      '2026-04-30',
    ])
  })
})

describe('décalage jour ouvré', () => {
  it('laisse la date théorique intacte', () => {
    const regle = mensuelleAu(1, { regle_weekend: 'jour_ouvre_suivant' })
    const aout = occurrences(regle, d('2026-07-25'), d('2026-08-10'))[0]!
    expect(aout.date_theorique).toBe('2026-08-01') // samedi
    expect(aout.date_affichee).toBe('2026-08-03') // lundi
  })

  it('applique les trois règles sur un samedi', () => {
    const samedi = d('2026-08-01')
    expect(nomDuJour(samedi)).toBe('samedi')
    expect(dateAffichee(samedi, 'exact')).toBe('2026-08-01')
    expect(dateAffichee(samedi, 'jour_ouvre_suivant')).toBe('2026-08-03')
    expect(dateAffichee(samedi, 'jour_ouvre_precedent')).toBe('2026-07-31')
  })

  it('applique les trois règles sur un dimanche', () => {
    const dimanche = d('2026-08-02')
    expect(dateAffichee(dimanche, 'exact')).toBe('2026-08-02')
    expect(dateAffichee(dimanche, 'jour_ouvre_suivant')).toBe('2026-08-03')
    expect(dateAffichee(dimanche, 'jour_ouvre_precedent')).toBe('2026-07-31')
  })

  it('traite un 1er mai comme un jour non ouvré', () => {
    // Vendredi 1er mai 2026, férié : le suivant est le lundi 4.
    const feriee = d('2026-05-01')
    expect(dateAffichee(feriee, 'exact')).toBe('2026-05-01')
    expect(dateAffichee(feriee, 'jour_ouvre_suivant')).toBe('2026-05-04')
    expect(dateAffichee(feriee, 'jour_ouvre_precedent')).toBe('2026-04-30')
  })

  it('fait changer de mois au décalage, sans changer la règle', () => {
    // Théorique le 1er août 2026 (samedi), reculé au 31 juillet : l'échéance
    // appartient à juillet pour le solde, et reste « le 1er » pour la règle.
    const regle = mensuelleAu(1, { regle_weekend: 'jour_ouvre_precedent' })
    const juillet = occurrences(regle, d('2026-07-01'), d('2026-07-31'))
    expect(juillet.map((o) => [o.date_theorique, o.date_affichee])).toEqual([
      ['2026-07-01', '2026-07-01'],
      ['2026-08-01', '2026-07-31'],
    ])
    // Et août ne la compte pas deux fois : son échéance est partie en juillet,
    // et celle de septembre (mardi 1er) ne recule pas. Août n'a donc rien.
    expect(affichees(regle, '2026-08-01', '2026-08-31')).toEqual([])
  })

  it('trie sur la date réelle, pas sur la théorique', () => {
    const regle = mensuelleAu(1, { regle_weekend: 'jour_ouvre_precedent' })
    const dates = affichees(regle, '2026-01-01', '2026-12-31')
    expect([...dates].sort()).toEqual(dates)
  })
})

describe('prochaines occurrences', () => {
  it('rend l’aperçu du formulaire, dates décalées comprises', () => {
    const regle = mensuelleAu(1, { regle_weekend: 'jour_ouvre_suivant' })
    expect(prochainesOccurrences(regle, d('2026-07-15'), 3)).toEqual([
      { date_theorique: '2026-08-01', date_affichee: '2026-08-03' },
      { date_theorique: '2026-09-01', date_affichee: '2026-09-01' },
      { date_theorique: '2026-10-01', date_affichee: '2026-10-01' },
    ])
  })

  it('va chercher loin pour une règle annuelle', () => {
    const regle: RegleRecurrence = {
      frequence: 'annuel',
      jour_du_mois: 15,
      date_debut: d('2026-10-15'),
    }
    expect(prochainesOccurrences(regle, d('2026-01-01'), 3).map((o) => o.date_affichee)).toEqual([
      '2026-10-15',
      '2027-10-15',
      // Le 15 octobre 2028 est un dimanche, mais la règle est `exact` : il ne bouge pas.
      '2028-10-15',
    ])
  })

  it('s’arrête à la date de fin', () => {
    const regle = mensuelleAu(5, { date_fin: d('2026-03-31') })
    expect(prochainesOccurrences(regle, d('2026-01-01'), 10)).toHaveLength(3)
  })

  it('rend une liste vide pour un compte à rebours nul', () => {
    expect(prochainesOccurrences(mensuelleAu(5), d('2026-01-01'), 0)).toEqual([])
  })
})
