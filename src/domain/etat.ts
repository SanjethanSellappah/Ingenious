/**
 * Pliage du journal en état applicatif.
 *
 * L'état n'est jamais stocké : il est **dérivé** en repliant le journal trié par
 * instant, `id` en départage. C'est ce qui permet à une correction d'être un
 * nouvel événement plutôt qu'une réécriture, et à deux appareils de fusionner
 * sans arbitrage.
 */
import { ajouterJours, type CivilDate } from '../core/civilDate'
import type { Cents } from '../core/money'
import type { PrixAbonnement } from '../core/prixAbonnement'
import type { RegleRecurrence } from '../core/recurrence'
import type { Evenement } from './events'
import { trierJournal } from './events'

export type TypeCompte = 'courant' | 'livret' | 'pea' | 'cto' | 'av' | 'or' | 'autre'
export type GroupeCompte = 'bancaire' | 'investissement'
export type ModeCompte = 'saisi' | 'calcule'
export type OrigineTransaction = 'manuel' | 'csv' | 'recurrence' | 'reconciliation'

export type Compte = {
  id: string
  nom: string
  type: TypeCompte
  groupe: GroupeCompte
  mode: ModeCompte
  archived_at?: CivilDate
}

/** Relevé saisi par l'utilisateur. Sert d'ancre au calcul de solde. */
export type Releve = {
  account_id: string
  date: CivilDate
  solde_cents: Cents
  /** Instant de l'événement : départage deux écritures du même jour. */
  ts: number
}

export type Transaction = {
  id: string
  account_id: string
  date: CivilDate
  montant_cents: Cents
  label_id?: string
  note?: string
  subscription_id?: string
  origine: OrigineTransaction
  ts: number
}

export type Virement = {
  id: string
  date: CivilDate
  from_account_id: string
  to_account_id: string
  montant_cents: Cents
  note?: string
  ts: number
}

export type Label = {
  id: string
  nom: string
  /** Minuscules sans accents : « courses », « Courses » et « Courses » sont le même label. */
  nom_normalise: string
  couleur: string
  budget_mensuel_cents?: Cents
  archived_at?: CivilDate
}

export type Abonnement = {
  id: string
  nom: string
  account_id: string
  label_id?: string
  sens: 'depense' | 'rentree'
  montant_mode: 'fixe' | 'estime'
  estimation_fenetre?: number
  regle: RegleRecurrence
  rappel_jours?: number
  actif: boolean
  prix: PrixAbonnement[]
}

export type Exception = {
  subscription_id: string
  date_theorique: CivilDate
  montant_cents: Cents
  statut: 'previsionnel' | 'realise'
  exclu_de_estimation?: boolean
  /** Instant de l'écriture : départage une confirmation et une ancre du même jour. */
  ts: number
}

export type Instantane = {
  account_id: string
  date: CivilDate
  valeur_cents: Cents
}

export type Reglages = {
  reserve_cents: Cents
  compte_courant_id?: string
}

export type Etat = {
  comptes: Map<string, Compte>
  releves: Releve[]
  transactions: Map<string, Transaction>
  virements: Map<string, Virement>
  labels: Map<string, Label>
  abonnements: Map<string, Abonnement>
  exceptions: Map<string, Exception>
  instantanes: Instantane[]
  reglages: Reglages
}

/** Clé d'une exception : le couple (récurrence, date théorique), et rien d'autre. */
export function cleException(subscription_id: string, date_theorique: CivilDate): string {
  return `${subscription_id}@${date_theorique}`
}

/**
 * Normalise un nom de label : minuscules, sans accents, espaces réduits.
 *
 * Sans cela, « courses », « Courses » et « course » deviennent trois lignes dans
 * le total du mois, et le budget ne veut plus rien dire.
 */
export function normaliserNom(nom: string): string {
  return nom.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')
}

