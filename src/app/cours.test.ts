import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { ouvrirBase } from '../storage/db'
import { ouvrirDepot } from '../storage/repository'
import { plier } from '../domain/etat'
import { validerEvenement, type Evenement, type TypeEvenement } from '../domain/events'
import { brancherDepot, lire, reinitialiserMagasin } from './magasin'
import { actualiserCours, convertirVersUnite, lirePrix, symboleInterrogeable } from './cours'

let compteur = 0
let sequence = 0

const ev = (type: TypeEvenement, payload: Record<string, unknown>): Evenement => {
  sequence += 1
  return validerEvenement({
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    ts: 1_757_000_000_000 + sequence,
    device: 'test',
    type,
    payload,
  })
}

const instrument = (id: string, genre: string, unite: string, symbole: string) =>
  ev('instrument.created', { id, symbole, nom: id, genre, unite })

beforeEach(async () => {
  reinitialiserMagasin()
  await brancherDepot(await ouvrirDepot({ base: ouvrirBase(`cours-${compteur++}`) }))
})

describe('lecture d’une réponse', () => {
  it('accepte un prix en chaîne comme en nombre', () => {
    expect(lirePrix({ price: '38.42' })).toBe(38.42)
    expect(lirePrix({ price: 38.42 })).toBe(38.42)
  })

  /** Une réponse mal formée ne doit jamais devenir un cours de zéro. */
  it('refuse tout ce qui n’est pas un prix utilisable', () => {
    for (const charge of [null, {}, { price: 'abc' }, { price: 0 }, { price: -3 }, 'texte', 42]) {
      expect(lirePrix(charge)).toBeNull()
    }
  })
})

describe('symbole interrogé', () => {
  it('traduit l’or en paire de devises', () => {
    const etat = plier([instrument('or', 'or', 'gramme', 'Or physique')])
    expect(symboleInterrogeable(etat.instruments.get('or')!)).toBe('XAU/EUR')
  })

  it('garde le symbole tel quel pour un titre', () => {
    const etat = plier([instrument('cw8', 'etf', 'part', 'CW8')])
    expect(symboleInterrogeable(etat.instruments.get('cw8')!)).toBe('CW8')
  })
})

describe('unité de cotation', () => {
  /**
   * L'or se cote à l'once. Quelqu'un qui compte en grammes verrait sinon son
   * patrimoine multiplié par trente et un.
   */
  it('ramène un cours à l’once vers le gramme', () => {
    const etat = plier([instrument('or', 'or', 'gramme', 'Or')])
    const parGramme = convertirVersUnite(2400, etat.instruments.get('or')!)
    expect(parGramme).toBeCloseTo(77.16, 2)
  })

  it('laisse un cours à l’once intact quand on compte en onces', () => {
    const etat = plier([instrument('or', 'or', 'once', 'Or')])
    expect(convertirVersUnite(2400, etat.instruments.get('or')!)).toBe(2400)
  })

  it('ne touche pas au cours d’un titre', () => {
    const etat = plier([instrument('cw8', 'etf', 'part', 'CW8')])
    expect(convertirVersUnite(38.42, etat.instruments.get('cw8')!)).toBe(38.42)
  })
})

describe('actualisation', () => {
  const etatAvecDeux = () =>
    plier([instrument('cw8', 'etf', 'part', 'CW8'), instrument('or', 'or', 'gramme', 'Or')])

  it('écrit un cours daté et sourcé pour chaque instrument', async () => {
    const resultat = await actualiserCours(etatAvecDeux(), {
      cle: 'factice',
      jour: '2026-09-13',
      recuperer: (url) => Promise.resolve({ price: url.includes('XAU') ? '2400' : '38.42' }),
    })

    expect(resultat.misAJour).toBe(2)
    expect(resultat.echecs).toEqual([])

    const cotes = lire().journal.filter((e) => e.type === 'instrument.quoted')
    expect(cotes).toHaveLength(2)
    const parInstrument = new Map(cotes.map((e) => [e.payload.instrument_id, e.payload]))
    expect(parInstrument.get('cw8')).toMatchObject({ cours_cents: 3842, date: '2026-09-13' })
    // 2 400 € l'once ramenés au gramme, puis en centimes.
    expect(parInstrument.get('or')!.cours_cents).toBe(7716)
    expect(parInstrument.get('cw8')!.source).toBe('Twelve Data')
  })

  it('n’écrit rien et le dit quand aucune clé n’est enregistrée', async () => {
    const resultat = await actualiserCours(etatAvecDeux(), { cle: '' })
    expect(resultat.misAJour).toBe(0)
    expect(resultat.echecs[0]!.raison).toMatch(/aucune clé/)
    expect(lire().journal.filter((e) => e.type === 'instrument.quoted')).toHaveLength(0)
  })

  /**
   * Un service muet ne doit rien effacer.
   *
   * Les cours déjà connus continuent de valoir : c'est toute la différence entre
   * « je ne sais pas aujourd'hui » et « ça ne vaut plus rien ».
   */
  it('signale l’échec sans toucher aux cours connus', async () => {
    const resultat = await actualiserCours(etatAvecDeux(), {
      cle: 'factice',
      recuperer: () => Promise.reject(new Error('réponse 429')),
    })
    expect(resultat.misAJour).toBe(0)
    expect(resultat.echecs).toHaveLength(2)
    expect(resultat.echecs[0]!.raison).toMatch(/429/)
    expect(lire().journal.filter((e) => e.type === 'instrument.quoted')).toHaveLength(0)
  })

  it('garde ce qui a réussi quand une partie échoue', async () => {
    const resultat = await actualiserCours(etatAvecDeux(), {
      cle: 'factice',
      jour: '2026-09-13',
      recuperer: (url) =>
        url.includes('XAU')
          ? Promise.reject(new Error('symbole inconnu'))
          : Promise.resolve({ price: '38.42' }),
    })
    expect(resultat.misAJour).toBe(1)
    expect(resultat.echecs).toHaveLength(1)
    expect(lire().journal.filter((e) => e.type === 'instrument.quoted')).toHaveLength(1)
  })

  it('refuse une réponse sans prix utilisable plutôt que d’écrire zéro', async () => {
    const resultat = await actualiserCours(etatAvecDeux(), {
      cle: 'factice',
      recuperer: () => Promise.resolve({ status: 'error', message: 'quota dépassé' }),
    })
    expect(resultat.misAJour).toBe(0)
    expect(resultat.echecs[0]!.raison).toMatch(/cours absent/)
  })

  it('n’envoie jamais la clé ailleurs que vers le service annoncé', async () => {
    const urls: string[] = []
    await actualiserCours(etatAvecDeux(), {
      cle: 'secrete',
      recuperer: (url) => {
        urls.push(url)
        return Promise.resolve({ price: '1' })
      },
    })
    expect(urls).toHaveLength(2)
    for (const url of urls) expect(url.startsWith('https://api.twelvedata.com/')).toBe(true)
  })
})
