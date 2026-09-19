import { describe, expect, it } from 'vitest'
import { dateCivile } from '../core/civilDate'
import { NOMS_MOIS, jourEnLettres, jourEtMois } from './dates'

describe('dates affichées', () => {
  it('porte toujours le mois, pas seulement le quantième', () => {
    expect(jourEtMois(dateCivile('2026-09-03'))).toBe('03/09')
    expect(jourEtMois(dateCivile('2026-01-31'))).toBe('31/01')
  })

  it('garde les zéros de tête : 3/9 et 03/09 ne se lisent pas au même rythme', () => {
    expect(jourEtMois(dateCivile('2026-09-03'))).not.toBe('3/9')
  })

  it('écrit le mois en toutes lettres pour un titre', () => {
    expect(jourEnLettres(dateCivile('2026-09-03'))).toBe('3 septembre')
    expect(jourEnLettres(dateCivile('2026-08-01'))).toBe('1 août')
    expect(jourEnLettres(dateCivile('2026-12-25'))).toBe('25 décembre')
  })

  it('ne rend pas un mois inventé sur une date hors calendrier', () => {
    // Le type interdit ce cas ; si quelque chose le produit malgré tout, mieux
    // vaut afficher la date brute qu'un nom de mois tiré d'un index absent.
    expect(jourEnLettres('2026-13-01')).toBe('2026-13-01')
    expect(jourEnLettres('n’importe quoi')).toBe('n’importe quoi')
  })

  it('a douze mois, dans l’ordre', () => {
    expect(NOMS_MOIS).toHaveLength(12)
    expect(NOMS_MOIS[0]).toBe('janvier')
    expect(NOMS_MOIS[11]).toBe('décembre')
  })
})
