import { describe, expect, it } from 'vitest'
import { dateCivile } from './civilDate'
import { cents, type Cents } from './money'
import type { EcheanceProjetee } from './projection'
import { resteAVivre } from './resteAVivre'

const d = dateCivile
const e = (euros: number): Cents => cents(Math.round(euros * 100))

function certaine(date: string, euros: number, libelle = 'échéance'): EcheanceProjetee {
  const montant = e(euros)
  return {
    date: d(date),
    montant_cents: montant,
    borne_basse_cents: montant,
    borne_haute_cents: montant,
    estime: false,
    libelle,
  }
}

function estimee(date: string, centrale: number, min: number, max: number): EcheanceProjetee {
  return {
    date: d(date),
    montant_cents: e(centrale),
    borne_basse_cents: e(Math.min(min, max)),
    borne_haute_cents: e(Math.max(min, max)),
    estime: true,
  }
}

const depuis = d('2026-09-11')

describe('calcul', () => {
  it('retire les échéances d’ici la prochaine rentrée, et la réserve', () => {
    const r = resteAVivre({
      soldeCourant: e(1200),
      echeances: [
        certaine('2026-09-15', -80, 'électricité'),
        certaine('2026-09-20', -40, 'abonnements'),
        certaine('2026-09-30', 2000, 'salaire'),
      ],
      reserve_cents: e(200),
      depuis,
    })
    expect(r.prochaineRentree).toBe('2026-09-30')
    expect(r.horizon).toBe('2026-09-30')
    expect(r.montant_cents).toBe(e(1200 - 80 - 40 - 200))
    expect(r.composition.echeances).toBe(2)
  })

  it('n’ajoute jamais la rentrée attendue — ce n’est pas de l’argent disponible', () => {
    const r = resteAVivre({
      soldeCourant: e(500),
      echeances: [certaine('2026-09-30', 2000, 'salaire')],
      reserve_cents: e(0),
      depuis,
    })
    expect(r.montant_cents).toBe(e(500))
  })

  it('ignore les échéances postérieures à la rentrée', () => {
    const r = resteAVivre({
      soldeCourant: e(1000),
      echeances: [certaine('2026-09-30', 2000), certaine('2026-10-05', -600, 'loyer')],
      reserve_cents: e(0),
      depuis,
    })
    expect(r.montant_cents).toBe(e(1000))
  })

  it('ignore ce qui est déjà passé', () => {
    const r = resteAVivre({
      soldeCourant: e(1000),
      echeances: [certaine('2026-09-05', -600, 'loyer déjà prélevé'), certaine('2026-09-30', 2000)],
      reserve_cents: e(0),
      depuis,
    })
    expect(r.montant_cents).toBe(e(1000))
    expect(r.composition.echeances).toBe(0)
  })

  it('accepte de passer en négatif plutôt que de border à zéro', () => {
    const r = resteAVivre({
      soldeCourant: e(100),
      echeances: [certaine('2026-09-15', -400, 'loyer'), certaine('2026-09-30', 2000)],
      reserve_cents: e(50),
      depuis,
    })
    expect(r.montant_cents).toBe(e(-350))
  })
})

describe('montants estimés', () => {
  it('retient la plus grosse facture possible, pas la médiane', () => {
    const r = resteAVivre({
      soldeCourant: e(1000),
      echeances: [estimee('2026-09-15', -90, -140, -70), certaine('2026-09-30', 2000)],
      reserve_cents: e(0),
      depuis,
    })
    // Le chiffre affiché retient 140 € ; la valeur centrale (90 €) reste
    // disponible, mais elle ne doit pas être ce qu'on lit en gros.
    expect(r.montant_cents).toBe(e(860))
    expect(r.montant_central_cents).toBe(e(910))
    expect(r.composition.echeancesEstimees).toBe(1)
  })

  it('borne aussi la rentrée qui fixe l’horizon — au plus tôt donc au plus prudent', () => {
    // Une rentrée estimée sert d'horizon comme une autre : c'est sa date qui
    // compte ici, pas son montant, qui n'entre jamais dans le calcul.
    const r = resteAVivre({
      soldeCourant: e(1000),
      echeances: [estimee('2026-09-28', 2000, 1600, 2400), certaine('2026-10-02', -700, 'loyer')],
      reserve_cents: e(0),
      depuis,
    })
    expect(r.prochaineRentree).toBe('2026-09-28')
    expect(r.montant_cents).toBe(e(1000))
  })
})

describe('horizon', () => {
  it('se rabat sur la fin du mois quand aucune rentrée n’est connue', () => {
    const r = resteAVivre({
      soldeCourant: e(800),
      echeances: [certaine('2026-09-20', -120)],
      reserve_cents: e(0),
      depuis,
    })
    expect(r.prochaineRentree).toBeNull()
    expect(r.horizonParDefaut).toBe(true)
    expect(r.horizon).toBe('2026-09-30')
    expect(r.montant_cents).toBe(e(680))
  })

  it('ne va pas chercher une rentrée au-delà de l’horizon maximal', () => {
    const r = resteAVivre({
      soldeCourant: e(800),
      echeances: [certaine('2026-12-01', 2000)],
      reserve_cents: e(0),
      depuis,
    })
    expect(r.prochaineRentree).toBeNull()
    expect(r.horizonParDefaut).toBe(true)
  })

  it('accepte un horizon maximal réduit', () => {
    const echeances = [certaine('2026-10-25', 2000)]
    expect(
      resteAVivre({ soldeCourant: e(0), echeances, reserve_cents: e(0), depuis }).prochaineRentree,
    ).toBe('2026-10-25')
    expect(
      resteAVivre({
        soldeCourant: e(0),
        echeances,
        reserve_cents: e(0),
        depuis,
        horizonMaxJours: 15,
      }).prochaineRentree,
    ).toBeNull()
  })

  it('rend une fenêtre vide le dernier jour du mois sans rentrée connue', () => {
    // Repli de fin de mois alors qu'on y est déjà : plus rien à retirer.
    const r = resteAVivre({
      soldeCourant: e(300),
      echeances: [certaine('2026-09-30', -50)],
      reserve_cents: e(0),
      depuis: d('2026-09-30'),
    })
    expect(r.horizon).toBe('2026-09-30')
    expect(r.composition.echeances).toBe(0)
    expect(r.montant_cents).toBe(e(300))
  })

  it('prend la rentrée la plus proche quand il y en a plusieurs', () => {
    const r = resteAVivre({
      soldeCourant: e(1000),
      echeances: [certaine('2026-10-05', 500, 'prime'), certaine('2026-09-30', 2000, 'salaire')],
      reserve_cents: e(0),
      depuis,
    })
    expect(r.prochaineRentree).toBe('2026-09-30')
  })
})

describe('composition', () => {
  it('permet d’écrire « 2 échéances connues »', () => {
    const r = resteAVivre({
      soldeCourant: e(1000),
      echeances: [
        certaine('2026-09-15', -80),
        estimee('2026-09-18', -60, -90, -50),
        certaine('2026-09-30', 2000),
      ],
      reserve_cents: e(0),
      depuis,
    })
    expect(r.composition).toEqual({
      echeances: 2,
      echeancesEstimees: 1,
      total_echeances_cents: e(-170),
    })
  })
})
