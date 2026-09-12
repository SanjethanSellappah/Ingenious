/**
 * Des données pliées aux chiffres affichés.
 *
 * Le noyau (`src/core/`) sait calculer, l'état (`plier`) sait ce qui existe.
 * Ce module fait le pont, et c'est le seul endroit où les deux se rencontrent :
 * les écrans appellent ici, jamais le noyau directement, sinon chaque écran
 * devrait rassembler les mêmes ingrédients et finirait par le faire un peu
 * différemment.
 */
import { ajouterJours, type CivilDate } from '../core/civilDate'
import { echeancesDesRecurrences, type Recurrence, type ResultatEcheances } from '../core/echeances'
import { negatif, type Cents } from '../core/money'
import { projeterSolde, type EcheanceProjetee, type Projection } from '../core/projection'
import { resteAVivre, type ResteAVivre } from '../core/resteAVivre'
import type { Etat } from './etat'
import { realiseesDe, soldeDuCompte } from './selecteurs'

/** Horizon par défaut des projections : deux mois suffisent à voir le point bas. */
export const HORIZON_JOURS = 62

/** Transforme les abonnements de l'état en récurrences valorisables par le noyau. */
export function recurrencesDe(etat: Etat, account_id?: string): Recurrence[] {
  const recurrences: Recurrence[] = []
  for (const abonnement of etat.abonnements.values()) {
    if (account_id !== undefined && abonnement.account_id !== account_id) continue
    const exceptions = [...etat.exceptions.values()].filter(
      (e) => e.subscription_id === abonnement.id,
    )
    recurrences.push({
      id: abonnement.id,
      libelle: abonnement.nom,
      regle: abonnement.regle,
      sens: abonnement.sens,
      montant_mode: abonnement.montant_mode,
      prix: abonnement.prix,
      exceptions,
      realisees: realiseesDe(etat, abonnement.id),
      actif: abonnement.actif,
      ...(abonnement.estimation_fenetre !== undefined
        ? { estimation_fenetre: abonnement.estimation_fenetre }
        : {}),
      ...(abonnement.label_id !== undefined ? { label_id: abonnement.label_id } : {}),
    })
  }
  return recurrences
}

/**
 * Échéances à venir d'un compte.
 *
 * Les transactions futures déjà saisies s'y ajoutent : une dépense connue mais
 * pas encore passée déplace le solde autant qu'une échéance récurrente, et
 * l'oublier ferait mentir la projection.
 */
export function echeancesDuCompte(
  etat: Etat,
  account_id: string,
  debut: CivilDate,
  fin: CivilDate,
): ResultatEcheances {
  const resultat = echeancesDesRecurrences(recurrencesDe(etat, account_id), debut, fin)
  const echeances: EcheanceProjetee[] = [...resultat.echeances]

  for (const transaction of etat.transactions.values()) {
    if (transaction.account_id !== account_id) continue
    if (transaction.date <= debut || transaction.date > fin) continue
    echeances.push({
      date: transaction.date,
      montant_cents: transaction.montant_cents,
      borne_basse_cents: transaction.montant_cents,
      borne_haute_cents: transaction.montant_cents,
      estime: false,
      ...(transaction.note !== undefined ? { libelle: transaction.note } : {}),
    })
  }

  for (const virement of etat.virements.values()) {
    const sortant = virement.from_account_id === account_id
    if (!sortant && virement.to_account_id !== account_id) continue
    if (virement.date <= debut || virement.date > fin) continue
    const montant: Cents = sortant ? negatif(virement.montant_cents) : virement.montant_cents
    echeances.push({
      date: virement.date,
      montant_cents: montant,
      borne_basse_cents: montant,
      borne_haute_cents: montant,
      estime: false,
      libelle: 'Virement',
    })
  }

  echeances.sort(comparerEcheances)
  return { echeances, nonResolues: resultat.nonResolues }
}

