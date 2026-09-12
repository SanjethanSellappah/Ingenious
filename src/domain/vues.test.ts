import { describe, expect, it } from 'vitest'
import { dateCivile } from '../core/civilDate'
import { cents, type Cents } from '../core/money'
import { plier } from './etat'
import { validerEvenement, type Evenement, type TypeEvenement } from './events'
import { compteCourantEffectif } from './selecteurs'
import {
  echeancesDuCompte,
  occurrencesAConfirmer,
  projectionDuCompte,
  prochainesEcheances,
  recurrencesDe,
  resteAVivreDe,
} from './vues'

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

const AUJOURDHUI = d('2026-09-11')

/** Compte courant à 1 200 €, loyer de 700 € le 1er, salaire estimé le 30. */
function journalComplet(): Evenement[] {
  return [
    ev('account.created', {
      id: 'c1',
      nom: 'Courant',
      type: 'courant',
      groupe: 'bancaire',
      mode: 'saisi',
    }),
    ev('account.balance_set', { account_id: 'c1', date: '2026-09-11', solde_cents: 120000 }),
    ev('settings.updated', { compte_courant_id: 'c1', reserve_cents: 15000 }),
    ev('subscription.created', {
      id: 'loyer',
      nom: 'Loyer',
      account_id: 'c1',
      sens: 'depense',
      montant_mode: 'fixe',
      frequence: 'mensuel',
      jour_du_mois: 1,
      regle_weekend: 'jour_ouvre_precedent',
      date_debut: '2025-01-01',
    }),
    ev('subscription.price_changed', {
      subscription_id: 'loyer',
      montant_cents: 70000,
      valide_du: '2025-01-01',
    }),
    ev('subscription.created', {
      id: 'salaire',
      nom: 'Salaire',
      account_id: 'c1',
      sens: 'rentree',
      montant_mode: 'estime',
      frequence: 'mensuel',
      jour_du_mois: 30,
      regle_weekend: 'jour_ouvre_precedent',
      date_debut: '2025-01-30',
    }),
    ev('occurrence.overridden', {
      subscription_id: 'salaire',
      date_theorique: '2026-07-30',
      montant_cents: 220000,
      statut: 'realise',
    }),
    ev('occurrence.overridden', {
      subscription_id: 'salaire',
      date_theorique: '2026-08-30',
      montant_cents: 190000,
      statut: 'realise',
    }),
  ]
}

describe('récurrences depuis l’état', () => {
  it('rassemble règle, prix, exceptions et réalisées', () => {
    const recurrences = recurrencesDe(plier(journalComplet()))
    const salaire = recurrences.find((r) => r.id === 'salaire')!
    expect(salaire.realisees).toHaveLength(2)
    expect(salaire.montant_mode).toBe('estime')
    const loyer = recurrences.find((r) => r.id === 'loyer')!
    expect(loyer.prix).toEqual([{ montant_cents: 70000, valide_du: '2025-01-01' }])
  })

  it('filtre par compte', () => {
    const etat = plier([
      ...journalComplet(),
      ev('account.created', {
        id: 'c2',
        nom: 'Livret',
        type: 'livret',
        groupe: 'bancaire',
        mode: 'saisi',
      }),
    ])
    expect(recurrencesDe(etat, 'c2')).toHaveLength(0)
    expect(recurrencesDe(etat, 'c1')).toHaveLength(2)
  })
})

describe('échéances d’un compte', () => {
  it('mêle récurrences et transactions futures déjà saisies', () => {
    const etat = plier([
      ...journalComplet(),
      ev('transaction.created', {
        id: 't-future',
        account_id: 'c1',
        date: '2026-09-20',
        montant_cents: -25000,
        note: 'Dentiste',
        origine: 'manuel',
      }),
    ])
    const { echeances } = echeancesDuCompte(etat, 'c1', AUJOURDHUI, d('2026-10-05'))
    expect(echeances.map((x) => `${x.date} ${x.libelle}`)).toEqual([
      '2026-09-20 Dentiste',
      '2026-09-30 Salaire',
      '2026-10-01 Loyer',
    ])
  })

  it('compte un virement futur comme une sortie', () => {
    const etat = plier([
      ...journalComplet(),
      ev('account.created', {
        id: 'c2',
        nom: 'Livret',
        type: 'livret',
        groupe: 'bancaire',
        mode: 'saisi',
      }),
      ev('transfer.created', {
        id: 'v1',
        date: '2026-09-15',
        from_account_id: 'c1',
        to_account_id: 'c2',
        montant_cents: 20000,
      }),
    ])
    const { echeances } = echeancesDuCompte(etat, 'c1', AUJOURDHUI, d('2026-09-20'))
    expect(echeances[0]).toMatchObject({ date: '2026-09-15', montant_cents: -20000 })
    // Et l'autre compte le voit entrer.
    const versLivret = echeancesDuCompte(etat, 'c2', AUJOURDHUI, d('2026-09-20')).echeances[0]!
    expect(versLivret.montant_cents).toBe(20000)
  })

  it('n’ajoute pas une transaction déjà passée', () => {
    const etat = plier([
      ...journalComplet(),
      ev('transaction.created', {
        id: 't-passee',
        account_id: 'c1',
        date: '2026-09-05',
        montant_cents: -5000,
        origine: 'manuel',
      }),
    ])
    const { echeances } = echeancesDuCompte(etat, 'c1', AUJOURDHUI, d('2026-09-20'))
    expect(echeances).toHaveLength(0)
  })
})

