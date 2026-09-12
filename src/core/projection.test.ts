import { describe, expect, it } from 'vitest'
import { dateCivile } from './civilDate'
import { cents, type Cents } from './money'
import {
  premierJourSous,
  premierJourSousPessimiste,
  projeterSolde,
  projeterSurJours,
  type EcheanceProjetee,
} from './projection'

const d = dateCivile
const e = (euros: number): Cents => cents(Math.round(euros * 100))

/** Échéance certaine : les trois montants sont confondus. */
function certaine(date: string, euros: number, libelle = 'échéance'): EcheanceProjetee {
  const montant = e(euros)
  return {
    date: d(date),
    montant_cents: montant,
    borne_basse_cents: montant,
    borne_haute_cents: montant,
    estime: false,
    libelle,
  }
}

/** Échéance estimée : centrale, plus une fourchette signée. */
function estimee(date: string, centrale: number, min: number, max: number): EcheanceProjetee {
  return {
    date: d(date),
    montant_cents: e(centrale),
    borne_basse_cents: e(Math.min(min, max)),
    borne_haute_cents: e(Math.max(min, max)),
    estime: true,
    libelle: 'salaire',
  }
}

const debut = d('2026-09-01')

describe('série', () => {
  it('démarre au solde connu, sans rien y ajouter', () => {
    const p = projeterSolde({ soldeActuel: e(1000), echeances: [], debut, fin: d('2026-09-05') })
    expect(p.serie).toHaveLength(5)
    expect(p.serie[0]).toMatchObject({ date: '2026-09-01', solde_cents: 100000 })
    expect(p.serie.at(-1)!.solde_cents).toBe(100000)
  })

  it('applique une échéance le jour où l’argent bouge', () => {
    const p = projeterSolde({
      soldeActuel: e(1000),
      echeances: [certaine('2026-09-03', -200)],
      debut,
      fin: d('2026-09-04'),
    })
    expect(p.serie.map((x) => x.solde_cents)).toEqual([100000, 100000, 80000, 80000])
  })

  it('cumule plusieurs échéances le même jour', () => {
    const p = projeterSolde({
      soldeActuel: e(1000),
      echeances: [certaine('2026-09-02', -200), certaine('2026-09-02', -50)],
      debut,
      fin: d('2026-09-02'),
    })
    expect(p.serie.at(-1)!.solde_cents).toBe(75000)
  })

  it('ignore une échéance hors fenêtre', () => {
    const p = projeterSolde({
      soldeActuel: e(1000),
      echeances: [certaine('2026-10-15', -200)],
      debut,
      fin: d('2026-09-30'),
    })
    expect(p.serie.at(-1)!.solde_cents).toBe(100000)
    expect(p.composition.echeances).toBe(0)
  })

  it('refuse une fenêtre inversée ou démesurée', () => {
    expect(() =>
      projeterSolde({ soldeActuel: e(0), echeances: [], debut, fin: d('2026-08-01') }),
    ).toThrow(/antérieure/)
    expect(() =>
      projeterSolde({ soldeActuel: e(0), echeances: [], debut, fin: d('2050-01-01') }),
    ).toThrow(/maximum/)
  })
})

describe('échéances déjà échues', () => {
  it('ne les compte pas dans le solde, mais les rend pour que l’écran les réclame', () => {
    // Le prélèvement du 1er n'a pas été confirmé : l'application ne sait pas
    // s'il est passé en banque. L'ajouter serait inventer.
    const p = projeterSolde({
      soldeActuel: e(1000),
      echeances: [
        certaine('2026-08-28', -300),
        certaine('2026-09-01', -100),
        certaine('2026-09-05', -50),
      ],
      debut,
      fin: d('2026-09-10'),
    })
    expect(p.serie[0]!.solde_cents).toBe(100000)
    expect(p.composition.echeancesEchues).toHaveLength(2)
    expect(p.composition.echeances).toBe(1)
    expect(p.serie.at(-1)!.solde_cents).toBe(95000)
  })
})

