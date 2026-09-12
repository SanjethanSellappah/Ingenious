import { describe, expect, it } from 'vitest'
import {
  fusionnerJournaux,
  trierJournal,
  TYPES_EVENEMENT,
  validerEvenement,
  validerEvenements,
  type Evenement,
} from './events'
import { ErreurValidation } from './valider'

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const ID2 = '9a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d'

function evenement(surcharge: Partial<Evenement> = {}): unknown {
  return {
    id: ID,
    ts: 1_757_000_000_000,
    device: 'tel',
    type: 'account.created',
    payload: { id: 'c1', nom: 'Courant', type: 'courant', groupe: 'bancaire', mode: 'saisi' },
    ...surcharge,
  }
}

describe('enveloppe', () => {
  it('accepte un événement bien formé', () => {
    expect(validerEvenement(evenement())).toMatchObject({ id: ID, type: 'account.created' })
  })

  it('refuse un identifiant qui n’est pas un UUID', () => {
    expect(() => validerEvenement(evenement({ id: 'abc' }))).toThrow(/UUID attendu/)
  })

  it('refuse un type inconnu', () => {
    expect(() => validerEvenement(evenement({ type: 'compte.cree' as never }))).toThrow(
      /attendu l'une de/,
    )
  })

  it('refuse un instant absent ou négatif', () => {
    expect(() => validerEvenement(evenement({ ts: undefined as never }))).toThrow(/nombre attendu/)
    expect(() => validerEvenement(evenement({ ts: -1 }))).toThrow(/minimum 0/)
  })

  it('nomme le champ fautif plutôt que d’échouer en bloc', () => {
    try {
      validerEvenement(
        evenement({
          payload: { id: 'c1', nom: 'X', type: 'inconnu', groupe: 'bancaire', mode: 'saisi' },
        }),
      )
      expect.unreachable()
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurValidation)
      expect((erreur as ErreurValidation).chemin).toBe('event.payload.type')
    }
  })

  it('a un validateur pour chaque type déclaré', () => {
    // Un type sans validateur serait accepté sans contrôle : le test garantit
    // que la liste et les validateurs ne divergent pas.
    for (const type of TYPES_EVENEMENT) {
      expect(() => validerEvenement(evenement({ type, payload: {} }))).toThrow()
    }
  })
})

describe('charges utiles', () => {
  it('exige une date civile réelle', () => {
    const payload = { account_id: 'c1', date: '2026-02-31', solde_cents: 1000 }
    expect(() => validerEvenement(evenement({ type: 'account.balance_set', payload }))).toThrow(
      /date civile/,
    )
  })

  it('exige un montant entier', () => {
    const payload = { account_id: 'c1', date: '2026-09-11', solde_cents: 10.5 }
    expect(() => validerEvenement(evenement({ type: 'account.balance_set', payload }))).toThrow(
      /entier sûr/,
    )
  })

  it('refuse un virement de montant nul ou négatif', () => {
    const base = {
      id: 'v1',
      date: '2026-09-11',
      from_account_id: 'a',
      to_account_id: 'b',
      montant_cents: 0,
    }
    expect(() => validerEvenement(evenement({ type: 'transfer.created', payload: base }))).toThrow(
      /minimum 1/,
    )
  })

  it('exige les champs obligatoires à la création d’un abonnement, pas à sa mise à jour', () => {
    const partiel = { id: 'a1', nom: 'Netflix' }
    expect(() =>
      validerEvenement(evenement({ type: 'subscription.created', payload: partiel })),
    ).toThrow(/obligatoire/)
    expect(() =>
      validerEvenement(evenement({ type: 'subscription.updated', payload: partiel })),
    ).not.toThrow()
  })

  it('conserve les champs inconnus plutôt que de les perdre', () => {
    // Un journal écrit par une version plus récente doit traverser une version
    // plus ancienne sans rien perdre : sinon l'aller-retour mutile les données.
    const valide = validerEvenement(
      evenement({
        payload: {
          id: 'c1',
          nom: 'Courant',
          type: 'courant',
          groupe: 'bancaire',
          mode: 'saisi',
          champ_du_futur: { a: 1 },
        },
      }),
    )
    expect(valide.payload.champ_du_futur).toEqual({ a: 1 })
  })
})

describe('lecture par lot', () => {
  it('reprend ce qui est lisible et nomme le reste', () => {
    const lecture = validerEvenements([evenement(), { rien: 'du tout' }, evenement({ id: ID2 })])
    expect(lecture.evenements).toHaveLength(2)
    expect(lecture.rejets).toHaveLength(1)
    expect(lecture.rejets[0]!.index).toBe(1)
    expect(lecture.rejets[0]!.raison).toMatch(/event\[1\]/)
  })
})

describe('tri et fusion', () => {
  const a: Evenement = validerEvenement(evenement({ id: ID, ts: 100 }))
  const b: Evenement = validerEvenement(evenement({ id: ID2, ts: 100 }))
  const c: Evenement = validerEvenement(evenement({ id: ID2, ts: 50 }))

  it('trie par instant puis par identifiant', () => {
    expect(trierJournal([b, a]).map((e) => e.id)).toEqual([ID, ID2])
    expect(trierJournal([a, c]).map((e) => e.ts)).toEqual([50, 100])
  })

  it('fusionne par union sur l’identifiant, sans arbitrage', () => {
    const fusion = fusionnerJournaux([a, b], [b, a])
    expect(fusion).toHaveLength(2)
  })

  it('est idempotente et commutative', () => {
    expect(fusionnerJournaux([a], [b])).toEqual(fusionnerJournaux([b], [a]))
    expect(fusionnerJournaux([a, b], [a, b])).toEqual(fusionnerJournaux([a, b]))
  })
})