/**
 * Ordre d'affichage de deux échéances.
 *
 * À date égale, la **sortie passe avant la rentrée**. C'est l'hypothèse prudente
 * — le prélèvement peut tomber avant que le virement arrive — et surtout un ordre
 * déterministe : sans lui, l'affichage dépendrait de l'ordre d'insertion dans une
 * `Map`, qui peut changer sans que personne ne s'en aperçoive.
 */
function comparerEcheances(a: EcheanceProjetee, b: EcheanceProjetee): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  const sortieA = a.montant_cents < 0 ? 0 : 1
  const sortieB = b.montant_cents < 0 ? 0 : 1
  if (sortieA !== sortieB) return sortieA - sortieB
  return (a.libelle ?? '').localeCompare(b.libelle ?? '', 'fr')
}

/** Projection d'un compte sur `jours` jours à partir de `depuis`. */
export function projectionDuCompte(
  etat: Etat,
  account_id: string,
  depuis: CivilDate,
  jours: number = HORIZON_JOURS,
): Projection & { nonResolues: ResultatEcheances['nonResolues'] } {
  const fin = ajouterJours(depuis, jours)
  const { echeances, nonResolues } = echeancesDuCompte(etat, account_id, depuis, fin)
  return {
    ...projeterSolde({
      soldeActuel: soldeDuCompte(etat, account_id, depuis),
      echeances,
      debut: depuis,
      fin,
    }),
    nonResolues,
  }
}

/**
 * Reste à vivre du compte courant.
 *
 * `null` s'il n'y a pas de compte courant désigné : mieux vaut ne rien afficher
 * qu'un chiffre dont on ne sait pas de quel compte il parle.
 */
export function resteAVivreDe(etat: Etat, depuis: CivilDate): ResteAVivre | null {
  const account_id = etat.reglages.compte_courant_id
  if (account_id === undefined || !etat.comptes.has(account_id)) return null
  const { echeances } = echeancesDuCompte(
    etat,
    account_id,
    depuis,
    ajouterJours(depuis, HORIZON_JOURS),
  )
  return resteAVivre({
    soldeCourant: soldeDuCompte(etat, account_id, depuis),
    echeances,
    reserve_cents: etat.reglages.reserve_cents,
    depuis,
  })
}

/** Prochaines échéances tous comptes confondus, pour l'accueil. */
export function prochainesEcheances(
  etat: Etat,
  depuis: CivilDate,
  combien = 5,
): (EcheanceProjetee & { account_id: string })[] {
  const fin = ajouterJours(depuis, HORIZON_JOURS)
  const toutes: (EcheanceProjetee & { account_id: string })[] = []
  for (const compte of etat.comptes.values()) {
    if (compte.archived_at !== undefined) continue
    for (const echeance of echeancesDuCompte(etat, compte.id, depuis, fin).echeances) {
      toutes.push({ ...echeance, account_id: compte.id })
    }
  }
  return toutes.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).slice(0, combien)
}

/**
 * Occurrences dont le jour est passé sans confirmation, tous comptes confondus.
 *
 * L'application ne sait pas si elles sont passées en banque. Elle ne les compte
 * nulle part et les réclame ici : c'est ce geste qui recale le solde.
 */
export function occurrencesAConfirmer(etat: Etat, depuis: CivilDate): EcheanceProjetee[] {
  const debut = ajouterJours(depuis, -45)
  const aConfirmer: EcheanceProjetee[] = []
  for (const compte of etat.comptes.values()) {
    if (compte.archived_at !== undefined) continue
    const { echeances } = echeancesDuCompte(etat, compte.id, debut, depuis)
    for (const echeance of echeances) {
      if (echeance.reference === undefined) continue
      const exception = etat.exceptions.get(
        `${echeance.reference.subscription_id}@${echeance.reference.date_theorique}`,
      )
      if (exception?.statut === 'realise') continue
      aConfirmer.push(echeance)
    }
  }
  return aConfirmer.sort(comparerEcheances)
}
