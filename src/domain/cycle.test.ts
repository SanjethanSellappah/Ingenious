/**
 * Le cycle de vie complet d'une récurrence estimée.
 *
 * C'est le mécanisme du §5.6, éprouvé mois après mois : au premier mois rien
 * n'est estimable, le montant de départ tient lieu de repli ; puis chaque
 * occurrence confirmée entre dans la fenêtre glissante et affine la suivante.
 *
 * Aucun test unitaire ne couvre ce déroulé, parce qu'il traverse quatre modules
 * et ne se trompe qu'à la jointure.
 */
import { describe, expect, it } from 'vitest'
import { dateCivile } from '../core/civilDate'
import { cents, type Cents } from '../core/money'
import { plier } from './etat'
import { validerEvenement, type Evenement, type TypeEvenement } from './events'
import { echeancesDuCompte, occurrencesAConfirmer, projectionDuCompte } from './vues'

const d = dateCivile
const e = (euros: number): Cents => cents(Math.round(euros * 100))
let sequence = 0

function ev(type: TypeEvenement, payload: Record<string, unknown>): Evenement {
  sequence += 1
  return validerEvenement({
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    ts: 1_757_000_000_000 + sequence,
    device: 'test',
    type,
    payload,
  })
}

/** Ce que l'onboarding écrit : un salaire estimé, avec un montant de départ. */
function depart(): Evenement[] {
  return [
    ev('account.created', {
      id: 'c1',
      nom: 'Courant',
      type: 'courant',
      groupe: 'bancaire',
      mode: 'saisi',
    }),
    ev('account.balance_set', { account_id: 'c1', date: '2026-01-05', solde_cents: 100000 }),
    ev('settings.updated', { compte_courant_id: 'c1' }),
    ev('subscription.created', {
      id: 'salaire',
      nom: 'Salaire',
      account_id: 'c1',
      sens: 'rentree',
      montant_mode: 'estime',
      frequence: 'mensuel',
      jour_du_mois: 28,
      date_debut: '2026-01-05',
    }),
    ev('subscription.price_changed', {
      subscription_id: 'salaire',
      montant_cents: 200000,
      valide_du: '2026-01-05',
    }),
  ]
}

function confirmer(date: string, euros: number, exclu = false): Evenement {
  return ev('occurrence.overridden', {
    subscription_id: 'salaire',
    date_theorique: date,
    montant_cents: e(euros),
    statut: 'realise',
    ...(exclu ? { exclu_de_estimation: true } : {}),
  })
}

describe('mois 1 — aucun historique', () => {
  const etat = plier(depart())

  it('projette le montant de départ, marqué estimé', () => {
    const echeance = echeancesDuCompte(etat, 'c1', d('2026-01-05'), d('2026-01-31')).echeances[0]!
    expect(echeance.montant_cents).toBe(e(2000))
    expect(echeance.estime).toBe(true)
  })

  it('réclame l’occurrence dès qu’elle est passée', () => {
    const aConfirmer = occurrencesAConfirmer(plier(depart()), d('2026-02-01'))
    expect(aConfirmer.map((x) => x.date)).toEqual(['2026-01-28'])
  })

  it('ne la compte ni dans le solde ni dans la courbe tant qu’elle n’est pas confirmée', () => {
    const projection = projectionDuCompte(etat, 'c1', d('2026-02-01'), 20)
    // Le solde reste celui du relevé : le salaire de janvier n'est pas ajouté,
    // parce que l'application ne sait pas s'il est arrivé.
    expect(projection.serie[0]!.solde_cents).toBe(e(1000))
    // Et il est réclamé, pas oublié.
    expect(projection.aConfirmer.map((x) => x.date)).toEqual(['2026-01-28'])
  })
})

describe('mois 2 — une occurrence confirmée', () => {
  const etat = plier([...depart(), confirmer('2026-01-28', 2143.67)])

  it('l’estimation prend le réalisé, pas le montant de départ', () => {
    const echeance = echeancesDuCompte(etat, 'c1', d('2026-02-01'), d('2026-02-28')).echeances[0]!
    expect(echeance.montant_cents).toBe(e(2143.67))
  })

  it('les bornes sont confondues : une seule valeur, aucune dispersion', () => {
    const echeance = echeancesDuCompte(etat, 'c1', d('2026-02-01'), d('2026-02-28')).echeances[0]!
    expect(echeance.borne_basse_cents).toBe(echeance.borne_haute_cents)
  })

  it('ne réclame plus l’occurrence confirmée', () => {
    expect(occurrencesAConfirmer(etat, d('2026-02-01'))).toEqual([])
  })
})

