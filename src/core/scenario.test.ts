/**
 * Scénario de bout en bout : une vraie situation, des vrais chiffres.
 *
 * Les tests unitaires vérifient chaque module isolément. Celui-ci vérifie qu'ils
 * disent la même chose une fois assemblés — c'est là que se cachent les erreurs
 * de raccordement, qui ne se voient dans aucun des deux modules pris séparément.
 */
import { describe, expect, it } from 'vitest'
import { dateCivile, nomDuJour } from './civilDate'
import { echeancesDesRecurrences, type Recurrence } from './echeances'
import { cents, formaterMontant, type Cents } from './money'
import { projeterSolde } from './projection'
import { resteAVivre } from './resteAVivre'

const d = dateCivile
const e = (euros: number): Cents => cents(Math.round(euros * 100))

const AUJOURDHUI = d('2026-09-11')
const SOLDE_COURANT = e(1200)

/** Loyer de 700 €, prélevé le 1er, avancé au jour ouvré précédent. */
const loyer: Recurrence = {
  id: 'loyer',
  libelle: 'Loyer',
  sens: 'depense',
  montant_mode: 'fixe',
  regle: {
    frequence: 'mensuel',
    jour_du_mois: 1,
    regle_weekend: 'jour_ouvre_precedent',
    date_debut: d('2025-01-01'),
  },
  prix: [{ montant_cents: e(700), valide_du: d('2025-01-01') }],
}

/** Abonnement passé de 9,99 € à 12,99 € le 1er mars 2026. */
const netflix: Recurrence = {
  id: 'netflix',
  libelle: 'Netflix',
  sens: 'depense',
  montant_mode: 'fixe',
  regle: { frequence: 'mensuel', jour_du_mois: 15, date_debut: d('2025-01-15') },
  prix: [
    { montant_cents: e(9.99), valide_du: d('2025-01-01'), valide_au: d('2026-02-28') },
    { montant_cents: e(12.99), valide_du: d('2026-03-01') },
  ],
}

/** Facture variable, avec une régularisation d'août mise à l'écart. */
const electricite: Recurrence = {
  id: 'elec',
  libelle: 'Électricité',
  sens: 'depense',
  montant_mode: 'estime',
  regle: { frequence: 'mensuel', jour_du_mois: 20, date_debut: d('2025-01-20') },
  realisees: [
    { date_theorique: d('2026-05-20'), montant_cents: e(78) },
    { date_theorique: d('2026-06-20'), montant_cents: e(62) },
    { date_theorique: d('2026-07-20'), montant_cents: e(55) },
    { date_theorique: d('2026-08-20'), montant_cents: e(140), exclu_de_estimation: true },
  ],
}

/** Salaire variable, versé le 30, avancé au jour ouvré précédent. */
const salaire: Recurrence = {
  id: 'salaire',
  libelle: 'Salaire',
  sens: 'rentree',
  montant_mode: 'estime',
  regle: {
    frequence: 'mensuel',
    jour_du_mois: 30,
    regle_weekend: 'jour_ouvre_precedent',
    date_debut: d('2025-01-30'),
  },
  realisees: [
    { date_theorique: d('2026-06-30'), montant_cents: e(2000) },
    { date_theorique: d('2026-07-30'), montant_cents: e(2200) },
    { date_theorique: d('2026-08-30'), montant_cents: e(1900) },
  ],
}

const toutes = [loyer, netflix, electricite, salaire]
const { echeances, nonResolues } = echeancesDesRecurrences(toutes, AUJOURDHUI, d('2026-11-30'))

describe('échéances valorisées', () => {
  it('valorise tout ce qui est projetable', () => {
    expect(nonResolues).toEqual([])
  })

  it('applique le tarif du moment, le décalage jour ouvré et la médiane', () => {
    expect(
      echeances.map(
        (x) => `${x.date} ${x.libelle} ${formaterMontant(x.montant_cents).replace(/\s/g, ' ')}`,
      ),
    ).toEqual([
      '2026-09-15 Netflix -12,99 €',
      '2026-09-20 Électricité -62,00 €',
      '2026-09-30 Salaire 2 000,00 €',
      '2026-10-01 Loyer -700,00 €',
      '2026-10-15 Netflix -12,99 €',
      '2026-10-20 Électricité -62,00 €',
      '2026-10-30 Loyer -700,00 €',
      '2026-10-30 Salaire 2 000,00 €',
      '2026-11-15 Netflix -12,99 €',
      '2026-11-20 Électricité -62,00 €',
      '2026-11-30 Salaire 2 000,00 €',
    ])
  })

  it('paie le loyer de novembre en octobre, sans changer la règle', () => {
    // Le 1er novembre 2026 est un dimanche : le prélèvement est avancé au
    // vendredi 30 octobre. Octobre porte donc deux loyers, et novembre aucun —
    // c'est le mois qui est bousculé, jamais la règle.
    expect(nomDuJour(d('2026-11-01'))).toBe('dimanche')
    const loyers = echeances.filter((x) => x.libelle === 'Loyer')
    expect(loyers.map((x) => [x.reference!.date_theorique, x.date])).toEqual([
      ['2026-10-01', '2026-10-01'],
      ['2026-11-01', '2026-10-30'],
    ])
  })

  it('écarte la régularisation d’août de l’estimation d’électricité', () => {
    // Médiane de 78, 62 et 55 — la régularisation de 140 € est mise à l'écart.
    // Sans cette exclusion, la médiane monterait à 70 € et les six mois suivants
    // seraient faussés par un événement qui ne se reproduira pas.
    const elec = echeances.find((x) => x.libelle === 'Électricité')!
    expect(elec.montant_cents).toBe(e(-62))
    expect(elec.borne_basse_cents).toBe(e(-78))
    expect(elec.borne_haute_cents).toBe(e(-55))
  })
})

