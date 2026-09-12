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

/**
 * L'échec d'écriture est le seul accident invisible.
 *
 * L'écran montre l'état en mémoire, qui a l'air juste, pendant que le disque n'a
 * rien reçu — stockage plein, profil en lecture seule, navigation privée. Sans
 * signal, la saisie disparaît à la fermeture sans un mot.
 */
describe('écriture impossible', () => {
  const depotQuiEchoue = (raison: string) =>
    ({
      ajouterPlusieurs: () => Promise.reject(new Error(raison)),
      chargerTout: () => Promise.resolve({ evenements: [], rejets: [] }),
    }) as never

  it('publie la panne et relance quand même l’erreur', async () => {
    await brancherDepot(depotQuiEchoue('QuotaExceededError'))
    expect(lire().panneEcriture).toBeNull()

    await expect(
      ecrire([{ type: 'label.created', payload: { id: 'l1', nom: 'X', couleur: '#fff' } }]),
    ).rejects.toThrow('QuotaExceededError')

    // Publiée : le bandeau la montre sur tous les écrans.
    expect(lire().panneEcriture).toContain('QuotaExceededError')
    // Et relancée : un écran qui sait quoi en dire le dit encore.
  })

  it('efface la panne dès qu’une écriture aboutit', async () => {
    await brancherDepot(depotQuiEchoue('disque plein'))
    await expect(
      ecrire([{ type: 'label.created', payload: { id: 'l1', nom: 'X', couleur: '#fff' } }]),
    ).rejects.toThrow()
    expect(lire().panneEcriture).not.toBeNull()

    const base = ouvrirBase(`panne-${Date.now()}`)
    await brancherDepot(await ouvrirDepot({ base }))
    await ecrire([{ type: 'label.created', payload: { id: 'l1', nom: 'X', couleur: '#fff' } }])
    expect(lire().panneEcriture).toBeNull()
  })

  it('ne perd pas la panne lors d’une relecture', async () => {
    const base = ouvrirBase(`panne-relecture-${Date.now()}`)
    await brancherDepot(await ouvrirDepot({ base }))
    await ecrire([{ type: 'label.created', payload: { id: 'l1', nom: 'X', couleur: '#fff' } }])

    await brancherDepot(depotQuiEchoue('quota'))
    await expect(
      ecrire([{ type: 'label.created', payload: { id: 'l2', nom: 'Y', couleur: '#fff' } }]),
    ).rejects.toThrow()
    const panne = lire().panneEcriture
    expect(panne).not.toBeNull()

    // Une relecture n'est pas une réussite d'écriture : le disque refuse toujours.
    await recharger()
    expect(lire().panneEcriture).toBe(panne)
  })
})
