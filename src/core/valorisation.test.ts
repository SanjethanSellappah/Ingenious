import { describe, expect, it } from 'vitest'
import { dateCivile } from './civilDate'
import { cents } from './money'
import { coursValideA, MILLIEMES, valeurLigne, valoriser } from './valorisation'

const d = dateCivile
const c = (euros: number) => cents(Math.round(euros * 100))
const cours = (date: string, euros: number) => ({ date: d(date), cours_cents: c(euros) })

describe('cours valide à une date', () => {
  const historique = [cours('2026-01-05', 30), cours('2026-06-10', 38), cours('2026-09-01', 41)]

  it('retient le dernier cours connu à cette date', () => {
    expect(coursValideA(historique, d('2026-07-01'))?.cours_cents).toBe(c(38))
  })

  it('ignore un cours postérieur : relire mars avec les cours de septembre serait faux', () => {
    expect(coursValideA(historique, d('2026-03-01'))?.cours_cents).toBe(c(30))
  })

  it('ne rend rien avant le premier cours connu', () => {
    expect(coursValideA(historique, d('2025-12-31'))).toBeNull()
  })
})

describe('valeur d’une ligne', () => {
  it('multiplie une quantité en millièmes par un cours', () => {
    expect(valeurLigne(12 * MILLIEMES, c(38.42))).toBe(c(461.04))
  })

  it('tient une quantité fractionnaire', () => {
    // 3,5 g d'or à 72,40 € le gramme.
    expect(valeurLigne(3500, c(72.4))).toBe(c(253.4))
  })

  it('arrondit au centime, jamais la quantité', () => {
    // 0,333 part à 10,01 € : 3,33333 € → 3,33 €.
    expect(valeurLigne(333, c(10.01))).toBe(c(3.33))
  })
})

describe('valorisation d’un portefeuille', () => {
  const coursParInstrument = new Map([
    ['cw8', [cours('2026-09-01', 38.42)]],
    ['ese', [cours('2026-08-20', 29.1)]],
  ])

  it('additionne les lignes et rend la date du cours le plus ancien', () => {
    const resultat = valoriser(
      [
        { instrument_id: 'cw8', quantite_millimes: 12 * MILLIEMES },
        { instrument_id: 'ese', quantite_millimes: 5 * MILLIEMES },
      ],
      coursParInstrument,
      d('2026-09-12'),
    )
    expect(resultat.total_cents).toBe(c(606.54))
    expect(resultat.sansCours).toBe(0)
    // Le plus ancien, pas le plus récent : c'est lui qui dit l'âge de la valeur.
    expect(resultat.coursLePlusAncien).toBe('2026-08-20')
  })

  /**
   * Une ligne sans cours ne vaut pas zéro.
   *
   * La compter pour rien ferait baisser le patrimoine au moment même où l'on
   * ajoute une ligne — soit l'inverse exact de ce qui vient de se passer.
   */
  it('n’attribue pas zéro à une ligne dont le cours manque', () => {
    const resultat = valoriser(
      [
        { instrument_id: 'cw8', quantite_millimes: 12 * MILLIEMES },
        { instrument_id: 'inconnu', quantite_millimes: 3 * MILLIEMES },
      ],
      coursParInstrument,
      d('2026-09-12'),
    )
    expect(resultat.total_cents).toBe(c(461.04))
    expect(resultat.sansCours).toBe(1)
    expect(resultat.lignes[1]!.valeur_cents).toBeNull()
  })

  it('rend zéro et aucune date sur un portefeuille vide', () => {
    const resultat = valoriser([], coursParInstrument, d('2026-09-12'))
    expect(resultat.total_cents).toBe(0)
    expect(resultat.coursLePlusAncien).toBeNull()
  })
})