export function etatVide(): Etat {
  return {
    comptes: new Map(),
    releves: [],
    transactions: new Map(),
    virements: new Map(),
    labels: new Map(),
    abonnements: new Map(),
    exceptions: new Map(),
    instantanes: [],
    reglages: { reserve_cents: 0 as Cents },
  }
}

type Payload = Record<string, unknown>

const texte = (p: Payload, cle: string): string => p[cle] as string
const nombre = (p: Payload, cle: string): Cents => p[cle] as Cents
const date = (p: Payload, cle: string): CivilDate => p[cle] as CivilDate
const optTexte = (p: Payload, cle: string): string | undefined =>
  typeof p[cle] === 'string' ? p[cle] : undefined

/**
 * Applique un événement à l'état.
 *
 * Les charges utiles sont déjà validées par `validerEvenement` : ce pliage ne
 * re-vérifie rien, il assemble. Un événement qui porte sur une entité inconnue
 * est ignoré en silence — c'est le cas normal d'un journal partiel, par exemple
 * un import qui ne contient que les mois récents.
 */
function appliquer(etat: Etat, evenement: Evenement): void {
  const p = evenement.payload
  switch (evenement.type) {
    case 'account.created':
      etat.comptes.set(texte(p, 'id'), {
        id: texte(p, 'id'),
        nom: texte(p, 'nom'),
        type: p.type as TypeCompte,
        groupe: p.groupe as GroupeCompte,
        mode: p.mode as ModeCompte,
      })
      break
    case 'account.updated': {
      const compte = etat.comptes.get(texte(p, 'id'))
      if (!compte) break
      if (typeof p.nom === 'string') compte.nom = p.nom
      if (typeof p.type === 'string') compte.type = p.type as TypeCompte
      if (typeof p.groupe === 'string') compte.groupe = p.groupe as GroupeCompte
      if (typeof p.mode === 'string') compte.mode = p.mode as ModeCompte
      break
    }
    case 'account.archived': {
      const compte = etat.comptes.get(texte(p, 'id'))
      if (compte) compte.archived_at = date(p, 'date')
      break
    }
    case 'account.unarchived': {
      const compte = etat.comptes.get(texte(p, 'id'))
      if (compte) delete compte.archived_at
      break
    }
    case 'account.balance_set':
      etat.releves.push({
        account_id: texte(p, 'account_id'),
        date: date(p, 'date'),
        solde_cents: nombre(p, 'solde_cents'),
        ts: evenement.ts,
      })
      break

    case 'transaction.created':
      etat.transactions.set(texte(p, 'id'), {
        id: texte(p, 'id'),
        account_id: texte(p, 'account_id'),
        date: date(p, 'date'),
        montant_cents: nombre(p, 'montant_cents'),
        origine: p.origine as OrigineTransaction,
        ts: evenement.ts,
        ...(optTexte(p, 'label_id') !== undefined ? { label_id: optTexte(p, 'label_id')! } : {}),
        ...(optTexte(p, 'note') !== undefined ? { note: optTexte(p, 'note')! } : {}),
        ...(optTexte(p, 'subscription_id') !== undefined
          ? { subscription_id: optTexte(p, 'subscription_id')! }
          : {}),
      })
      break
    case 'transaction.updated': {
      const transaction = etat.transactions.get(texte(p, 'id'))
      if (!transaction) break
      if (typeof p.date === 'string') transaction.date = p.date as CivilDate
      if (typeof p.montant_cents === 'number') transaction.montant_cents = p.montant_cents as Cents
      if (typeof p.label_id === 'string') transaction.label_id = p.label_id
      if (typeof p.note === 'string') transaction.note = p.note
      break
    }
    case 'transaction.deleted':
      etat.transactions.delete(texte(p, 'id'))
      break

    case 'transfer.created':
      etat.virements.set(texte(p, 'id'), {
        id: texte(p, 'id'),
        date: date(p, 'date'),
        from_account_id: texte(p, 'from_account_id'),
        to_account_id: texte(p, 'to_account_id'),
        montant_cents: nombre(p, 'montant_cents'),
        ts: evenement.ts,
        ...(optTexte(p, 'note') !== undefined ? { note: optTexte(p, 'note')! } : {}),
      })
      break
    case 'transfer.updated': {
      const virement = etat.virements.get(texte(p, 'id'))
      if (!virement) break
      if (typeof p.date === 'string') virement.date = p.date as CivilDate
      if (typeof p.montant_cents === 'number') virement.montant_cents = p.montant_cents as Cents
      if (typeof p.note === 'string') virement.note = p.note
      break
    }
    case 'transfer.deleted':
      etat.virements.delete(texte(p, 'id'))
      break

    case 'subscription.created':
      etat.abonnements.set(texte(p, 'id'), {
        id: texte(p, 'id'),
        nom: texte(p, 'nom'),
        account_id: texte(p, 'account_id'),
        sens: p.sens as 'depense' | 'rentree',
        montant_mode: p.montant_mode as 'fixe' | 'estime',
        actif: p.actif === undefined ? true : (p.actif as boolean),
        regle: regleDepuisPayload(p),
        prix: [],
        ...(optTexte(p, 'label_id') !== undefined ? { label_id: optTexte(p, 'label_id')! } : {}),
        ...(typeof p.estimation_fenetre === 'number'
          ? { estimation_fenetre: p.estimation_fenetre }
          : {}),
        ...(typeof p.rappel_jours === 'number' ? { rappel_jours: p.rappel_jours } : {}),
      })
      break
    case 'subscription.updated': {
      const abonnement = etat.abonnements.get(texte(p, 'id'))
      if (!abonnement) break
      if (typeof p.nom === 'string') abonnement.nom = p.nom
      if (typeof p.account_id === 'string') abonnement.account_id = p.account_id
      if (typeof p.label_id === 'string') abonnement.label_id = p.label_id
      if (typeof p.sens === 'string') abonnement.sens = p.sens as 'depense' | 'rentree'
      if (typeof p.montant_mode === 'string')
        abonnement.montant_mode = p.montant_mode as 'fixe' | 'estime'
      if (typeof p.estimation_fenetre === 'number')
        abonnement.estimation_fenetre = p.estimation_fenetre
      if (typeof p.rappel_jours === 'number') abonnement.rappel_jours = p.rappel_jours
      if (typeof p.actif === 'boolean') abonnement.actif = p.actif
      abonnement.regle = { ...abonnement.regle, ...regleDepuisPayloadPartiel(p) }
      break
    }
    case 'subscription.price_changed': {
      const abonnement = etat.abonnements.get(texte(p, 'subscription_id'))
      if (!abonnement) break
      // Le prix précédent est clos la veille : deux périodes ne se chevauchent
      // jamais, et le montant d'une échéance passée reste celui de l'époque.
      const precedent = abonnement.prix.at(-1)
      if (precedent && precedent.valide_au === undefined) {
        precedent.valide_au = ajouterJours(date(p, 'valide_du'), -1)
      }
      abonnement.prix.push({
        montant_cents: nombre(p, 'montant_cents'),
        valide_du: date(p, 'valide_du'),
      })
      break
    }
    case 'subscription.ended': {
      const abonnement = etat.abonnements.get(texte(p, 'subscription_id'))
      if (!abonnement) break
      abonnement.regle = { ...abonnement.regle, date_fin: date(p, 'date_fin') }
      abonnement.actif = false
      break
    }

    case 'label.created':
      etat.labels.set(texte(p, 'id'), {
        id: texte(p, 'id'),
        nom: texte(p, 'nom'),
        nom_normalise: normaliserNom(texte(p, 'nom')),
        couleur: texte(p, 'couleur'),
      })
      break
    case 'label.renamed': {
      const label = etat.labels.get(texte(p, 'id'))
      if (!label) break
      label.nom = texte(p, 'nom')
      label.nom_normalise = normaliserNom(texte(p, 'nom'))
      break
    }
    case 'label.budget_set': {
      const label = etat.labels.get(texte(p, 'id'))
      if (!label) break
      if (typeof p.budget_mensuel_cents === 'number') {
        label.budget_mensuel_cents = p.budget_mensuel_cents as Cents
      } else {
        delete label.budget_mensuel_cents
      }
      break
    }
    case 'label.archived': {
      const label = etat.labels.get(texte(p, 'id'))
      if (label) label.archived_at = date(p, 'date')
      break
    }

    case 'occurrence.overridden':
      etat.exceptions.set(cleException(texte(p, 'subscription_id'), date(p, 'date_theorique')), {
        subscription_id: texte(p, 'subscription_id'),
        date_theorique: date(p, 'date_theorique'),
        montant_cents: nombre(p, 'montant_cents'),
        statut: p.statut as 'previsionnel' | 'realise',
        ts: evenement.ts,
        ...(typeof p.exclu_de_estimation === 'boolean'
          ? { exclu_de_estimation: p.exclu_de_estimation }
          : {}),
      })
      break
    case 'occurrence.override_cleared':
      etat.exceptions.delete(cleException(texte(p, 'subscription_id'), date(p, 'date_theorique')))
      break

    case 'snapshot.recorded':
      etat.instantanes.push({
        account_id: texte(p, 'account_id'),
        date: date(p, 'date'),
        valeur_cents: nombre(p, 'valeur_cents'),
      })
      break

    case 'settings.updated':
      if (typeof p.reserve_cents === 'number')
        etat.reglages.reserve_cents = p.reserve_cents as Cents
      if (typeof p.compte_courant_id === 'string')
        etat.reglages.compte_courant_id = p.compte_courant_id
      break

    // Phase 2 : les événements sont transportés par le journal, mais rien ne les
    // plie encore. Les ignorer ne perd rien — ils restent dans le journal.
    case 'instrument.created':
    case 'instrument.updated':
    case 'holding.created':
    case 'holding.updated':
      break
  }
}

