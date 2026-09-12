import { describe, expect, it } from 'vitest'
import {
  attenteApresEchecs,
  configurerPin,
  DELAI_REVERROUILLAGE_MS,
  deverrouiller,
  verifierPin,
  verrouFerme,
  verrouiller,
  verrouSansPin,
} from './verrou'
import { creerCoffre } from '../storage/crypto'

const TOURS = 1000
const T0 = 1_757_000_000_000

async function verrouAvecPin(pin: string) {
  const coffre = await creerCoffre(pin, TOURS)
  return verrouFerme(coffre.meta)
}

describe('temporisation', () => {
  it('laisse passer les deux premiers essais sans attente', () => {
    expect(attenteApresEchecs(1)).toBe(0)
    expect(attenteApresEchecs(2)).toBe(0)
  })

  it('double à chaque échec ensuite', () => {
    expect(attenteApresEchecs(3)).toBe(1000)
    expect(attenteApresEchecs(4)).toBe(2000)
    expect(attenteApresEchecs(5)).toBe(4000)
    expect(attenteApresEchecs(10)).toBe(128_000)
  })

  it('plafonne à cinq minutes', () => {
    // Au-delà, c'est l'utilisateur légitime qu'on punit : un attaquant a déjà
    // renoncé ou automatisé.
    expect(attenteApresEchecs(50)).toBe(300_000)
    expect(attenteApresEchecs(1000)).toBe(300_000)
  })
})

describe('déverrouillage', () => {
  it('ouvre avec le bon code', async () => {
    const resultat = await deverrouiller(await verrouAvecPin('123456'), '123456', T0)
    expect(resultat.ok).toBe(true)
    expect(resultat.verrou.etat.statut).toBe('ouvert')
    expect(resultat.verrou.chiffreur.actif).toBe(true)
  })

  it('compte les échecs et impose une attente croissante', async () => {
    let verrou = await verrouAvecPin('123456')
    for (const attendu of [0, 0, 1000]) {
      const resultat = await deverrouiller(verrou, '000000', T0)
      expect(resultat.ok).toBe(false)
      verrou = resultat.verrou
      const etat = verrou.etat
      expect(etat.statut).toBe('verrouille')
      if (etat.statut === 'verrouille') expect(etat.attenteJusqua - T0).toBe(attendu)
    }
  })

  it('refuse un essai avant la fin de l’attente, sans consommer d’essai', async () => {
    let verrou = await verrouAvecPin('123456')
    for (let i = 0; i < 3; i++) verrou = (await deverrouiller(verrou, '000000', T0)).verrou

    const tropTot = await deverrouiller(verrou, '123456', T0 + 500)
    expect(tropTot).toMatchObject({ ok: false, raison: 'trop_tot', resteMs: 500 })

    // Et le bon code passe une fois l'attente écoulée.
    const apres = await deverrouiller(verrou, '123456', T0 + 1001)
    expect(apres.ok).toBe(true)
  })

  it('n’efface jamais rien après N échecs — ce serait un piège', async () => {
    let verrou = await verrouAvecPin('123456')
    for (let i = 0; i < 20; i++) {
      verrou = (await deverrouiller(verrou, '000000', T0 + i * 400_000)).verrou
    }
    // Après vingt échecs, le coffre est intact et le bon code ouvre toujours.
    const resultat = await deverrouiller(verrou, '123456', T0 + 20 * 400_000)
    expect(resultat.ok).toBe(true)
  })

  it('un chiffreur inerte tant que le verrou est fermé', async () => {
    const verrou = await verrouAvecPin('123456')
    expect(verrou.chiffreur.actif).toBe(false)
  })
})

describe('configuration', () => {
  it('refuse un code trop court ou non numérique', () => {
    expect(() => verifierPin('123')).toThrow(/au moins 4/)
    expect(() => verifierPin('abcd')).toThrow(/chiffres/)
    expect(() => verifierPin('')).toThrow()
    expect(() => verifierPin('12 34')).toThrow()
  })

  it('accepte un code valide et ouvre directement', async () => {
    const verrou = await configurerPin('123456')
    expect(verrou.etat.statut).toBe('ouvert')
    expect(verrou.meta).not.toBeNull()
  }, 30_000)
})

describe('verrouillage', () => {
  it('referme et retire la clé de la mémoire', async () => {
    const ouvert = (await deverrouiller(await verrouAvecPin('123456'), '123456', T0)).verrou
    const ferme = verrouiller(ouvert)
    expect(ferme.etat.statut).toBe('verrouille')
    expect(ferme.chiffreur.actif).toBe(false)
  })

  it('remet le compteur d’échecs à zéro', async () => {
    let verrou = await verrouAvecPin('123456')
    for (let i = 0; i < 4; i++) verrou = (await deverrouiller(verrou, '000000', T0)).verrou
    const ouvert = (await deverrouiller(verrou, '123456', T0 + 10_000)).verrou
    const etat = verrouiller(ouvert).etat
    expect(etat.statut === 'verrouille' && etat.echecs).toBe(0)
  })

  it('ne fait rien sur un verrou sans PIN', () => {
    expect(verrouiller(verrouSansPin()).etat.statut).toBe('sans_pin')
  })
})

describe('délai de re-verrouillage', () => {
  it('est court sans être hostile', () => {
    expect(DELAI_REVERROUILLAGE_MS).toBe(120_000)
  })
})
