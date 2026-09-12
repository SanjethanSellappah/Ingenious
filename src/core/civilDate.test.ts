import { describe, expect, it } from 'vitest'
import {
  ajouterJours,
  ajouterMois,
  comparer,
  composantes,
  dateCivile,
  depuisComposantes,
  depuisNumeroDeJour,
  dernierJourDuMois,
  estBissextile,
  estDans,
  estDateCivile,
  intervalleDeJours,
  jourDeLaSemaine,
  joursDansLeMois,
  joursEntre,
  moisEntre,
  nomDuJour,
  numeroDeJour,
  premierJourDuMois,
} from './civilDate'

describe('validation', () => {
  it('accepte une date réelle', () => {
    expect(dateCivile('2026-09-11')).toBe('2026-09-11')
  })

  it('rejette le 31 février', () => {
    expect(() => dateCivile('2026-02-31')).toThrow(/n'existe pas/)
    expect(estDateCivile('2026-02-31')).toBe(false)
  })

  it('rejette le 31 avril et le 31 juin', () => {
    expect(estDateCivile('2026-04-31')).toBe(false)
    expect(estDateCivile('2026-06-31')).toBe(false)
  })

  it('rejette le 29 février d’une année non bissextile et accepte celui d’une bissextile', () => {
    expect(estDateCivile('2026-02-29')).toBe(false)
    expect(estDateCivile('2028-02-29')).toBe(true)
  })

  it('rejette les formats approximatifs', () => {
    for (const texte of ['2026-9-11', '11/09/2026', '2026-09-11T00:00:00Z', '', '2026-13-01']) {
      expect(estDateCivile(texte)).toBe(false)
    }
  })

  it('décompose ce qu’elle a composé', () => {
    expect(composantes(depuisComposantes(2026, 2, 28))).toEqual({ annee: 2026, mois: 2, jour: 28 })
  })
})

describe('années bissextiles', () => {
  it('suit la règle grégorienne, séculaires comprises', () => {
    expect(estBissextile(2024)).toBe(true)
    expect(estBissextile(2026)).toBe(false)
    expect(estBissextile(1900)).toBe(false) // divisible par 100, pas par 400
    expect(estBissextile(2000)).toBe(true) // divisible par 400
    expect(estBissextile(2100)).toBe(false)
  })

  it('donne 29 jours à février des années bissextiles', () => {
    expect(joursDansLeMois(2028, 2)).toBe(29)
    expect(joursDansLeMois(2026, 2)).toBe(28)
    expect(joursDansLeMois(1900, 2)).toBe(28)
    expect(joursDansLeMois(2000, 2)).toBe(29)
  })
})

describe('numéro de jour', () => {
  it('place l’origine au 1er janvier 1970', () => {
    expect(numeroDeJour(dateCivile('1970-01-01'))).toBe(0)
    expect(numeroDeJour(dateCivile('1969-12-31'))).toBe(-1)
  })

  it('est l’inverse exact de la reconstruction', () => {
    for (const texte of ['1900-01-01', '1970-01-01', '2000-02-29', '2026-09-11', '2099-12-31']) {
      const d = dateCivile(texte)
      expect(depuisNumeroDeJour(numeroDeJour(d))).toBe(d)
    }
  })

  it('reste cohérent sur dix ans, jour après jour', () => {
    let n = numeroDeJour(dateCivile('2020-01-01'))
    const fin = numeroDeJour(dateCivile('2030-01-01'))
    for (; n <= fin; n++) {
      expect(numeroDeJour(depuisNumeroDeJour(n))).toBe(n)
    }
  })
})

describe('jour de la semaine', () => {
  it('retrouve des jours connus', () => {
    expect(nomDuJour(dateCivile('2026-09-11'))).toBe('vendredi')
    expect(nomDuJour(dateCivile('2000-01-01'))).toBe('samedi')
    expect(nomDuJour(dateCivile('2026-01-01'))).toBe('jeudi')
    expect(jourDeLaSemaine(dateCivile('2026-09-13'))).toBe(0) // dimanche
  })

  it('avance d’un jour par jour', () => {
    let date = dateCivile('2026-01-01')
    for (let i = 0; i < 400; i++) {
      const suivant = ajouterJours(date, 1)
      expect(jourDeLaSemaine(suivant)).toBe((jourDeLaSemaine(date) + 1) % 7)
      date = suivant
    }
  })
})

describe('arithmétique', () => {
  it('franchit le changement d’année', () => {
    expect(ajouterJours(dateCivile('2026-12-31'), 1)).toBe('2027-01-01')
    expect(ajouterJours(dateCivile('2027-01-01'), -1)).toBe('2026-12-31')
  })

  it('franchit le 29 février', () => {
    expect(ajouterJours(dateCivile('2028-02-28'), 1)).toBe('2028-02-29')
    expect(ajouterJours(dateCivile('2026-02-28'), 1)).toBe('2026-03-01')
  })

  it('rogne au dernier jour du mois d’arrivée', () => {
    expect(ajouterMois(dateCivile('2026-01-31'), 1)).toBe('2026-02-28')
    expect(ajouterMois(dateCivile('2028-01-31'), 1)).toBe('2028-02-29')
    expect(ajouterMois(dateCivile('2026-03-31'), 1)).toBe('2026-04-30')
  })

  it('ne rattrape pas le rognage — d’où l’ancrage des récurrences', () => {
    // Deux additions successives d'un mois perdent le 31 : c'est exactement la
    // dérive que `recurrence.ts` évite en repartant toujours de l'ancre.
    const parPas = ajouterMois(ajouterMois(dateCivile('2026-01-31'), 1), 1)
    const dUnCoup = ajouterMois(dateCivile('2026-01-31'), 2)
    expect(parPas).toBe('2026-03-28')
    expect(dUnCoup).toBe('2026-03-31')
  })

  it('recule de mois', () => {
    expect(ajouterMois(dateCivile('2026-01-15'), -1)).toBe('2025-12-15')
    expect(ajouterMois(dateCivile('2026-01-15'), -13)).toBe('2024-12-15')
  })

  it('compte les mois et les jours entre deux dates', () => {
    expect(moisEntre(dateCivile('2026-01-31'), dateCivile('2026-03-01'))).toBe(2)
    expect(moisEntre(dateCivile('2026-03-01'), dateCivile('2026-01-31'))).toBe(-2)
    expect(joursEntre(dateCivile('2026-01-01'), dateCivile('2026-01-31'))).toBe(30)
    expect(joursEntre(dateCivile('2028-02-01'), dateCivile('2028-03-01'))).toBe(29)
  })

  it('borne les mois', () => {
    expect(premierJourDuMois(dateCivile('2026-02-17'))).toBe('2026-02-01')
    expect(dernierJourDuMois(dateCivile('2026-02-17'))).toBe('2026-02-28')
    expect(dernierJourDuMois(dateCivile('2028-02-17'))).toBe('2028-02-29')
  })
})

describe('comparaison', () => {
  it('trie comme la chronologie', () => {
    expect(comparer(dateCivile('2026-01-01'), dateCivile('2026-01-02'))).toBeLessThan(0)
    expect(comparer(dateCivile('2026-01-02'), dateCivile('2026-01-01'))).toBeGreaterThan(0)
    expect(comparer(dateCivile('2026-01-01'), dateCivile('2026-01-01'))).toBe(0)
  })

  it('inclut les bornes', () => {
    const d = dateCivile('2026-01-01')
    expect(estDans(d, d, dateCivile('2026-01-31'))).toBe(true)
    expect(estDans(dateCivile('2026-01-31'), d, dateCivile('2026-01-31'))).toBe(true)
    expect(estDans(dateCivile('2026-02-01'), d, dateCivile('2026-01-31'))).toBe(false)
  })
})

describe('intervalle', () => {
  it('énumère bornes comprises', () => {
    const jours = intervalleDeJours(dateCivile('2026-02-26'), dateCivile('2026-03-02'))
    expect(jours).toEqual(['2026-02-26', '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
  })

  it('retourne un seul jour quand les bornes coïncident', () => {
    expect(intervalleDeJours(dateCivile('2026-02-26'), dateCivile('2026-02-26'))).toHaveLength(1)
  })

  it('retourne vide quand la fin précède le début', () => {
    expect(intervalleDeJours(dateCivile('2026-02-26'), dateCivile('2026-02-25'))).toEqual([])
  })
})
