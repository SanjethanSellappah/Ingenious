import { describe, expect, it } from 'vitest'
import { dateCivile } from './civilDate'
import { cents } from './money'
import {
  dernierChangement,
  montantValideA,
  tarifChangeEntre,
  type PrixAbonnement,
} from './prixAbonnement'

const d = dateCivile

// Un abonnement à 9,99 € passé à 12,99 € le 1er mars 2026.
const historique: PrixAbonnement[] = [
  { montant_cents: cents(999), valide_du: d('2025-01-01'), valide_au: d('2026-02-28') },
  { montant_cents: cents(1299), valide_du: d('2026-03-01') },
]

describe('montant valide à une date', () => {
  it('rend l’ancien tarif avant le changement', () => {
    expect(montantValideA(historique, d('2026-02-05'))).toBe(999)
    expect(montantValideA(historique, d('2026-02-28'))).toBe(999)
  })

  it('rend le nouveau tarif à partir du changement', () => {
    expect(montantValideA(historique, d('2026-03-01'))).toBe(1299)
    expect(montantValideA(historique, d('2026-12-05'))).toBe(1299)
  })

  it('ne réécrit pas le passé — l’échéance de février reste à l’ancien tarif', () => {
    // C'est tout l'objet du module : la hausse du 1er mars ne doit pas
    // recalculer la dépense de février.
    const echeancesParDate = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05'].map((x) =>
      montantValideA(historique, d(x)),
    )
    expect(echeancesParDate).toEqual([999, 999, 1299, 1299])
  })

  it('rend null avant toute période connue', () => {
    expect(montantValideA(historique, d('2024-06-01'))).toBeNull()
  })

  it('rend null après une période close sans successeur', () => {
    const close: PrixAbonnement[] = [
      { montant_cents: cents(999), valide_du: d('2025-01-01'), valide_au: d('2025-12-31') },
    ]
    expect(montantValideA(close, d('2026-01-01'))).toBeNull()
  })

  it('tranche un chevauchement par la période la plus récemment ouverte', () => {
    const chevauchant: PrixAbonnement[] = [
      { montant_cents: cents(999), valide_du: d('2025-01-01') }, // jamais close
      { montant_cents: cents(1299), valide_du: d('2026-03-01') },
    ]
    expect(montantValideA(chevauchant, d('2026-06-01'))).toBe(1299)
  })

  it('ne dépend pas de l’ordre de la liste', () => {
    expect(montantValideA([...historique].reverse(), d('2026-02-05'))).toBe(999)
  })

  it('rend null sur un historique vide', () => {
    expect(montantValideA([], d('2026-02-05'))).toBeNull()
  })
})

describe('détection de changement', () => {
  it('repère une hausse dans la période', () => {
    expect(tarifChangeEntre(historique, d('2026-02-01'), d('2026-03-31'))).toBe(true)
    expect(tarifChangeEntre(historique, d('2026-04-01'), d('2026-06-30'))).toBe(false)
  })

  it('donne le dernier tarif décidé', () => {
    expect(dernierChangement(historique)?.montant_cents).toBe(1299)
    expect(dernierChangement([])).toBeNull()
  })
})
