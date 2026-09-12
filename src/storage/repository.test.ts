import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { chiffreurCoffre, creerCoffre } from './crypto'
import { ouvrirBase, type BaseIngenious } from './db'
import { lireJournalExporte, ouvrirDepot, type Depot } from './repository'

const TOURS = 1000
let compteur = 0

async function depotNeuf(chiffre = false): Promise<{ depot: Depot; base: BaseIngenious }> {
  const base = ouvrirBase(`test-${compteur++}`)
  const chiffreur = chiffre ? chiffreurCoffre(await creerCoffre('123456', TOURS)) : undefined
  const depot = await ouvrirDepot(chiffreur ? { base, chiffreur } : { base })
  return { depot, base }
}

const compte = {
  id: 'c1',
  nom: 'Courant',
  type: 'courant',
  groupe: 'bancaire',
  mode: 'saisi',
} as const

describe('écriture et relecture', () => {
  it('survit au rechargement', async () => {
    const { depot, base } = await depotNeuf()
    await depot.ajouter('account.created', { ...compte })
    await depot.ajouter('account.balance_set', {
      account_id: 'c1',
      date: '2026-09-11',
      solde_cents: 120000,
    })
    depot.fermer()

    // Nouveau dépôt sur la même base : c'est ce que fait un rechargement de page.
    const rouvert = await ouvrirDepot({ base: ouvrirBase(base.name) })
    const { evenements, rejets } = await rouvert.chargerTout()
    expect(rejets).toEqual([])
    expect(evenements.map((e) => e.type)).toEqual(['account.created', 'account.balance_set'])
  })

  it('garde l’identifiant d’appareil entre deux ouvertures', async () => {
    const { depot, base } = await depotNeuf()
    const premier = depot.appareil
    depot.fermer()
    const rouvert = await ouvrirDepot({ base: ouvrirBase(base.name) })
    expect(rouvert.appareil).toBe(premier)
  })

  it('refuse d’écrire un événement invalide', async () => {
    const { depot } = await depotNeuf()
    await expect(
      depot.ajouter('account.balance_set', {
        account_id: 'c1',
        date: '2026-02-31',
        solde_cents: 1,
      }),
    ).rejects.toThrow(/date civile/)
    expect((await depot.chargerTout()).evenements).toHaveLength(0)
  })

  it('ordonne les événements d’une même passe, ce dont la réconciliation dépend', async () => {
    const { depot } = await depotNeuf()
    const ecrits = await depot.ajouterPlusieurs([
      {
        type: 'transaction.created',
        payload: {
          id: 't1',
          account_id: 'c1',
          date: '2026-09-11',
          montant_cents: -4210,
          origine: 'reconciliation',
        },
      },
      {
        type: 'account.balance_set',
        payload: { account_id: 'c1', date: '2026-09-11', solde_cents: 95000 },
      },
    ])
    // L'écart se pose avant la nouvelle ancre : sans cet ordre, l'ancre
    // absorberait l'écart et la dépense disparaîtrait du calcul.
    expect(ecrits[0]!.ts).toBeLessThan(ecrits[1]!.ts)
    const { evenements } = await depot.chargerTout()
    expect(evenements.map((e) => e.type)).toEqual(['transaction.created', 'account.balance_set'])
  })
})

describe('chiffrement au repos', () => {
  it('ne laisse rien de lisible dans la base', async () => {
    const { depot, base } = await depotNeuf(true)
    await depot.ajouter('account.created', { ...compte, nom: 'Compte secret' })
    const brut = JSON.stringify(await base.events.toArray())
    expect(brut).not.toContain('Compte secret')
    expect(brut).not.toContain('account.created')
  })

  it('relit ce qu’il a chiffré', async () => {
    const { depot, base } = await depotNeuf(true)
    await depot.ajouter('account.created', { ...compte, nom: 'Compte secret' })
    const { evenements, rejets } = await depot.chargerTout()
    expect(rejets).toEqual([])
    expect(evenements[0]!.payload.nom).toBe('Compte secret')
    expect(await base.events.count()).toBe(1)
  })

  it('signale un enregistrement illisible sans perdre les autres', async () => {
    const { depot, base } = await depotNeuf(true)
    await depot.ajouter('account.created', { ...compte })
    await base.events.put({ id: 'corrompu', donnees: { iv_b64: 'AAAA', donnees_b64: 'AAAA' } })
    const { evenements, rejets } = await depot.chargerTout()
    expect(evenements).toHaveLength(1)
    expect(rejets).toHaveLength(1)
    expect(rejets[0]!.raison).toContain('corrompu')
  })
})