describe('projection du compte courant', () => {
  const projection = projeterSolde({
    soldeActuel: SOLDE_COURANT,
    echeances,
    debut: AUJOURDHUI,
    fin: d('2026-10-31'),
  })

  it('part du solde connu', () => {
    expect(projection.serie[0]).toMatchObject({ date: '2026-09-11', solde_cents: 120000 })
  })

  it('marque la frontière entre ce qui est su et ce qui est estimé', () => {
    expect(projection.premiereEstimation).toBe('2026-09-20')
    const veille = projection.serie.find((x) => x.date === '2026-09-19')!
    const apres = projection.serie.find((x) => x.date === '2026-09-21')!
    expect(veille.incertain).toBe(false)
    expect(veille.borne_basse_cents).toBe(veille.solde_cents)
    expect(apres.incertain).toBe(true)
    expect(apres.borne_basse_cents).toBeLessThan(apres.solde_cents)
  })

  it('trouve le point bas avant le salaire', () => {
    // 1 200 − 12,99 − 62 = 1 125,01 le 20 septembre, creux jusqu'au versement.
    expect(projection.pointBas).toEqual({ date: '2026-09-20', solde_cents: 112501 })
    expect(projection.pointBasPessimiste.solde_cents).toBe(110901)
  })

  it('dit de quoi le chiffre est composé', () => {
    expect(projection.composition.echeances).toBe(8)
    expect(projection.composition.echeancesEstimees).toBe(4)
    expect(projection.composition.echeancesEchues).toEqual([])
  })

  it('encadre le solde de fin de période', () => {
    const fin = projection.serie.at(-1)!
    expect(fin.solde_cents).toBe(365002)
    expect(fin.borne_basse_cents).toBe(341802)
    expect(fin.borne_haute_cents).toBe(406402)
    expect(fin.borne_basse_cents).toBeLessThan(fin.solde_cents)
    expect(fin.borne_haute_cents).toBeGreaterThan(fin.solde_cents)
  })
})

describe('reste à vivre', () => {
  const rav = resteAVivre({
    soldeCourant: SOLDE_COURANT,
    echeances,
    reserve_cents: e(150),
    depuis: AUJOURDHUI,
  })

  it('court jusqu’au salaire, sans le compter', () => {
    expect(rav.prochaineRentree).toBe('2026-09-30')
    expect(rav.horizon).toBe('2026-09-30')
    expect(rav.horizonParDefaut).toBe(false)
  })

  it('retient la facture la plus lourde de la fourchette, pas la médiane', () => {
    // 1 200 − 12,99 (Netflix) − 78 (électricité au pire) − 150 (réserve).
    expect(rav.montant_cents).toBe(e(959.01))
    // Avec la médiane, on afficherait 16 € de plus — seize euros qu'on aurait
    // dépensés en croyant les avoir.
    expect(rav.montant_central_cents).toBe(e(975.01))
    expect(rav.montant_cents).toBeLessThan(rav.montant_central_cents)
  })

  it('permet d’écrire « 2 échéances connues, dont 1 estimée »', () => {
    expect(rav.composition.echeances).toBe(2)
    expect(rav.composition.echeancesEstimees).toBe(1)
  })
})

describe('le mois suivant, une fois le salaire réellement connu', () => {
  it('remplace l’estimation par le réel sans créer de seconde ligne', () => {
    const salaireRegularise: Recurrence = {
      ...salaire,
      exceptions: [
        { date_theorique: d('2026-09-30'), montant_cents: e(2143.67), statut: 'realise' },
      ],
    }
    const apres = echeancesDesRecurrences(
      [salaireRegularise],
      d('2026-09-11'),
      d('2026-09-30'),
    ).echeances
    expect(apres).toHaveLength(1)
    expect(apres[0]!.montant_cents).toBe(e(2143.67))
    expect(apres[0]!.estime).toBe(false)
    expect(apres[0]!.borne_basse_cents).toBe(apres[0]!.borne_haute_cents)
  })

  it('ne dépend plus d’aucune estimation une fois tout réalisé', () => {
    const tousRealises = toutes.map((r) =>
      r.montant_mode === 'estime'
        ? {
            ...r,
            exceptions: [
              {
                date_theorique: d(r.id === 'salaire' ? '2026-09-30' : '2026-09-20'),
                montant_cents: e(r.id === 'salaire' ? 2143.67 : 71.4),
                statut: 'realise' as const,
              },
            ],
          }
        : r,
    )
    const projection = projeterSolde({
      soldeActuel: SOLDE_COURANT,
      echeances: echeancesDesRecurrences(tousRealises, AUJOURDHUI, d('2026-09-30')).echeances,
      debut: AUJOURDHUI,
      fin: d('2026-09-30'),
    })
    expect(projection.premiereEstimation).toBeNull()
    expect(projection.serie.every((p) => p.borne_basse_cents === p.solde_cents)).toBe(true)
  })
})

describe('échéance échue non confirmée', () => {
  it('n’entre ni dans le solde ni dans la projection, mais est réclamée', () => {
    // On est le 16 septembre : le prélèvement Netflix du 15 n'a pas été confirmé.
    const projection = projeterSolde({
      soldeActuel: SOLDE_COURANT,
      echeances,
      debut: d('2026-09-16'),
      fin: d('2026-09-30'),
    })
    expect(projection.serie[0]!.solde_cents).toBe(120000)
    expect(projection.composition.echeancesEchues.map((x) => x.libelle)).toEqual(['Netflix'])
  })
})
