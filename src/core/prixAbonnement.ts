/**
 * Historique des prix d'un abonnement.
 *
 * Un abonnement n'a pas *un* montant, il a un montant **valide à une date**.
 * Sans cet historique, une hausse tarifaire recalculerait rétroactivement toutes
 * les dépenses passées au nouveau tarif : le budget de l'an dernier changerait
 * parce que le fournisseur a augmenté ses prix ce matin.
 */
import { type CivilDate } from './civilDate'
import { type Cents } from './money'

export type PrixAbonnement = {
  montant_cents: Cents
  /** Premier jour où ce montant s'applique. */
  valide_du: CivilDate
  /** Dernier jour d'application, inclus. Absent = toujours en vigueur. */
  valide_au?: CivilDate
}

/**
 * Montant en vigueur à une date donnée, ou `null` si l'abonnement n'avait pas
 * encore de tarif ce jour-là.
 *
 * En cas de chevauchement — deux périodes couvrant la même date, ce qu'une
 * saisie approximative peut produire — c'est la période commençant le plus tard
 * qui gagne : la plus récemment décidée.
 */
export function montantValideA(
  historique: readonly PrixAbonnement[],
  date: CivilDate,
): Cents | null {
  let retenu: PrixAbonnement | null = null
  for (const prix of historique) {
    if (prix.valide_du > date) continue
    if (prix.valide_au !== undefined && prix.valide_au < date) continue
    if (retenu === null || prix.valide_du > retenu.valide_du) retenu = prix
  }
  return retenu?.montant_cents ?? null
}

/** Vrai si le tarif change au moins une fois dans la période, bornes incluses. */
export function tarifChangeEntre(
  historique: readonly PrixAbonnement[],
  debut: CivilDate,
  fin: CivilDate,
): boolean {
  return historique.some((prix) => prix.valide_du > debut && prix.valide_du <= fin)
}

/** Dernier changement de tarif, pour alerter sur l'écran des abonnements. */
export function dernierChangement(historique: readonly PrixAbonnement[]): PrixAbonnement | null {
  let dernier: PrixAbonnement | null = null
  for (const prix of historique) {
    if (dernier === null || prix.valide_du > dernier.valide_du) dernier = prix
  }
  return dernier
}
