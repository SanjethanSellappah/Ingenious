import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { chiffreurCoffre, chiffreurIdentite, creerCoffre } from './crypto'
import { CLE_COFFRE, ouvrirBase } from './db'
import { compterHorsFormat, ouvrirDepot, rechiffrerJournal } from './repository'
import { ouvrirJournal } from '../app/demarrage'

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
    // Le corrompu a déjà la forme d'un scellé : on tente de le lire avec la clé
    // d'arrivée, et son illisibilité est signalée par son identifiant. Le
    // sceller une seconde fois l'aurait enfermé dans une enveloppe valide —
    // la corruption serait devenue indétectable.
    expect(resultat.rechiffres).toBe(1)
    expect(resultat.rejets).toHaveLength(1)
    expect(resultat.rejets[0]!.raison).toContain('corrompu')
    // Rien n'est supprimé : un enregistrement illisible reste là où il est.
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

/**
 * L'activation du code peut être interrompue.
 *
 * Rechiffrer quinze ans de journal prend une dizaine de secondes sur cette
 * machine, davantage sur un téléphone. Pendant ce temps, l'application peut être
 * fermée, le système peut réclamer la mémoire, la batterie peut lâcher. Ce qui
 * se passe alors décide si l'utilisateur retrouve ses données ou non.
 */
describe('activation du code interrompue', () => {
  const journalDe = async (base: ReturnType<typeof ouvrirBase>, n: number) => {
    const depot = await ouvrirDepot({ base, chiffreur: chiffreurIdentite() })
    for (let i = 0; i < n; i++) await depot.ajouter('account.created', { ...compte, id: `c${i}` })
  }

  it('ne perd rien quand le coffre est enregistré avant le rechiffrement', async () => {
    const base = ouvrirBase(`interrompu-${compteur++}`)
    await journalDe(base, 6)
    const coffre = await creerCoffre('123456', TOURS)

    // Le coffre est posé d'abord : la clé de données survit à l'interruption.
    await base.meta.put({ cle: 'coffre', valeur: { sel_b64: 'x' } })
    // Puis le rechiffrement s'arrête au milieu.
    const tous = await base.events.toArray()
    const moitie = tous.slice(0, 3)
    for (const enregistrement of moitie) {
      await base.events.put({
        id: enregistrement.id,
        donnees: await chiffreurCoffre(coffre).chiffrer(
          await chiffreurIdentite().dechiffrer(enregistrement.donnees),
        ),
      })
    }

    // Reprise : le rechiffrement doit finir le travail, pas le refuser.
    const reprise = await rechiffrerJournal(base, chiffreurIdentite(), chiffreurCoffre(coffre))
    expect(reprise.rejets).toEqual([])

    const depot = await ouvrirDepot({ base, chiffreur: chiffreurCoffre(coffre) })
    const { evenements, rejets } = await depot.chargerTout()
    expect(rejets).toEqual([])
    expect(evenements).toHaveLength(6)
  })
})

/**
 * Le scénario complet, par le vrai code de démarrage.
 *
 * L'utilisateur active un code sur un journal existant, et l'application est
 * fermée au milieu du rechiffrement. Ce qu'il doit retrouver à la réouverture :
 * tout, sans intervention.
 */
describe('reprise au démarrage', () => {
  it('termine un chiffrement interrompu à l’ouverture suivante', async () => {
    const base = ouvrirBase(`reprise-${compteur++}`)
    const depot = await ouvrirDepot({ base, chiffreur: chiffreurIdentite() })
    for (let i = 0; i < 8; i++) await depot.ajouter('account.created', { ...compte, id: `c${i}` })

    const coffre = await creerCoffre('123456', TOURS)
    const chiffreur = chiffreurCoffre(coffre)

    // Interruption : le coffre est posé, la moitié du journal est scellée.
    await base.meta.put({ cle: CLE_COFFRE, valeur: { marqueur: 'coffre' } })
    for (const enregistrement of (await base.events.toArray()).slice(0, 4)) {
      await base.events.put({
        id: enregistrement.id,
        donnees: await chiffreur.chiffrer(enregistrement.donnees),
      })
    }
    expect(await compterHorsFormat(base, chiffreur)).toBe(4)

    // Réouverture : c'est `ouvrirJournal` qui doit terminer le travail.
    await ouvrirJournal(base, { chiffreur, meta: null, etat: { statut: 'ouvert' } } as never)
    expect(await compterHorsFormat(base, chiffreur)).toBe(0)

    const relu = await ouvrirDepot({ base, chiffreur })
    const { evenements, rejets } = await relu.chargerTout()
    expect(rejets).toEqual([])
    expect(evenements).toHaveLength(8)
  })

  it('n’entreprend rien quand le journal est déjà homogène', async () => {
    const base = ouvrirBase(`reprise-${compteur++}`)
    const coffre = await creerCoffre('123456', TOURS)
    const chiffreur = chiffreurCoffre(coffre)
    const depot = await ouvrirDepot({ base, chiffreur })
    await depot.ajouter('account.created', { ...compte })

    expect(await compterHorsFormat(base, chiffreur)).toBe(0)
    await ouvrirJournal(base, { chiffreur, meta: null, etat: { statut: 'ouvert' } } as never)
    const { evenements, rejets } = await (await ouvrirDepot({ base, chiffreur })).chargerTout()
    expect(rejets).toEqual([])
    expect(evenements).toHaveLength(1)
  })
})