describe('frontière de certitude', () => {
  const echeances = [
    certaine('2026-09-05', -300),
    estimee('2026-09-25', 2000, 1800, 2200),
    certaine('2026-09-28', -120),
  ]

  it('confond les bornes tant qu’aucune estimation n’a été franchie', () => {
    const p = projeterSolde({ soldeActuel: e(1000), echeances, debut, fin: d('2026-09-30') })
    const avant = p.serie.find((x) => x.date === '2026-09-24')!
    expect(avant.incertain).toBe(false)
    expect(avant.borne_basse_cents).toBe(avant.solde_cents)
    expect(avant.borne_haute_cents).toBe(avant.solde_cents)
  })

  it('écarte les bornes à partir de la première estimation', () => {
    const p = projeterSolde({ soldeActuel: e(1000), echeances, debut, fin: d('2026-09-30') })
    const apres = p.serie.find((x) => x.date === '2026-09-26')!
    expect(apres.incertain).toBe(true)
    expect(apres.solde_cents).toBe(270000) // 1000 − 300 + 2000
    expect(apres.borne_basse_cents).toBe(250000) // avec le salaire le plus maigre
    expect(apres.borne_haute_cents).toBe(290000)
  })

  it('annonce la date de la première estimation', () => {
    const p = projeterSolde({ soldeActuel: e(1000), echeances, debut, fin: d('2026-09-30') })
    expect(p.premiereEstimation).toBe('2026-09-25')
  })

  it('n’annonce aucune estimation quand tout est certain', () => {
    const p = projeterSolde({
      soldeActuel: e(1000),
      echeances: [certaine('2026-09-05', -300)],
      debut,
      fin: d('2026-09-30'),
    })
    expect(p.premiereEstimation).toBeNull()
    expect(p.serie.every((x) => !x.incertain)).toBe(true)
  })

  it('accumule l’incertitude de plusieurs estimations', () => {
    const p = projeterSolde({
      soldeActuel: e(0),
      echeances: [estimee('2026-09-10', -100, -150, -80), estimee('2026-09-20', -100, -150, -80)],
      debut,
      fin: d('2026-09-30'),
    })
    expect(p.serie.at(-1)!.solde_cents).toBe(-20000)
    expect(p.serie.at(-1)!.borne_basse_cents).toBe(-30000)
    expect(p.serie.at(-1)!.borne_haute_cents).toBe(-16000)
  })
})

describe('point bas', () => {
  it('trouve le creux et sa date', () => {
    const p = projeterSolde({
      soldeActuel: e(1000),
      echeances: [certaine('2026-09-05', -900), certaine('2026-09-20', 1500)],
      debut,
      fin: d('2026-09-30'),
    })
    expect(p.pointBas).toEqual({ date: '2026-09-05', solde_cents: 10000 })
  })

  it('garde la première date en cas d’égalité — c’est elle qui alerte le plus tôt', () => {
    const p = projeterSolde({
      soldeActuel: e(1000),
      echeances: [
        certaine('2026-09-05', -900),
        certaine('2026-09-10', 900),
        certaine('2026-09-15', -900),
      ],
      debut,
      fin: d('2026-09-30'),
    })
    expect(p.pointBas.date).toBe('2026-09-05')
  })

  it('distingue le point bas pessimiste du point bas central', () => {
    const p = projeterSolde({
      soldeActuel: e(1000),
      echeances: [estimee('2026-09-10', -900, -1100, -800)],
      debut,
      fin: d('2026-09-30'),
    })
    expect(p.pointBas.solde_cents).toBe(10000)
    expect(p.pointBasPessimiste.solde_cents).toBe(-10000)
    // La trajectoire centrale reste positive, la pessimiste passe en négatif :
    // c'est la seconde qui doit déclencher l'alerte.
    expect(p.pointBas.solde_cents).toBeGreaterThan(0)
    expect(p.pointBasPessimiste.solde_cents).toBeLessThan(0)
  })

  it('vaut le solde de départ quand rien ne bouge', () => {
    const p = projeterSolde({ soldeActuel: e(500), echeances: [], debut, fin: d('2026-09-10') })
    expect(p.pointBas).toEqual({ date: '2026-09-01', solde_cents: 50000 })
  })
})

describe('composition', () => {
  it('dit de quoi le chiffre est fait', () => {
    const p = projeterSolde({
      soldeActuel: e(1000),
      echeances: [
        certaine('2026-09-05', -300),
        certaine('2026-09-12', -60),
        estimee('2026-09-25', 2000, 1800, 2200),
      ],
      debut,
      fin: d('2026-09-30'),
    })
    expect(p.composition.echeances).toBe(3)
    expect(p.composition.echeancesEstimees).toBe(1)
  })
})

describe('seuils', () => {
  const p = projeterSolde({
    soldeActuel: e(1000),
    echeances: [estimee('2026-09-10', -900, -1100, -800)],
    debut,
    fin: d('2026-09-30'),
  })

  it('trouve le premier jour sous un seuil', () => {
    expect(premierJourSous(p, e(200))).toBe('2026-09-10')
    expect(premierJourSous(p, e(0))).toBeNull()
  })

  it('alerte plus tôt sur la trajectoire pessimiste', () => {
    expect(premierJourSousPessimiste(p, e(0))).toBe('2026-09-10')
  })
})

describe('projection sur un nombre de jours', () => {
  it('compte le jour de départ comme premier point', () => {
    const p = projeterSurJours({ soldeActuel: e(100), echeances: [], debut, nombreDeJours: 30 })
    expect(p.serie).toHaveLength(31)
    expect(p.serie.at(-1)!.date).toBe('2026-10-01')
  })
})
