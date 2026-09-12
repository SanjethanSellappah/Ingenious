import { describe, expect, it } from 'vitest'
import { dateCivile, nomDuJour } from './civilDate'
import {
  estFerie,
  estJourOuvre,
  estWeekend,
  joursFeries,
  nomDuFerie,
  paques,
  precedentJourOuvre,
  prochainJourOuvre,
} from './holidaysFR'

describe('Pâques', () => {
  it('retrouve des dimanches de Pâques connus', () => {
    const attendus: Record<number, string> = {
      2000: '2000-04-23',
      2010: '2010-04-04',
      2024: '2024-03-31',
      2025: '2025-04-20',
      2026: '2026-04-05',
      2027: '2027-03-28',
      2030: '2030-04-21',
      2038: '2038-04-25', // la plus tardive possible de ce siècle
      2285: '2285-03-22', // la plus précoce possible
    }
    for (const [annee, date] of Object.entries(attendus)) {
      expect(paques(Number(annee))).toBe(date)
    }
  })

  it('tombe toujours un dimanche, entre le 22 mars et le 25 avril', () => {
    for (let annee = 1900; annee <= 2200; annee++) {
      const date = paques(annee)
      expect(nomDuJour(date)).toBe('dimanche')
      expect(date >= `${annee}-03-22`).toBe(true)
      expect(date <= `${annee}-04-25`).toBe(true)
    }
  })
})

describe('jours fériés', () => {
  it('en compte onze, toutes années confondues', () => {
    for (const annee of [2024, 2025, 2026, 2027, 2032]) {
      expect(joursFeries(annee).size).toBe(11)
    }
  })

  it('place les mobiles de 2026 au bon endroit', () => {
    // Pâques le 5 avril 2026.
    expect(nomDuFerie(dateCivile('2026-04-06'))).toBe('lundi de Pâques')
    expect(nomDuFerie(dateCivile('2026-05-14'))).toBe('Ascension') // +39
    expect(nomDuFerie(dateCivile('2026-05-25'))).toBe('lundi de Pentecôte') // +50
  })

  it('place les fixes', () => {
    expect(nomDuFerie(dateCivile('2026-01-01'))).toBe("jour de l'an")
    expect(nomDuFerie(dateCivile('2026-05-01'))).toBe('fête du Travail')
    expect(nomDuFerie(dateCivile('2026-05-08'))).toBe('victoire 1945')
    expect(nomDuFerie(dateCivile('2026-07-14'))).toBe('fête nationale')
    expect(nomDuFerie(dateCivile('2026-08-15'))).toBe('Assomption')
    expect(nomDuFerie(dateCivile('2026-11-01'))).toBe('Toussaint')
    expect(nomDuFerie(dateCivile('2026-11-11'))).toBe('armistice 1918')
    expect(nomDuFerie(dateCivile('2026-12-25'))).toBe('Noël')
  })

  it('l’Ascension tombe toujours un jeudi', () => {
    for (let annee = 2020; annee <= 2040; annee++) {
      const ascension = [...joursFeries(annee)].find(([, nom]) => nom === 'Ascension')![0]
      expect(nomDuJour(ascension)).toBe('jeudi')
    }
  })

  it('ne férie pas un jour ordinaire', () => {
    expect(estFerie(dateCivile('2026-09-11'))).toBe(false)
    expect(nomDuFerie(dateCivile('2026-09-11'))).toBeNull()
  })
})

describe('week-end et jours ouvrés', () => {
  it('reconnaît samedi et dimanche', () => {
    expect(estWeekend(dateCivile('2026-09-12'))).toBe(true) // samedi
    expect(estWeekend(dateCivile('2026-09-13'))).toBe(true) // dimanche
    expect(estWeekend(dateCivile('2026-09-11'))).toBe(false) // vendredi
  })

  it('exclut les fériés des jours ouvrés', () => {
    expect(estJourOuvre(dateCivile('2026-05-01'))).toBe(false) // vendredi férié
    expect(estJourOuvre(dateCivile('2026-09-11'))).toBe(true)
  })
})

describe('recherche du jour ouvré', () => {
  it('ne bouge pas un jour déjà ouvré', () => {
    const vendredi = dateCivile('2026-09-11')
    expect(prochainJourOuvre(vendredi)).toBe(vendredi)
    expect(precedentJourOuvre(vendredi)).toBe(vendredi)
  })

  it('saute le week-end', () => {
    expect(prochainJourOuvre(dateCivile('2026-09-12'))).toBe('2026-09-14') // samedi → lundi
    expect(precedentJourOuvre(dateCivile('2026-09-13'))).toBe('2026-09-11') // dimanche → vendredi
  })

  it('saute un férié collé au week-end', () => {
    // Le 1er mai 2026 est un vendredi férié : en reculant, on remonte au jeudi.
    expect(precedentJourOuvre(dateCivile('2026-05-01'))).toBe('2026-04-30')
    // Le 2 mai est un samedi : en avançant depuis le 1er, on va au lundi 4.
    expect(prochainJourOuvre(dateCivile('2026-05-01'))).toBe('2026-05-04')
  })

  it('traverse le pont du 1er janvier', () => {
    // 1er janvier 2027 est un vendredi férié, suivi du week-end.
    expect(prochainJourOuvre(dateCivile('2027-01-01'))).toBe('2027-01-04')
    expect(precedentJourOuvre(dateCivile('2027-01-01'))).toBe('2026-12-31')
  })

  it('franchit l’année en reculant', () => {
    // 1er janvier 2026 est un jeudi férié : le jour ouvré précédent est en 2025.
    expect(precedentJourOuvre(dateCivile('2026-01-01'))).toBe('2025-12-31')
  })
})
