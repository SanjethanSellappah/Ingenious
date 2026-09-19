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
import { cents, negatif, type Cents } from '../core/money'
import { projeterSolde, type EcheanceProjetee, type Projection } from '../core/projection'
import { resteAVivre, type ResteAVivre } from '../core/resteAVivre'
import type { Etat, Transaction } from './etat'
import { resumerLibelleBancaire } from './libelleBancaire'
import { realiseesDe, soldeDuCompte } from './selecteurs'

/**
 * Où mène une échéance.
 *
 * Un mouvement déjà écrit s'ouvre pour être corrigé ou catégorisé ; une
 * occurrence encore à venir mène à l'abonnement qui la produit, puisque c'est
 * lui qu'il faudrait changer. Une échéance sans origine connue ne mène nulle
 * part — et sa ligne ne fait alors pas semblant d'être cliquable.
 *
 * La règle est ici, et non dans un écran, parce que trois écrans affichent les
 * mêmes échéances. Une par écran, c'est deux occasions d'en oublier une : le
 * calendrier a longtemps été le seul à ne rien relier, et personne ne l'a vu.
 */
export function destinationEcheance(echeance: EcheanceProjetee): string | null {
  if (echeance.mouvement) return `/mouvements/${echeance.mouvement.id}`
  if (echeance.reference) return `/abonnements/${echeance.reference.subscription_id}`
  return null
}

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
/**
 * Comment nommer une transaction dans une liste.
 *
 * La note d'abord — c'est ce que l'utilisateur a écrit. À défaut, le poste de
 * dépense : il a été choisi, il désigne quelque chose, et le taire pour
 * afficher « Échéance » revient à effacer la seule chose qu'on savait de cette
 * ligne. Le mot générique ne reste que pour une dépense sans note ni poste, et
 * il dit au moins son sens plutôt que de faire passer une dépense ponctuelle
 * pour une échéance récurrente.
 */
function libelleTransaction(etat: Etat, transaction: Transaction): string {
  if (transaction.note !== undefined && transaction.note.trim() !== '') {
    // Une ligne importée porte le pavé technique de la banque : on l'abrège
    // pour la liste. Une note écrite à la main est rendue telle quelle.
    return transaction.origine === 'csv'
      ? resumerLibelleBancaire(transaction.note)
      : transaction.note
  }
  if (transaction.label_id !== undefined) {
    const label = etat.labels.get(transaction.label_id)
    if (label) return label.nom
  }
  return transaction.montant_cents < 0 ? 'Dépense' : 'Rentrée'
}

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
      libelle: libelleTransaction(etat, transaction),
      mouvement: { id: transaction.id, nature: 'transaction' },
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
      mouvement: { id: virement.id, nature: 'virement' },
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

/**
 * Projection d'un compte sur `jours` jours à partir de `depuis`.
 *
 * `composition.echeancesEchues` du noyau est toujours vide ici, et c'est normal :
 * la fenêtre commence au jour même, donc aucune échéance ne peut lui être
 * antérieure. Les occurrences réellement en retard se lisent dans `aConfirmer`,
 * qui regarde en arrière — deux notions voisines, une seule utile à ce niveau.
 */
export function projectionDuCompte(
  etat: Etat,
  account_id: string,
  depuis: CivilDate,
  jours: number = HORIZON_JOURS,
): Projection & {
  nonResolues: ResultatEcheances['nonResolues']
  aConfirmer: AConfirmer[]
} {
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
    aConfirmer: occurrencesAConfirmerDuCompte(etat, account_id, depuis),
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

/** Jusqu'où regarder en arrière pour réclamer une occurrence non confirmée. */
export const RETARD_MAX_JOURS = 45

/**
 * Une occurrence en attente de confirmation.
 *
 * `montantConnu` distingue deux situations très différentes : une échéance dont
 * on connaît le montant attendu et qu'il suffit de valider, et une échéance dont
 * on ne sait rien du tout — récurrence estimée sans historique ni montant de
 * départ. La seconde est la plus urgente, et c'est celle qu'on oublie le plus
 * facilement de rendre saisissable.
 */
export type AConfirmer = EcheanceProjetee & { montantConnu: boolean }

/**
 * Occurrences d'un compte dont le jour est passé sans confirmation.
 *
 * L'application ne sait pas si elles sont passées en banque. Elle ne les compte
 * nulle part et les réclame ici : c'est ce geste qui recale le solde.
 *
 * Seules les occurrences de récurrences sont concernées — une transaction déjà
 * saisie n'a rien à confirmer, elle est déjà dans le solde.
 */
export function occurrencesAConfirmerDuCompte(
  etat: Etat,
  account_id: string,
  depuis: CivilDate,
): AConfirmer[] {
  const debut = ajouterJours(depuis, -RETARD_MAX_JOURS)
  const { echeances, nonResolues } = echeancesDuCompte(etat, account_id, debut, depuis)

  const dejaConfirmee = (subscription_id: string, date_theorique: CivilDate): boolean =>
    etat.exceptions.get(`${subscription_id}@${date_theorique}`)?.statut === 'realise'

  const attente: AConfirmer[] = echeances
    .filter(
      (echeance) =>
        echeance.reference !== undefined &&
        !dejaConfirmee(echeance.reference.subscription_id, echeance.reference.date_theorique),
    )
    .map((echeance) => ({ ...echeance, montantConnu: true }))

  // Les occurrences qu'on n'a pas su valoriser sont les plus urgentes : sans
  // elles ici, l'application signalerait « 2 échéances sans montant connu »
  // sans offrir nulle part de les renseigner.
  for (const nonResolue of nonResolues) {
    const { recurrence_id, occurrence, libelle } = nonResolue
    if (dejaConfirmee(recurrence_id, occurrence.date_theorique)) continue
    attente.push({
      date: occurrence.date_affichee,
      // Zéro n'est pas un montant, c'est une absence : `montantConnu` le dit,
      // et l'écran demande la valeur au lieu de proposer de valider un zéro.
      montant_cents: cents(0),
      borne_basse_cents: cents(0),
      borne_haute_cents: cents(0),
      estime: true,
      montantConnu: false,
      libelle,
      reference: { subscription_id: recurrence_id, date_theorique: occurrence.date_theorique },
    })
  }

  return attente.sort(comparerEcheances)
}

/** Même chose, tous comptes confondus. */
export function occurrencesAConfirmer(etat: Etat, depuis: CivilDate): AConfirmer[] {
  const aConfirmer: AConfirmer[] = []
  for (const compte of etat.comptes.values()) {
    if (compte.archived_at !== undefined) continue
    aConfirmer.push(...occurrencesAConfirmerDuCompte(etat, compte.id, depuis))
  }
  return aConfirmer.sort(comparerEcheances)
}
