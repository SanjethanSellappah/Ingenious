/**
 * Coût du démarrage.
 *
 * Tout le journal est déchiffré et replié à l'ouverture. C'est ce qui rend
 * l'architecture simple — aucun index, aucune migration — mais c'est aussi le
 * seul endroit où le coût grandit avec l'usage. Ces tests fixent un plafond : si
 * un jour ils échouent, c'est que le pliage doit être mis en cache, pas que le
 * seuil doit être relevé.
 */
import { describe, expect, it } from 'vitest'
import { dateCivile } from '../core/civilDate'
import { plier } from './etat'
import { validerEvenement, type Evenement } from './events'
import { depensesParLabel, patrimoine, soldeDuCompte } from './selecteurs'
import { projectionDuCompte, resteAVivreDe } from './vues'

/** Cinq ans d'usage soutenu : trois mouvements par jour, plus les récurrences. */
function journalRealiste(annees: number): Evenement[] {
  const evenements: Evenement[] = []
  let sequence = 0
  const ajouter = (type: string, payload: Record<string, unknown>) => {
    sequence += 1
    evenements.push(
      validerEvenement({
        id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
        ts: 1_600_000_000_000 + sequence * 1000,
        device: 'test',
        type,
        payload,
      }),
    )
  }

  ajouter('account.created', {
    id: 'c1',
    nom: 'Courant',
    type: 'courant',
    groupe: 'bancaire',
    mode: 'saisi',
  })
  ajouter('account.created', {
    id: 'c2',
    nom: 'Livret',
    type: 'livret',
    groupe: 'bancaire',
    mode: 'saisi',
  })
  ajouter('settings.updated', { compte_courant_id: 'c1', reserve_cents: 15000 })
  for (const nom of ['Courses', 'Transport', 'Loisirs', 'Santé']) {
    ajouter('label.created', { id: `l-${nom}`, nom, couleur: '#4ade80' })
  }
  ajouter('subscription.created', {
    id: 'loyer',
    nom: 'Loyer',
    account_id: 'c1',
    sens: 'depense',
    montant_mode: 'fixe',
    frequence: 'mensuel',
    jour_du_mois: 1,
    regle_weekend: 'jour_ouvre_precedent',
    date_debut: '2021-01-01',
  })
  ajouter('subscription.price_changed', {
    subscription_id: 'loyer',
    montant_cents: 70000,
    valide_du: '2021-01-01',
  })

  const labels = ['l-Courses', 'l-Transport', 'l-Loisirs', 'l-Santé']
  let numero = 0
  for (let an = 0; an < annees; an++) {
    for (let mois = 1; mois <= 12; mois++) {
      const moisTexte = String(mois).padStart(2, '0')
      for (let jour = 1; jour <= 28; jour++) {
        const annee = 2021 + an
        const dateAnnee = `${annee}-${moisTexte}-${String(jour).padStart(2, '0')}`
        for (let passage = 0; passage < 3; passage++) {
          numero += 1
          ajouter('transaction.created', {
            id: `t${numero}`,
            account_id: 'c1',
            date: dateAnnee,
            montant_cents: -(1000 + (numero % 5000)),
            label_id: labels[numero % labels.length],
            origine: 'manuel',
          })
        }
        if (numero % 7 === 0) {
          ajouter('account.balance_set', {
            account_id: 'c1',
            date: dateAnnee,
            solde_cents: 100000 + (numero % 50000),
          })
        }
        if (numero % 30 === 0) {
          ajouter('transfer.created', {
            id: `v${numero}`,
            date: dateAnnee,
            from_account_id: 'c1',
            to_account_id: 'c2',
            montant_cents: 20000,
          })
        }
      }
    }
  }
  return evenements
}

describe('journal de cinq ans', () => {
  const journal = journalRealiste(5)

  it('compte plus de cinq mille événements', () => {
    // Cinq ans à trois mouvements par jour : bien au-delà d'un usage réel, ce
    // qui est le but — un plafond ne vaut que s'il est éprouvé au-dessus.
    expect(journal.length).toBeGreaterThan(5_000)
  })

  it('se replie en moins de 400 ms', () => {
    const depart = performance.now()
    const etat = plier(journal)
    const duree = performance.now() - depart
    expect(etat.transactions.size).toBeGreaterThan(5_000)
    expect(duree).toBeLessThan(400)
  })

  it('calcule un solde en moins de 150 ms', () => {
    const etat = plier(journal)
    const depart = performance.now()
    soldeDuCompte(etat, 'c1', dateCivile('2026-01-01'))
    expect(performance.now() - depart).toBeLessThan(150)
  })

  it('calcule le patrimoine en moins de 300 ms', () => {
    const etat = plier(journal)
    const depart = performance.now()
    patrimoine(etat, dateCivile('2026-01-01'))
    expect(performance.now() - depart).toBeLessThan(300)
  })

  it('calcule les dépenses du mois en moins de 300 ms', () => {
    const etat = plier(journal)
    const depart = performance.now()
    depensesParLabel(etat, '2025-06')
    expect(performance.now() - depart).toBeLessThan(300)
  })

  it('projette et calcule le reste à vivre en moins de 400 ms', () => {
    const etat = plier(journal)
    const depart = performance.now()
    projectionDuCompte(etat, 'c1', dateCivile('2026-01-01'))
    resteAVivreDe(etat, dateCivile('2026-01-01'))
    expect(performance.now() - depart).toBeLessThan(400)
  })
})
