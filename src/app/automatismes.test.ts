import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dateCivile } from '../core/civilDate'
import { DELAI_RAPPEL_JOURS, dernierExport, marquerExport, rappelSauvegarde } from './automatismes'

const d = dateCivile

/** Mémoire locale simulée : les tests tournent en environnement node. */
const memoire = new Map<string, string>()

beforeEach(() => {
  memoire.clear()
  vi.stubGlobal('localStorage', {
    getItem: (cle: string) => memoire.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => memoire.set(cle, valeur),
    removeItem: (cle: string) => memoire.delete(cle),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('rappel de sauvegarde', () => {
  it('réclame un export quand il n’y en a jamais eu', () => {
    expect(rappelSauvegarde(d('2026-09-12'))).toEqual({ du: true, dernier: null, jours: null })
  })

  it('se tait pendant le mois qui suit un export', () => {
    marquerExport(d('2026-09-01'))
    expect(rappelSauvegarde(d('2026-09-20')).du).toBe(false)
    expect(rappelSauvegarde(d('2026-09-20')).jours).toBe(19)
  })

  it('réclame à nouveau après trente jours', () => {
    marquerExport(d('2026-09-01'))
    expect(rappelSauvegarde(d('2026-10-01')).du).toBe(false)
    expect(rappelSauvegarde(d('2026-10-02')).du).toBe(true)
    expect(DELAI_RAPPEL_JOURS).toBe(30)
  })

  it('ne plante pas si la mémoire locale est bloquée', () => {
    // Navigation privée, réglages restrictifs : l'accès lève.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('bloqué')
      },
      setItem: () => {
        throw new Error('bloqué')
      },
    })
    expect(() => marquerExport(d('2026-09-01'))).not.toThrow()
    expect(dernierExport()).toBeNull()
    // Le rappel réapparaît : c'est le bon sens de l'erreur.
    expect(rappelSauvegarde(d('2026-09-12')).du).toBe(true)
  })

  it('ignore une valeur corrompue', () => {
    memoire.set('ingenious.dernier-export', 'hier')
    expect(dernierExport()).toBeNull()
  })
})
