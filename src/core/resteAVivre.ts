/**
 * Reste à vivre.
 *
 * Le chiffre principal de l'accueil, et le seul qui sera consulté tous les jours :
 * ce qu'il reste à dépenser d'ici la prochaine rentrée, une fois les échéances
 * connues retirées et la réserve mise de côté.
 *
 * **Toute estimation y est prise à sa borne la plus défavorable**, jamais à sa
 * valeur centrale. Le sens de l'erreur compte : surestimer un salaire dans un
 * chiffre censé répondre à « combien je peux dépenser » pousse exactement vers la
 * mauvaise décision. Le patrimoine et les graphiques, eux, peuvent afficher la
 * valeur centrale — ils ne commandent pas une dépense.
 */
import { ajouterJours, dernierJourDuMois, type CivilDate } from './civilDate'
import { cents, type Cents } from './money'
import type { EcheanceProjetee } from './projection'

/** Au-delà, on cesse de chercher une rentrée et on se rabat sur la fin du mois. */
export const HORIZON_MAX_JOURS = 60

export type ParametresResteAVivre = {
  /** Solde connu du compte courant. Pas du patrimoine : on ne dépense pas son PEA. */
  soldeCourant: Cents
  /** Échéances du compte courant, montants déjà signés et résolus. */
  echeances: readonly EcheanceProjetee[]
  /** Matelas que l'utilisateur refuse d'entamer. */
  reserve_cents: Cents
  /** Jour de référence, en principe aujourd'hui. */
  depuis: CivilDate
  /** Jours au-delà desquels on renonce à chercher une rentrée. Défaut 60. */
  horizonMaxJours?: number
}

export type ResteAVivre = {
  /** Le chiffre à afficher. Pessimiste par construction. */
  montant_cents: Cents
  /** Ce que donnerait la valeur centrale des estimations. À ne pas mettre en gros. */
  montant_central_cents: Cents
  /** Date de la prochaine rentrée, ou `null` s'il n'en est pas connu dans l'horizon. */
  prochaineRentree: CivilDate | null
  /** Jour jusqu'auquel le calcul court, rentrée ou repli de fin de mois. */
  horizon: CivilDate
  /** Vrai quand aucune rentrée n'était connue : l'écran doit le dire, pas laisser deviner. */
  horizonParDefaut: boolean
  composition: {
    /** Nombre de sorties retenues. « 7 échéances connues » se lit ici. */
    echeances: number
    echeancesEstimees: number
    /** Total des sorties, à la borne défavorable. Négatif. */
    total_echeances_cents: Cents
  }
}

/**
 * Calcule le reste à vivre.
 *
 * L'horizon est la première rentrée strictement postérieure à `depuis`. S'il n'y
 * en a aucune dans les 60 jours, l'horizon devient la fin du mois courant et
 * `horizonParDefaut` passe à vrai : un chiffre dont la portée est invisible ne
 * veut rien dire, l'écran doit pouvoir écrire « aucune rentrée connue d'ici le 30 ».
 *
 * Seules les **sorties** sont retirées. La rentrée qui borne l'horizon n'est
 * jamais ajoutée : c'est précisément ce qu'on attend, pas ce dont on dispose.
 */
export function resteAVivre(parametres: ParametresResteAVivre): ResteAVivre {
  const {
    soldeCourant,
    echeances,
    reserve_cents,
    depuis,
    horizonMaxJours = HORIZON_MAX_JOURS,
  } = parametres

  const limiteRecherche = ajouterJours(depuis, horizonMaxJours)
  const prochaineRentree =
    echeances
      .filter((e) => e.montant_cents > 0 && e.date > depuis && e.date <= limiteRecherche)
      .map((e) => e.date)
      .sort()[0] ?? null

  const horizon = prochaineRentree ?? dernierJourDuMois(depuis)
  const horizonParDefaut = prochaineRentree === null

  // Un repli de fin de mois peut tomber avant `depuis` — le dernier jour du mois
  // est déjà passé quand on est le 31. La fenêtre est alors vide, ce qui est
  // correct : il n'y a plus rien à retirer d'ici demain.
  const sorties = echeances.filter(
    (e) => e.montant_cents < 0 && e.date > depuis && e.date <= horizon,
  )

  let totalPessimiste = 0
  let totalCentral = 0
  for (const sortie of sorties) {
    // Borne basse = valeur signée la plus petite = la plus grosse dépense.
    totalPessimiste += sortie.borne_basse_cents
    totalCentral += sortie.montant_cents
  }

  return {
    montant_cents: cents(soldeCourant + totalPessimiste - reserve_cents),
    montant_central_cents: cents(soldeCourant + totalCentral - reserve_cents),
    prochaineRentree,
    horizon,
    horizonParDefaut,
    composition: {
      echeances: sorties.length,
      echeancesEstimees: sorties.filter((s) => s.estime).length,
      total_echeances_cents: cents(totalPessimiste),
    },
  }
}
