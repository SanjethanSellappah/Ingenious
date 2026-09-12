import { describe, expect, it } from 'vitest'
import {
  ajouter,
  analyserMontant,
  arrondirCents,
  cents,
  formaterMontant,
  formaterPourSaisie,
  multiplier,
  negatif,
  somme,
  soustraire,
  valeurAbsolue,
} from './money'

describe('construction', () => {
  it('refuse un flottant', () => {
    expect(() => cents(12.5)).toThrow(/non entier/)
  })

  it('refuse NaN et l’infini', () => {
    expect(() => cents(Number.NaN)).toThrow(/non fini/)
    expect(() => cents(Number.POSITIVE_INFINITY)).toThrow(/non fini/)
  })

  it('accepte les négatifs et le zéro', () => {
    expect(cents(-1250)).toBe(-1250)
    expect(cents(0)).toBe(0)
  })
})

describe('arrondi', () => {
  it('éloigne le demi de zéro, symétriquement', () => {
    expect(arrondirCents(0.5)).toBe(1)
    expect(arrondirCents(-0.5)).toBe(-1)
    expect(arrondirCents(1.5)).toBe(2)
    expect(arrondirCents(-1.5)).toBe(-2)
  })

  it('ne fait pas fondre les dépenses — le piège de Math.round', () => {
    // Math.round(-0.5) vaut -0 : une dépense s'allégerait d'un centime à chaque
    // arrondi. Sur douze mensualités, ça se voit.
    expect(arrondirCents(-2.5)).toBe(-3)
    expect(Math.round(-2.5)).toBe(-2)
  })

  it('arrondit normalement en dehors du demi', () => {
    expect(arrondirCents(1.4)).toBe(1)
    expect(arrondirCents(1.6)).toBe(2)
    expect(arrondirCents(-1.4)).toBe(-1)
  })
})

describe('arithmétique', () => {
  it('additionne sans dérive flottante', () => {
    // 0,1 + 0,2 en euros flottants donne 0,30000000000000004.
    expect(ajouter(cents(10), cents(20))).toBe(30)
    expect(somme([cents(10), cents(20), cents(30)])).toBe(60)
    expect(somme([])).toBe(0)
  })

  it('soustrait, oppose, valeur absolue', () => {
    expect(soustraire(cents(1000), cents(1250))).toBe(-250)
    expect(negatif(cents(1250))).toBe(-1250)
    expect(valeurAbsolue(cents(-1250))).toBe(1250)
  })

  it('multiplie puis arrondit une seule fois', () => {
    expect(multiplier(cents(1000), 1.2)).toBe(1200)
    expect(multiplier(cents(333), 3)).toBe(999)
    expect(multiplier(cents(1), 0.5)).toBe(1) // demi éloigné de zéro
    expect(multiplier(cents(-1), 0.5)).toBe(-1)
  })
})

describe('analyse d’une saisie', () => {
  it('accepte la virgule comme le point', () => {
    expect(analyserMontant('12,50')).toBe(1250)
    expect(analyserMontant('12.50')).toBe(1250)
  })

  it('accepte les séparateurs de milliers et le symbole', () => {
    expect(analyserMontant('1 234,56')).toBe(123456)
    expect(analyserMontant('1 234,56')).toBe(123456) // espace insécable
    expect(analyserMontant('1 234,56')).toBe(123456) // espace fine insécable
    expect(analyserMontant('12,50 €')).toBe(1250)
    expect(analyserMontant('12,50€')).toBe(1250)
  })

  it('complète les décimales manquantes', () => {
    expect(analyserMontant('12')).toBe(1200)
    expect(analyserMontant('12,')).toBe(1200)
    expect(analyserMontant('12,5')).toBe(1250)
    expect(analyserMontant(',5')).toBe(50)
  })

  it('gère le signe', () => {
    expect(analyserMontant('-12,50')).toBe(-1250)
    expect(analyserMontant('+12,50')).toBe(1250)
    expect(analyserMontant('-0,01')).toBe(-1)
  })

  it('refuse plus de deux décimales plutôt que de tronquer en silence', () => {
    expect(analyserMontant('12,505')).toBeNull()
    expect(analyserMontant('0,001')).toBeNull()
  })

  it('refuse ce qui n’est pas un montant', () => {
    for (const texte of ['', ' ', '-', 'abc', '12,5,6', '12-50', '1e3']) {
      expect(analyserMontant(texte)).toBeNull()
    }
  })

  it('fait l’aller-retour avec le format de saisie', () => {
    for (const montant of [0, 1, -1, 1250, -1250, 123456, -99]) {
      expect(analyserMontant(formaterPourSaisie(cents(montant)))).toBe(montant)
    }
  })
})

describe('formatage', () => {
  it('rend le format français', () => {
    // L'espace des milliers et celui du symbole sont insécables : on compare
    // sur les chiffres pour ne pas dépendre de la version d'ICU.
    expect(formaterMontant(cents(123456)).replace(/\s/g, ' ')).toBe('1 234,56 €')
    expect(formaterMontant(cents(-1250)).replace(/\s/g, ' ')).toBe('-12,50 €')
    expect(formaterMontant(cents(0)).replace(/\s/g, ' ')).toBe('0,00 €')
  })

  it('affiche toujours deux décimales', () => {
    expect(formaterMontant(cents(1200))).toContain('12,00')
    expect(formaterMontant(cents(5))).toContain('0,05')
  })

  it('peut expliciter le signe positif — l’information ne doit pas tenir à la couleur', () => {
    expect(formaterMontant(cents(1250), { signeExplicite: true })).toMatch(/^\+/)
    expect(formaterMontant(cents(-1250), { signeExplicite: true })).toMatch(/^-/)
    expect(formaterMontant(cents(0), { signeExplicite: true })).not.toMatch(/^\+/)
  })

  it('peut retirer le symbole', () => {
    expect(formaterMontant(cents(1250), { sansSymbole: true })).not.toContain('€')
  })

  it('formate pour la saisie sans séparateur de milliers', () => {
    expect(formaterPourSaisie(cents(123456))).toBe('1234,56')
    expect(formaterPourSaisie(cents(-5))).toBe('-0,05')
    expect(formaterPourSaisie(cents(0))).toBe('0,00')
  })
})
