import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { ouvrirBase } from '../storage/db'
import { ouvrirDepot } from '../storage/repository'
import { brancherDepot, ecrire, lire, recharger, reinitialiserMagasin } from './magasin'

let compteur = 0

beforeEach(async () => {
  reinitialiserMagasin()
  await brancherDepot(await ouvrirDepot({ base: ouvrirBase(`magasin-${compteur++}`) }))
})

describe('chargement', () => {
  it('n’est vrai qu’avant la toute première lecture', () => {
    expect(lire().chargement).toBe(false)
  })

  it('une relecture ne vide pas l’écran', async () => {
    // `chargement` fait disparaître l'écran entier. S'il repassait à vrai après
    // un import, l'écran des réglages serait démonté et le message annonçant le
    // résultat serait perdu au moment précis où il compte.
    await recharger()
    expect(lire().chargement).toBe(false)
    expect(lire().relecture).toBe(false)
  })
})

describe('écriture', () => {
  it('replie immédiatement ce qui vient d’être écrit', async () => {
    await ecrire([
      {
        type: 'account.created',
        payload: { id: 'c1', nom: 'Courant', type: 'courant', groupe: 'bancaire', mode: 'saisi' },
      },
    ])
    expect(lire().etat.comptes.get('c1')?.nom).toBe('Courant')
    expect(lire().journal).toHaveLength(1)
  })

  it('garde l’ordre d’une même passe', async () => {
    const ecrits = await ecrire([
      { type: 'account.unarchived', payload: { id: 'a' } },
      { type: 'account.unarchived', payload: { id: 'b' } },
    ])
    expect(ecrits[0]!.ts).toBeLessThan(ecrits[1]!.ts)
  })
})
