import { describe, expect, it } from 'vitest'
import { dateCivile } from './civilDate'
import { echeancesDeLaRecurrence, echeancesDesRecurrences, type Recurrence } from './echeances'
import { cents, type Cents } from './money'

const d = dateCivile
const e = (euros: number): Cents => cents(Math.round(euros * 100))

const netflix: Recurrence = {
  id: 'abo-netflix',
  libelle: 'Netflix',
  sens: 'depense',
  montant_mode: 'fixe',
  regle: { frequence: 'mensuel', jour_du_mois: 15, date_debut: d('2025-01-15') },
  prix: [
    { montant_cents: e(9.99), valide_du: d('2025-01-01'), valide_au: d('2026-02-28') },
    { montant_cents: e(12.99), valide_du: d('2026-03-01') },
  ],
}

const salaire: Recurrence = {
  id: 'rec-salaire',
  libelle: 'Salaire',
  sens: 'rentree',
  montant_mode: 'estime',
  regle: {
    frequence: 'mensuel',
    jour_du_mois: 30,
    regle_weekend: 'jour_ouvre_precedent',
    regle_mois_court: 'dernier_jour',
    date_debut: d('2025-01-30'),
  },
  realisees: [
    { date_theorique: d('2026-06-30'), montant_cents: e(2000) },
    { date_theorique: d('2026-07-30'), montant_cents: e(2200) },
    { date_theorique: d('2026-08-30'), montant_cents: e(1900) },
  ],
}

describe('valorisation', () => {
  it('applique le tarif valide à la date théorique, pas le tarif courant', () => {
    const fevrier = echeancesDeLaRecurrence(netflix, d('2026-02-01'), d('2026-02-28')).echeances
    const mars = echeancesDeLaRecurrence(netflix, d('2026-03-01'), d('2026-03-31')).echeances
    expect(fevrier[0]!.montant_cents).toBe(e(-9.99))
    expect(mars[0]!.montant_cents).toBe(e(-12.99))
  })

  it('porte une dépense en négatif et une rentrée en positif', () => {
    const depense = echeancesDeLaRecurrence(netflix, d('2026-09-01'), d('2026-09-30')).echeances[0]!
    const rentree = echeancesDeLaRecurrence(salaire, d('2026-09-01'), d('2026-09-30')).echeances[0]!
    expect(depense.montant_cents).toBeLessThan(0)
    expect(rentree.montant_cents).toBeGreaterThan(0)
  })

  it('estime par la médiane et encadre par le min et le max', () => {
    const septembre = echeancesDeLaRecurrence(salaire, d('2026-09-01'), d('2026-09-30'))
      .echeances[0]!
    expect(septembre.montant_cents).toBe(e(2000))
    expect(septembre.borne_basse_cents).toBe(e(1900))
    expect(septembre.borne_haute_cents).toBe(e(2200))
    expect(septembre.estime).toBe(true)
  })

  it('garde le lien vers la date théorique, qui est la clé de l’occurrence', () => {
    // Le 30 septembre 2026 est un mercredi ; la règle recule au jour ouvré, donc
    // rien ne bouge. La référence porte la théorique, l'échéance la réelle.
    const septembre = echeancesDeLaRecurrence(salaire, d('2026-09-01'), d('2026-09-30'))
      .echeances[0]!
    expect(septembre.reference).toEqual({
      subscription_id: 'rec-salaire',
      date_theorique: '2026-09-30',
    })
  })

  it('décale la date réelle sans toucher la théorique', () => {
    // 30 mai 2026 est un samedi : la rentrée arrive le vendredi 29.
    const mai = echeancesDeLaRecurrence(salaire, d('2026-05-01'), d('2026-05-31')).echeances[0]!
    expect(mai.reference!.date_theorique).toBe('2026-05-30')
    expect(mai.date).toBe('2026-05-29')
  })
})

describe('exceptions', () => {
  it('le réalisé remplace l’estimation, sans créer de seconde ligne', () => {
    const avecReel: Recurrence = {
      ...salaire,
      exceptions: [{ date_theorique: d('2026-09-30'), montant_cents: e(2150), statut: 'realise' }],
    }
    const echeances = echeancesDeLaRecurrence(avecReel, d('2026-09-01'), d('2026-09-30')).echeances
    expect(echeances).toHaveLength(1)
    expect(echeances[0]!.montant_cents).toBe(e(2150))
    expect(echeances[0]!.estime).toBe(false)
    expect(echeances[0]!.borne_basse_cents).toBe(echeances[0]!.borne_haute_cents)
  })

  it('un prévisionnel saisi l’emporte sur l’estimation, mais pas sur le réalisé', () => {
    const base = { ...salaire }
    const previsionnel = {
      ...base,
      exceptions: [
        {
          date_theorique: d('2026-09-30'),
          montant_cents: e(1750),
          statut: 'previsionnel' as const,
        },
      ],
    }
    expect(
      echeancesDeLaRecurrence(previsionnel, d('2026-09-01'), d('2026-09-30')).echeances[0]!
        .montant_cents,
    ).toBe(e(1750))
  })

  it('une exception ne vaut que pour sa date théorique', () => {
    const avecReel: Recurrence = {
      ...salaire,
      exceptions: [{ date_theorique: d('2026-09-30'), montant_cents: e(2150), statut: 'realise' }],
    }
    const octobre = echeancesDeLaRecurrence(avecReel, d('2026-10-01'), d('2026-10-31'))
      .echeances[0]!
    expect(octobre.montant_cents).toBe(e(2000)) // retour à l'estimation
  })
})