describe('mois 4 — la fenêtre se remplit', () => {
  const etat = plier([
    ...depart(),
    confirmer('2026-01-28', 2143.67),
    confirmer('2026-02-28', 1980.0),
    confirmer('2026-03-28', 2050.0),
  ])

  it('la médiane s’impose', () => {
    const echeance = echeancesDuCompte(etat, 'c1', d('2026-04-01'), d('2026-04-30')).echeances[0]!
    // Médiane de 1 980, 2 050 et 2 143,67.
    expect(echeance.montant_cents).toBe(e(2050))
  })

  it('la fourchette s’ouvre enfin', () => {
    const echeance = echeancesDuCompte(etat, 'c1', d('2026-04-01'), d('2026-04-30')).echeances[0]!
    expect(echeance.borne_basse_cents).toBe(e(1980))
    expect(echeance.borne_haute_cents).toBe(e(2143.67))
  })

  it('la projection devient incertaine à partir de cette échéance', () => {
    const projection = projectionDuCompte(etat, 'c1', d('2026-04-01'), 40)
    expect(projection.premiereEstimation).toBe('2026-04-28')
    const avant = projection.serie.find((p) => p.date === '2026-04-27')!
    expect(avant.borne_basse_cents).toBe(avant.solde_cents)
    const apres = projection.serie.find((p) => p.date === '2026-04-29')!
    expect(apres.borne_basse_cents).toBeLessThan(apres.solde_cents)
  })
})

describe('une prime écartée ne fausse pas les mois suivants', () => {
  const avecPrime = plier([
    ...depart(),
    confirmer('2026-01-28', 2143.67),
    confirmer('2026-02-28', 1980.0),
    confirmer('2026-03-28', 2050.0),
    confirmer('2026-04-28', 4000.0, true),
  ])

  it('l’estimation ignore la prime', () => {
    const echeance = echeancesDuCompte(avecPrime, 'c1', d('2026-05-01'), d('2026-05-31'))
      .echeances[0]!
    expect(echeance.montant_cents).toBe(e(2050))
    expect(echeance.borne_haute_cents).toBe(e(2143.67))
  })

  it('sans l’écarter, elle tirerait tout vers le haut', () => {
    const sansEcarter = plier([
      ...depart(),
      confirmer('2026-01-28', 2143.67),
      confirmer('2026-02-28', 1980.0),
      confirmer('2026-03-28', 2050.0),
      confirmer('2026-04-28', 4000.0),
    ])
    const echeance = echeancesDuCompte(sansEcarter, 'c1', d('2026-05-01'), d('2026-05-31'))
      .echeances[0]!
    // Médiane de quatre valeurs : moyenne des deux centrales, 2 050 et 2 143,67.
    expect(echeance.montant_cents).toBe(e(2096.84))
    expect(echeance.borne_haute_cents).toBe(e(4000))
  })
})

describe('correction d’une confirmation', () => {
  it('la dernière écriture gagne, sans seconde ligne', () => {
    const etat = plier([
      ...depart(),
      confirmer('2026-01-28', 2143.67),
      // L'utilisateur s'était trompé : il ressaisit.
      confirmer('2026-01-28', 2134.67),
    ])
    const echeance = echeancesDuCompte(etat, 'c1', d('2026-02-01'), d('2026-02-28')).echeances[0]!
    expect(echeance.montant_cents).toBe(e(2134.67))
    expect(etat.exceptions.size).toBe(1)
  })
})

describe('une occurrence sans montant connu', () => {
  /**
   * Le cas le plus facile à laisser dans une impasse : une récurrence estimée
   * créée sans montant de départ. L'application sait qu'elle existe, ne sait pas
   * combien, et doit permettre de le dire — sinon elle signale un problème
   * qu'aucun écran ne résout.
   */
  const sansMontant = [
    ev('account.created', {
      id: 'c1',
      nom: 'Courant',
      type: 'courant',
      groupe: 'bancaire',
      mode: 'saisi',
    }),
    ev('settings.updated', { compte_courant_id: 'c1' }),
    ev('subscription.created', {
      id: 'elec',
      nom: 'Électricité',
      account_id: 'c1',
      sens: 'depense',
      montant_mode: 'estime',
      frequence: 'mensuel',
      jour_du_mois: 5,
      date_debut: '2026-06-05',
    }),
  ]

  it('est réclamée, avec la mention que le montant manque', () => {
    const aConfirmer = occurrencesAConfirmer(plier(sansMontant), d('2026-09-12'))
    expect(aConfirmer.length).toBeGreaterThan(0)
    expect(aConfirmer.every((x) => x.montantConnu === false)).toBe(true)
    expect(aConfirmer.map((x) => x.date)).toContain('2026-09-05')
  })

  it('disparaît de la réclamation une fois renseignée', () => {
    const renseignee = plier([
      ...sansMontant,
      ev('occurrence.overridden', {
        subscription_id: 'elec',
        date_theorique: '2026-09-05',
        montant_cents: 7840,
        statut: 'realise',
      }),
    ])
    const aConfirmer = occurrencesAConfirmer(renseignee, d('2026-09-12'))
    expect(aConfirmer.map((x) => x.date)).not.toContain('2026-09-05')
  })

  it('alimente ensuite l’estimation des mois suivants', () => {
    const renseignee = plier([
      ...sansMontant,
      ev('occurrence.overridden', {
        subscription_id: 'elec',
        date_theorique: '2026-08-05',
        montant_cents: 7840,
        statut: 'realise',
      }),
    ])
    const echeance = echeancesDuCompte(renseignee, 'c1', d('2026-09-12'), d('2026-10-31'))
      .echeances[0]!
    expect(echeance.montant_cents).toBe(e(-78.4))
  })
})