describe('projection', () => {
  it('part du solde du compte et applique les échéances', () => {
    const projection = projectionDuCompte(plier(journalComplet()), 'c1', AUJOURDHUI, 30)
    expect(projection.serie[0]!.solde_cents).toBe(e(1200))
    // 30 septembre : salaire estimé, médiane de 2 200 et 1 900 → 2 050.
    const apresSalaire = projection.serie.find((p) => p.date === '2026-09-30')!
    expect(apresSalaire.solde_cents).toBe(e(1200 + 2050))
    expect(apresSalaire.incertain).toBe(true)
  })

  it('signale le loyer du 1er octobre', () => {
    const projection = projectionDuCompte(plier(journalComplet()), 'c1', AUJOURDHUI, 30)
    const octobre = projection.serie.find((p) => p.date === '2026-10-01')!
    expect(octobre.solde_cents).toBe(e(1200 + 2050 - 700))
  })
})

describe('reste à vivre', () => {
  it('court jusqu’au salaire, réserve déduite', () => {
    const rav = resteAVivreDe(plier(journalComplet()), AUJOURDHUI)!
    expect(rav.prochaineRentree).toBe('2026-09-30')
    // Aucune sortie d'ici là : 1 200 − 150 de réserve.
    expect(rav.montant_cents).toBe(e(1050))
  })

  it('retire une dépense connue d’ici la rentrée', () => {
    const etat = plier([
      ...journalComplet(),
      ev('transaction.created', {
        id: 't1',
        account_id: 'c1',
        date: '2026-09-20',
        montant_cents: -25000,
        origine: 'manuel',
      }),
    ])
    expect(resteAVivreDe(etat, AUJOURDHUI)!.montant_cents).toBe(e(800))
  })

  it('ne rend rien sans compte courant désigné', () => {
    const sansReglage = plier(journalComplet().filter((x) => x.type !== 'settings.updated'))
    expect(resteAVivreDe(sansReglage, AUJOURDHUI)).toBeNull()
  })
})

describe('prochaines échéances', () => {
  it('mélange les comptes et trie par date', () => {
    const etat = plier(journalComplet())
    const prochaines = prochainesEcheances(etat, AUJOURDHUI, 4)
    expect(prochaines.map((x) => `${x.date} ${x.libelle}`)).toEqual([
      '2026-09-30 Salaire',
      '2026-10-01 Loyer',
      // Le 1er novembre est un dimanche : le loyer est avancé au vendredi 30,
      // jour du salaire. La sortie est affichée avant la rentrée.
      '2026-10-30 Loyer',
      '2026-10-30 Salaire',
    ])
  })
})

describe('occurrences à confirmer', () => {
  it('réclame une échéance passée sans confirmation', () => {
    // Le loyer du 1er septembre est passé, aucun réalisé n'a été saisi.
    const aConfirmer = occurrencesAConfirmer(plier(journalComplet()), AUJOURDHUI)
    expect(aConfirmer.map((x) => `${x.date} ${x.libelle}`)).toContain('2026-09-01 Loyer')
  })

  it('ne réclame plus une occurrence confirmée', () => {
    const etat = plier([
      ...journalComplet(),
      ev('occurrence.overridden', {
        subscription_id: 'loyer',
        date_theorique: '2026-09-01',
        montant_cents: 70000,
        statut: 'realise',
      }),
    ])
    const aConfirmer = occurrencesAConfirmer(etat, AUJOURDHUI)
    expect(aConfirmer.map((x) => `${x.date} ${x.libelle}`)).not.toContain('2026-09-01 Loyer')
  })
})

/**
 * Après une restauration, le journal importé peut ne pas porter le réglage qui
 * désigne le compte du reste à vivre. Deux des cinq onglets en dépendent.
 */
describe('compte courant effectif', () => {
  const compte = (id: string, groupe: 'bancaire' | 'investissement') =>
    ev('account.created', { id, nom: id, type: 'courant', groupe, mode: 'saisi' })

  it('respecte le réglage explicite, même avec plusieurs comptes', () => {
    const etat = plier([
      compte('c1', 'bancaire'),
      compte('c2', 'bancaire'),
      ev('settings.updated', { compte_courant_id: 'c2' }),
    ])
    expect(compteCourantEffectif(etat)).toBe('c2')
  })

  it('désigne le seul compte bancaire quand le réglage manque', () => {
    const etat = plier([compte('c1', 'bancaire'), compte('pea', 'investissement')])
    expect(compteCourantEffectif(etat)).toBe('c1')
  })

  it('ne devine pas entre deux candidats : l’écran doit poser la question', () => {
    const etat = plier([compte('c1', 'bancaire'), compte('c2', 'bancaire')])
    expect(compteCourantEffectif(etat)).toBeUndefined()
  })

  it('ignore un compte archivé dans le décompte des candidats', () => {
    const etat = plier([
      compte('c1', 'bancaire'),
      compte('c2', 'bancaire'),
      ev('account.archived', { id: 'c2', date: '2026-01-01' }),
    ])
    expect(compteCourantEffectif(etat)).toBe('c1')
  })

  it('ne retient pas un compte désigné qui n’existe pas dans ce journal', () => {
    // Import partiel : le réglage a suivi, le compte non.
    const etat = plier([
      compte('c1', 'bancaire'),
      ev('settings.updated', { compte_courant_id: 'absent' }),
    ])
    expect(compteCourantEffectif(etat)).toBe('c1')
  })

  it('ne désigne rien quand il n’y a aucun compte bancaire', () => {
    const etat = plier([compte('pea', 'investissement')])
    expect(compteCourantEffectif(etat)).toBeUndefined()
  })
})