function regleDepuisPayload(p: Payload): RegleRecurrence {
  return {
    frequence: p.frequence as RegleRecurrence['frequence'],
    date_debut: date(p, 'date_debut'),
    ...regleDepuisPayloadPartiel(p),
  }
}

function regleDepuisPayloadPartiel(p: Payload): Partial<RegleRecurrence> {
  const partiel: Partial<RegleRecurrence> = {}
  if (typeof p.frequence === 'string')
    partiel.frequence = p.frequence as RegleRecurrence['frequence']
  if (typeof p.intervalle === 'number') partiel.intervalle = p.intervalle
  if (typeof p.unite_intervalle === 'string')
    partiel.unite_intervalle = p.unite_intervalle as NonNullable<
      RegleRecurrence['unite_intervalle']
    >
  if (typeof p.jour_du_mois === 'number') partiel.jour_du_mois = p.jour_du_mois
  if (typeof p.regle_weekend === 'string')
    partiel.regle_weekend = p.regle_weekend as NonNullable<RegleRecurrence['regle_weekend']>
  if (typeof p.regle_mois_court === 'string')
    partiel.regle_mois_court = p.regle_mois_court as NonNullable<
      RegleRecurrence['regle_mois_court']
    >
  if (typeof p.date_debut === 'string') partiel.date_debut = p.date_debut as CivilDate
  if (typeof p.date_fin === 'string') partiel.date_fin = p.date_fin as CivilDate
  return partiel
}

/** Replie tout le journal. Le tri est refait ici : l'appelant n'a pas à y penser. */
export function plier(evenements: readonly Evenement[]): Etat {
  const etat = etatVide()
  for (const evenement of trierJournal(evenements)) appliquer(etat, evenement)
  etat.releves.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.ts - b.ts))
  etat.instantanes.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return etat
}