describe('export et import', () => {
  it('exporte le journal lui-même, en clair et relisible', async () => {
    const { depot } = await depotNeuf(true)
    await depot.ajouter('account.created', { ...compte })
    const journal = JSON.parse(await depot.exporterTexte()) as Record<string, unknown>
    expect(journal.format).toBe('ingenious.journal')
    expect(journal.chiffre).toBe(false)
    // L'export doit rester lisible dans dix ans avec n'importe quel outil, même
    // si la base, elle, est chiffrée.
    expect(JSON.stringify(journal)).toContain('Courant')
  })

  it('fait l’aller-retour : exporter, vider, réimporter, état identique', async () => {
    const { depot, base } = await depotNeuf()
    await depot.ajouter('account.created', { ...compte })
    await depot.ajouter('account.balance_set', {
      account_id: 'c1',
      date: '2026-09-11',
      solde_cents: 120000,
    })
    const avant = (await depot.chargerTout()).evenements
    const sauvegarde = await depot.exporterTexte()

    await base.events.clear()
    expect((await depot.chargerTout()).evenements).toHaveLength(0)

    const resultat = await depot.importer(sauvegarde)
    expect(resultat).toMatchObject({ ajoutes: 2, deja: 0, rejets: [] })
    expect((await depot.chargerTout()).evenements).toEqual(avant)
  })

  it('importe par fusion, jamais par écrasement', async () => {
    const { depot: a } = await depotNeuf()
    const { depot: b } = await depotNeuf()
    await a.ajouter('account.created', { ...compte })
    await b.ajouter('label.created', { id: 'l1', nom: 'Courses', couleur: '#4ade80' })

    await b.importer(await a.exporterTexte())
    const { evenements } = await b.chargerTout()
    // Le contenu propre à B n'a pas été écrasé par l'import de A.
    expect(evenements.map((e) => e.type).sort()).toEqual(['account.created', 'label.created'])
  })

  it('réimporter deux fois n’ajoute rien — union sur l’identifiant', async () => {
    const { depot } = await depotNeuf()
    await depot.ajouter('account.created', { ...compte })
    const sauvegarde = await depot.exporterTexte()
    expect((await depot.importer(sauvegarde)).ajoutes).toBe(0)
    expect((await depot.importer(sauvegarde)).deja).toBe(1)
    expect((await depot.chargerTout()).evenements).toHaveLength(1)
  })

  it('reprend ce qui est lisible dans un export partiellement corrompu', async () => {
    const { depot } = await depotNeuf()
    await depot.ajouter('account.created', { ...compte })
    const journal = JSON.parse(await depot.exporterTexte()) as { events: unknown[] }
    journal.events.push({
      id: 'pas-un-uuid',
      ts: 1,
      device: 'x',
      type: 'account.created',
      payload: {},
    })

    const resultat = await depot.importer(JSON.stringify(journal))
    expect(resultat.rejets).toHaveLength(1)
    expect(resultat.rejets[0]!.raison).toMatch(/UUID/)
    expect((await depot.chargerTout()).evenements).toHaveLength(1)
  })
})

describe('enveloppe d’export', () => {
  it('refuse un fichier qui n’est pas du JSON', () => {
    expect(() => lireJournalExporte('ceci n’est pas du json')).toThrow(/pas du JSON/)
  })

  it('refuse un JSON qui n’est pas un journal', () => {
    expect(() => lireJournalExporte('{"format":"autre.chose","version":1,"events":[]}')).toThrow(
      /ingenious.journal/,
    )
  })

  it('refuse une version écrite par une application plus récente', () => {
    expect(() =>
      lireJournalExporte('{"format":"ingenious.journal","version":99,"events":[]}'),
    ).toThrow(/plus récente/)
  })

  it('refuse un journal chiffré plutôt que de l’importer à moitié', () => {
    expect(() =>
      lireJournalExporte('{"format":"ingenious.journal","version":1,"chiffre":true,"events":[]}'),
    ).toThrow(/déchiffrer/)
  })

  it('accepte un journal vide — le gabarit du dépôt de données', () => {
    expect(
      lireJournalExporte(
        '{"format":"ingenious.journal","version":1,"chiffre":false,"genere_le":null,"appareil":null,"events":[]}',
      ).events,
    ).toEqual([])
  })
})
