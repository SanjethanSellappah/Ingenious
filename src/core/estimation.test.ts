import { describe, expect, it } from 'vitest'
import { dateCivile } from './civilDate'
import {
  estimer,
  mediane,
  resoudreMontant,
  type Exception,
  type OccurrenceRealisee,
} from './estimation'
import { cents } from './money'

const d = dateCivile

function realisee(date: string, euros: number, exclu = false): OccurrenceRealisee {
  const o: OccurrenceRealisee = { date_theorique: d(date), montant_cents: cents(euros * 100) }
  if (exclu) o.exclu_de_estimation = true
  return o
}

describe('médiane', () => {
  it('prend la valeur centrale d’une série impaire', () => {
    expect(mediane([cents(100), cents(300), cents(200)])).toBe(200)
  })

  it('moyenne les deux valeurs centrales d’une série paire, arrondies au centime', () => {
    expect(mediane([cents(100), cents(201)])).toBe(151) // 150,5 → 151
    expect(mediane([cents(100), cents(200), cents(300), cents(400)])).toBe(250)
  })

  it('refuse une série vide', () => {
    expect(() => mediane([])).toThrow(/vide/)
  })

  it('absorbe une valeur extrême là où la moyenne dérape', () => {
    // Six mois de salaire dont un treizième mois.
    const valeurs = [2000, 2000, 2050, 2000, 1980, 4000].map((e) => cents(e * 100))
    const moyenne = valeurs.reduce((a, b) => a + b, 0) / valeurs.length
    expect(mediane(valeurs)).toBe(200000) // 2 000 €
    expect(moyenne).toBeGreaterThan(233000) // la moyenne promet 2 330 €
  })
})

describe('estimation sur fenêtre glissante', () => {
  const historique = [
    realisee('2026-01-05', 2000),
    realisee('2026-02-05', 2100),
    realisee('2026-03-05', 1950),
    realisee('2026-04-05', 2050),
    realisee('2026-05-05', 2000),
    realisee('2026-06-05', 2020),
    realisee('2025-12-05', 1500), // hors fenêtre de 6
  ]

  it('retient les occurrences les plus récentes', () => {
    const estimation = estimer(historique, 6)!
    expect(estimation.echantillon).toBe(6)
    expect(estimation.min).toBe(195000)
    expect(estimation.max).toBe(210000)
    expect(estimation.echantillonIncomplet).toBe(false)
  })

  it('ignore les occurrences mises à l’écart', () => {
    const avecPrime = [...historique.slice(0, 6), realisee('2026-07-05', 4000, true)]
    const estimation = estimer(avecPrime, 6)!
    expect(estimation.max).toBe(210000) // la prime de 4 000 € n'entre pas
    expect(estimation.echantillon).toBe(6)
  })

  it('calcule sur ce qui existe quand la fenêtre n’est pas remplie', () => {
    const estimation = estimer([realisee('2026-01-05', 2000), realisee('2026-02-05', 1800)], 6)!
    expect(estimation.echantillon).toBe(2)
    expect(estimation.echantillonIncomplet).toBe(true)
    expect(estimation.mediane).toBe(190000)
  })

  it('ne rend rien quand il n’y a aucun historique — c’est à l’utilisateur de saisir', () => {
    expect(estimer([], 6)).toBeNull()
    expect(estimer([realisee('2026-01-05', 2000, true)], 6)).toBeNull()
  })

  it('refuse une fenêtre absurde', () => {
    expect(() => estimer(historique, 0)).toThrow(/Fenêtre/)
    expect(() => estimer(historique, 2.5)).toThrow(/Fenêtre/)
  })
})

describe('résolution du montant d’une occurrence', () => {
  const estimation = estimer(
    [realisee('2026-01-05', 1900), realisee('2026-02-05', 2000), realisee('2026-03-05', 2200)],
    6,
  )

  function exception(statut: 'realise' | 'previsionnel', euros: number): Exception {
    return { date_theorique: d('2026-04-05'), montant_cents: cents(euros * 100), statut }
  }

  it('le réalisé gagne sur tout le reste', () => {
    const resolu = resoudreMontant({
      exception: exception('realise', 2150),
      estimation,
      montantFixe: cents(100000),
      sens: 'rentree',
    })!
    expect(resolu.origine).toBe('realise')
    expect(resolu.montant_cents).toBe(215000)
    expect(resolu.estime).toBe(false)
    expect(resolu.borne_basse_cents).toBe(resolu.borne_haute_cents)
  })

  it('le prévisionnel saisi gagne sur l’estimation', () => {
    const resolu = resoudreMontant({
      exception: exception('previsionnel', 1800),
      estimation,
      sens: 'rentree',
    })!
    expect(resolu.origine).toBe('previsionnel')
    expect(resolu.montant_cents).toBe(180000)
  })

  it('retombe sur l’estimation, avec ses bornes', () => {
    const resolu = resoudreMontant({ estimation, sens: 'rentree' })!
    expect(resolu.origine).toBe('estimation')
    expect(resolu.estime).toBe(true)
    expect(resolu.montant_cents).toBe(200000)
    expect(resolu.borne_basse_cents).toBe(190000)
    expect(resolu.borne_haute_cents).toBe(220000)
  })

  it('porte une dépense en négatif, bornes comprises', () => {
    const resolu = resoudreMontant({ estimation, sens: 'depense' })!
    expect(resolu.montant_cents).toBe(-200000)
    // La borne basse reste la plus petite valeur signée : pour une dépense,
    // c'est la plus grosse facture. Aucun traitement séparé selon le sens.
    expect(resolu.borne_basse_cents).toBe(-220000)
    expect(resolu.borne_haute_cents).toBe(-190000)
  })

  it('un montant fixe n’a pas de fourchette', () => {
    const resolu = resoudreMontant({ montantFixe: cents(1299), sens: 'depense' })!
    expect(resolu.origine).toBe('fixe')
    expect(resolu.montant_cents).toBe(-1299)
    expect(resolu.borne_basse_cents).toBe(-1299)
    expect(resolu.borne_haute_cents).toBe(-1299)
  })

  it('ne résout rien quand il n’y a ni montant, ni exception, ni historique', () => {
    expect(resoudreMontant({ estimation: null, sens: 'rentree' })).toBeNull()
  })

  it('normalise un montant saisi avec le mauvais signe', () => {
    const resolu = resoudreMontant({ montantFixe: cents(-1299), sens: 'depense' })!
    expect(resolu.montant_cents).toBe(-1299)
  })
})