describe('ce qui ne peut pas être valorisé', () => {
  it('rend à part un abonnement estimé sans historique, plutôt que de le compter zéro', () => {
    const sansHistorique: Recurrence = { ...salaire, realisees: [] }
    const resultat = echeancesDeLaRecurrence(sansHistorique, d('2026-09-01'), d('2026-09-30'))
    expect(resultat.echeances).toHaveLength(0)
    expect(resultat.nonResolues).toHaveLength(1)
    expect(resultat.nonResolues[0]!.raison).toBe('aucun_historique_a_estimer')
    expect(resultat.nonResolues[0]!.occurrence.date_theorique).toBe('2026-09-30')
  })

  it('rend à part une échéance antérieure à tout tarif connu', () => {
    // Règle démarrée avant le premier tarif enregistré : l'occurrence existe,
    // mais aucun montant ne lui est attachable.
    const anterieur: Recurrence = {
      ...netflix,
      regle: { frequence: 'mensuel', jour_du_mois: 15, date_debut: d('2024-06-15') },
    }
    const resultat = echeancesDeLaRecurrence(anterieur, d('2024-06-01'), d('2024-06-30'))
    expect(resultat.echeances).toHaveLength(0)
    expect(resultat.nonResolues).toHaveLength(1)
    expect(resultat.nonResolues[0]!.raison).toBe('aucun_tarif_connu')
    expect(resultat.nonResolues[0]!.occurrence.date_theorique).toBe('2024-06-15')
  })

  it('ne produit rien pour une récurrence inactive', () => {
    const resilie: Recurrence = { ...netflix, actif: false }
    expect(echeancesDeLaRecurrence(resilie, d('2026-09-01'), d('2026-09-30')).echeances).toEqual([])
  })
})

describe('plusieurs récurrences', () => {
  it('fusionne et trie par date réelle', () => {
    const resultat = echeancesDesRecurrences([salaire, netflix], d('2026-09-01'), d('2026-10-31'))
    expect(resultat.echeances.map((x) => `${x.date} ${x.libelle}`)).toEqual([
      '2026-09-15 Netflix',
      '2026-09-30 Salaire',
      '2026-10-15 Netflix',
      '2026-10-30 Salaire',
    ])
  })
})

describe('montant de départ', () => {
  /**
   * Le cas de l'onboarding : une récurrence estimée dont aucune occurrence n'a
   * encore été confirmée. Sans repli, elle disparaîtrait de la projection
   * pendant tout le premier mois puis réapparaîtrait — une courbe qui ment sans
   * rien signaler.
   */
  const neuve: Recurrence = {
    id: 'salaire-neuf',
    libelle: 'Salaire',
    sens: 'rentree',
    montant_mode: 'estime',
    regle: { frequence: 'mensuel', jour_du_mois: 30, date_debut: d('2026-09-01') },
    prix: [{ montant_cents: e(2000), valide_du: d('2026-09-01') }],
    realisees: [],
  }

  it('sert de repli quand aucune occurrence n’a été confirmée', () => {
    const echeance = echeancesDeLaRecurrence(neuve, d('2026-09-01'), d('2026-09-30')).echeances[0]!
    expect(echeance.montant_cents).toBe(e(2000))
    // Marqué estimé : c'est une valeur annoncée, pas constatée.
    expect(echeance.estime).toBe(true)
    // Bornes confondues : aucune dispersion n'a été mesurée, en inventer une
    // serait pire que de n'en afficher aucune.
    expect(echeance.borne_basse_cents).toBe(echeance.borne_haute_cents)
  })

  it('vaut pour tous les mois, pas seulement le premier', () => {
    const resultat = echeancesDeLaRecurrence(neuve, d('2026-09-01'), d('2026-12-31'))
    expect(resultat.echeances).toHaveLength(4)
    expect(resultat.nonResolues).toEqual([])
  })

  it('cède la place à l’estimation dès qu’une occurrence est confirmée', () => {
    const avecHistorique: Recurrence = {
      ...neuve,
      realisees: [
        { date_theorique: d('2026-09-30'), montant_cents: e(2140) },
        { date_theorique: d('2026-10-30'), montant_cents: e(2080) },
      ],
    }
    const echeance = echeancesDeLaRecurrence(avecHistorique, d('2026-11-01'), d('2026-11-30'))
      .echeances[0]!
    // Médiane de 2 140 et 2 080, pas le montant de départ de 2 000.
    expect(echeance.montant_cents).toBe(e(2110))
    expect(echeance.borne_basse_cents).toBe(e(2080))
  })

  it('cède la place au réalisé de l’occurrence', () => {
    const avecReel: Recurrence = {
      ...neuve,
      exceptions: [{ date_theorique: d('2026-09-30'), montant_cents: e(1950), statut: 'realise' }],
    }
    const echeance = echeancesDeLaRecurrence(avecReel, d('2026-09-01'), d('2026-09-30'))
      .echeances[0]!
    expect(echeance.montant_cents).toBe(e(1950))
    expect(echeance.estime).toBe(false)
  })
})
