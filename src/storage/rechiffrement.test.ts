import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { chiffreurCoffre, chiffreurIdentite, creerCoffre } from './crypto'
import { ouvrirBase } from './db'
import { ouvrirDepot, rechiffrerJournal } from './repository'

const TOURS = 1000
let compteur = 0

const compte = {
  id: 'c1',
  nom: 'Courant',
  type: 'courant',
  groupe: 'bancaire',
  mode: 'saisi',
} as const

describe('configuration d’un PIN après coup', () => {
  it('rend les données écrites en clair illisibles si on ne les rechiffre pas', async () => {
    // Ce test décrit le piège, pour qu'il ne revienne jamais : un journal écrit
    // sans PIN puis relu avec un chiffreur actif est entièrement rejeté.
    const base = ouvrirBase(`rechiffre-${compteur++}`)
    const avant = await ouvrirDepot({ base, chiffreur: chiffreurIdentite() })
    await avant.ajouter('account.created', { ...compte })

    const coffre = await creerCoffre('123456', TOURS)
    const apres = await ouvrirDepot({ base, chiffreur: chiffreurCoffre(coffre) })
    const { evenements, rejets } = await apres.chargerTout()

    expect(evenements).toHaveLength(0)
    expect(rejets[0]!.raison).toMatch(/non chiffré/)
  })

  it('rechiffrer le journal rend tout lisible', async () => {
    const base = ouvrirBase(`rechiffre-${compteur++}`)
    const identite = chiffreurIdentite()
    const avant = await ouvrirDepot({ base, chiffreur: identite })
    await avant.ajouter('account.created', { ...compte })
    await avant.ajouter('account.balance_set', {
      account_id: 'c1',
      date: '2026-09-11',
      solde_cents: 120000,
    })
    const reference = (await avant.chargerTout()).evenements

    const coffre = await creerCoffre('123456', TOURS)
    const chiffreur = chiffreurCoffre(coffre)
    const resultat = await rechiffrerJournal(base, identite, chiffreur)
    expect(resultat).toMatchObject({ rechiffres: 2, rejets: [] })

    const apres = await ouvrirDepot({ base, chiffreur })
    const { evenements, rejets } = await apres.chargerTout()
    expect(rejets).toEqual([])
    expect(evenements).toEqual(reference)

    // Et plus rien n'est lisible en clair dans la base.
    const brut = JSON.stringify(await base.events.toArray())
    expect(brut).not.toContain('account.created')
  })

  it('conserve l’identifiant de chaque événement', async () => {
    const base = ouvrirBase(`rechiffre-${compteur++}`)
    const identite = chiffreurIdentite()
    const depot = await ouvrirDepot({ base, chiffreur: identite })
    await depot.ajouter('account.created', { ...compte })
    const idsAvant = (await base.events.toArray()).map((x) => x.id).sort()

    const coffre = await creerCoffre('123456', TOURS)
    await rechiffrerJournal(base, identite, chiffreurCoffre(coffre))
    // L'identifiant reste en clair : c'est la clé de fusion entre appareils.
    expect((await base.events.toArray()).map((x) => x.id).sort()).toEqual(idsAvant)
  })

  it('signale un enregistrement illisible sans le remplacer par du vide', async () => {
    const base = ouvrirBase(`rechiffre-${compteur++}`)
    const identite = chiffreurIdentite()
    const depot = await ouvrirDepot({ base, chiffreur: identite })
    await depot.ajouter('account.created', { ...compte })
    // Un enregistrement chiffré traîne dans une base en clair.
    await base.events.put({ id: 'corrompu', donnees: { iv_b64: 'AAAA', donnees_b64: 'AAAA' } })

    const coffre = await creerCoffre('123456', TOURS)
    const resultat = await rechiffrerJournal(base, identite, chiffreurCoffre(coffre))
    // Le chiffreur identité laisse tout passer : c'est la validation qui rejette
    // ensuite. Ici, les deux enregistrements sont réécrits, et le corrompu sera
    // signalé à la lecture plutôt que supprimé.
    expect(resultat.rechiffres).toBe(2)
    expect(await base.events.count()).toBe(2)
  })

  it('traite un gros journal par lots', async () => {
    const base = ouvrirBase(`rechiffre-${compteur++}`)
    const identite = chiffreurIdentite()
    const depot = await ouvrirDepot({ base, chiffreur: identite })
    await depot.ajouterPlusieurs(
      Array.from({ length: 450 }, (_, rang) => ({
        type: 'account.unarchived' as const,
        payload: { id: `c${rang}` },
      })),
    )
    const coffre = await creerCoffre('123456', TOURS)
    const resultat = await rechiffrerJournal(base, identite, chiffreurCoffre(coffre), 100)
    expect(resultat.rechiffres).toBe(450)
    expect(resultat.rejets).toEqual([])
  })
})
