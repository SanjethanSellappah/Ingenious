// Ces tests n'ont de sens que dans un fuseau décalé par rapport à UTC. Le fuseau
// est fixé par `test.env.TZ` dans vite.config.ts : sous un autre fuseau, ils
// échouent bruyamment plutôt que de passer à vide.
import { afterEach, describe, expect, it } from 'vitest'
import {
  aujourdhui,
  dateCivileLocale,
  fixerHorloge,
  maintenant,
  reinitialiserHorloge,
} from './clock'

afterEach(() => {
  reinitialiserHorloge()
})

describe('aujourdhui', () => {
  it('retourne la date locale, pas la date UTC', () => {
    // 23 h 30 UTC le 1er janvier, soit 00 h 30 le 2 janvier à Paris.
    fixerHorloge(new Date('2026-01-01T23:30:00Z'))
    expect(aujourdhui()).toBe('2026-01-02')
  })

  it('ne recule pas d’un jour en heure d’été', () => {
    // 22 h 30 UTC le 30 juin, soit 00 h 30 le 1er juillet à Paris (UTC+2).
    fixerHorloge(new Date('2026-06-30T22:30:00Z'))
    expect(aujourdhui()).toBe('2026-07-01')
  })

  it('formate sur deux chiffres', () => {
    fixerHorloge(new Date('2026-03-05T12:00:00Z'))
    expect(aujourdhui()).toBe('2026-03-05')
  })

  it('suit une source mobile', () => {
    const instants = [new Date('2026-02-28T12:00:00Z'), new Date('2026-03-01T12:00:00Z')]
    let appel = 0
    fixerHorloge(() => instants[appel++] ?? instants[instants.length - 1]!)
    expect(aujourdhui()).toBe('2026-02-28')
    expect(aujourdhui()).toBe('2026-03-01')
  })
})

describe('maintenant', () => {
  it('retourne l’instant epoch de la source', () => {
    const instant = new Date('2026-01-01T23:30:00Z')
    fixerHorloge(instant)
    expect(maintenant()).toBe(instant.getTime())
  })

  it('retrouve l’horloge système après réinitialisation', () => {
    fixerHorloge(new Date('2000-01-01T00:00:00Z'))
    reinitialiserHorloge()
    expect(maintenant()).toBeGreaterThan(Date.parse('2026-01-01T00:00:00Z'))
  })
})

describe('dateCivileLocale', () => {
  it('traite le 29 février d’une année bissextile', () => {
    expect(dateCivileLocale(new Date('2028-02-29T10:00:00Z'))).toBe('2028-02-29')
  })
})
