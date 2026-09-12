/**
 * Tests adverses.
 *
 * Le modèle de menace de cette application est modeste et il faut le nommer pour
 * ne pas se raconter d'histoires :
 *
 * - **Ce qui est protégé** : quelqu'un qui emprunte le téléphone déverrouillé et
 *   ouvre l'application, ou qui inspecte IndexedDB par les outils de développement.
 * - **Ce qui ne l'est pas** : un adversaire outillé qui a le téléphone en main et
 *   attaque un PIN à quatre chiffres hors ligne. Les itérations ralentissent, elles
 *   n'empêchent pas.
 * - **Ce qui n'a pas lieu d'être** : il n'y a ni serveur, ni compte, ni réseau.
 *   La plupart des menaces d'une application web n'existent tout simplement pas ici.
 *
 * Restent deux surfaces réelles : le **fichier d'import**, qui vient de
 * l'extérieur, et le **contenu de la base**, qu'un curieux peut modifier.
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { chiffreurCoffre, creerCoffre } from '../storage/crypto'
import { ouvrirBase } from '../storage/db'
import { lireJournalExporte, ouvrirDepot } from '../storage/repository'
import { validerEvenement, validerEvenements } from './events'

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
let compteur = 0

const enveloppe = (payload: unknown, type = 'account.created') => ({
  id: ID,
  ts: 1,
  device: 'x',
  type,
  payload,
})

describe('pollution de prototype par un fichier d’import', () => {
  it('ne contamine pas Object.prototype', () => {
    const hostile = JSON.parse(
      `{"id":"${ID}","ts":1,"device":"x","type":"label.renamed","payload":{"id":"l1","nom":"X","__proto__":{"pollue":true},"constructor":{"prototype":{"pollue":true}}}}`,
    ) as unknown
    validerEvenement(hostile)
    expect(({} as Record<string, unknown>).pollue).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('pollue')
  })

  it('traite __proto__ comme une donnée ordinaire, pas comme une instruction', () => {
    const hostile = JSON.parse(
      `{"id":"${ID}","ts":1,"device":"x","type":"account.unarchived","payload":{"id":"c1","__proto__":{"admin":true}}}`,
    ) as unknown
    const valide = validerEvenement(hostile)
    expect(Object.getPrototypeOf(valide.payload)).toBe(Object.prototype)
  })
})

describe('charges utiles hostiles', () => {
  it('refuse une charge utile qui n’est pas un objet', () => {
    for (const payload of [null, 'texte', 42, [1, 2, 3], true]) {
      expect(() => validerEvenement(enveloppe(payload))).toThrow(/objet attendu/)
    }
  })

  it('refuse un montant qui ferait déborder le calcul', () => {
    const payload = {
      account_id: 'c1',
      date: '2026-09-11',
      solde_cents: Number.MAX_SAFE_INTEGER + 10,
    }
    expect(() => validerEvenement(enveloppe(payload, 'account.balance_set'))).toThrow(/entier sûr/)
  })

  it('refuse un montant non fini', () => {
    // JSON n'a pas d'infini, mais un objet construit en mémoire peut en avoir un.
    const payload = { account_id: 'c1', date: '2026-09-11', solde_cents: Number.POSITIVE_INFINITY }
    expect(() => validerEvenement(enveloppe(payload, 'account.balance_set'))).toThrow(
      /nombre attendu/,
    )
  })

  it('borne la longueur des textes libres', () => {
    const payload = {
      id: 'l1',
      nom: 'x'.repeat(5000),
      couleur: '#fff',
    }
    expect(() => validerEvenement(enveloppe(payload, 'label.created'))).toThrow(/au plus 80/)
  })

  it('ne boucle pas sur une chaîne pathologique dans un champ date', () => {
    // Pas de quantificateur imbriqué dans les expressions régulières du noyau :
    // une chaîne longue est refusée en temps linéaire, pas explorée.
    const payload = { account_id: 'c1', date: '2'.repeat(50_000), solde_cents: 1 }
    const depart = performance.now()
    expect(() => validerEvenement(enveloppe(payload, 'account.balance_set'))).toThrow()
    expect(performance.now() - depart).toBeLessThan(1000)
  })

  it('refuse un identifiant d’appareil démesuré', () => {
    expect(() =>
      validerEvenement({
        ...enveloppe({ id: 'c1' }, 'account.unarchived'),
        device: 'd'.repeat(500),
      }),
    ).toThrow(/au plus 64/)
  })

  it('isole les événements hostiles sans perdre les bons', () => {
    const lecture = validerEvenements([
      enveloppe({ id: 'c1', nom: 'A', type: 'courant', groupe: 'bancaire', mode: 'saisi' }),
      null,
      'pas un objet',
      enveloppe({ id: 'c1' }, 'type.inexistant'),
    ])
    expect(lecture.evenements).toHaveLength(1)
    expect(lecture.rejets).toHaveLength(3)
  })
})

describe('fichier d’import hostile', () => {
  it('refuse ce qui n’est pas une enveloppe de journal', () => {
    for (const texte of ['[]', '"texte"', 'null', '{}', '42']) {
      expect(() => lireJournalExporte(texte)).toThrow()
    }
  })

  it('refuse un journal dont les événements ne sont pas un tableau', () => {
    expect(() =>
      lireJournalExporte('{"format":"ingenious.journal","version":1,"events":{"0":"x"}}'),
    ).toThrow(/tableau attendu/)
  })

  it('n’exécute rien de ce qu’il lit', async () => {
    // Le journal est de la donnée. Une charge utile qui ressemble à du code
    // n'est jamais qu'une chaîne de caractères de plus.
    const base = ouvrirBase(`securite-${compteur++}`)
    const depot = await ouvrirDepot({ base })
    const journal = {
      format: 'ingenious.journal',
      version: 1,
      chiffre: false,
      events: [
        enveloppe(
          { id: 'l1', nom: '<img src=x onerror=alert(1)>', couleur: '#fff' },
          'label.created',
        ),
      ],
    }
    const resultat = await depot.importer(JSON.stringify(journal))
    expect(resultat.ajoutes).toBe(1)
    const { evenements } = await depot.chargerTout()
    // Conservé tel quel, comme texte — c'est à l'affichage de ne pas l'interpréter,
    // et React échappe par défaut.
    expect(evenements[0]!.payload.nom).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('base trafiquée', () => {
  it('ne rend pas lisible un enregistrement remplacé par du clair', async () => {
    const base = ouvrirBase(`securite-${compteur++}`)
    const coffre = await creerCoffre('123456', 1000)
    const depot = await ouvrirDepot({ base, chiffreur: chiffreurCoffre(coffre) })
    await depot.ajouter('account.created', {
      id: 'c1',
      nom: 'Courant',
      type: 'courant',
      groupe: 'bancaire',
      mode: 'saisi',
    })

    // Quelqu'un glisse un événement en clair dans une base chiffrée, pour voir.
    await base.events.put({
      id: 'injecte',
      donnees: enveloppe({
        id: 'c2',
        nom: 'Faux',
        type: 'courant',
        groupe: 'bancaire',
        mode: 'saisi',
      }),
    })

    const { evenements, rejets } = await depot.chargerTout()
    expect(evenements).toHaveLength(1)
    expect(rejets[0]!.raison).toMatch(/non chiffré/)
  })

  it('détecte un scellé modifié plutôt que de le déchiffrer de travers', async () => {
    const base = ouvrirBase(`securite-${compteur++}`)
    const coffre = await creerCoffre('123456', 1000)
    const depot = await ouvrirDepot({ base, chiffreur: chiffreurCoffre(coffre) })
    await depot.ajouter('account.unarchived', { id: 'c1' })

    const [enregistrement] = await base.events.toArray()
    const scelle = enregistrement!.donnees as { iv_b64: string; donnees_b64: string }
    await base.events.put({
      id: enregistrement!.id,
      donnees: {
        ...scelle,
        donnees_b64: scelle.donnees_b64.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')),
      },
    })

    const { evenements, rejets } = await depot.chargerTout()
    expect(evenements).toHaveLength(0)
    expect(rejets).toHaveLength(1)
  })
})
