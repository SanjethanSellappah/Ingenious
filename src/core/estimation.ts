/**
 * Estimation des montants variables.
 *
 * Un seul mécanisme pour le salaire variable, l'électricité, le gaz et les
 * revenus irréguliers : la médiane des dernières occurrences réalisées.
 *
 * **Médiane, pas moyenne.** Un treizième mois ou une prime tire la moyenne vers
 * le haut et rend les six mois suivants trop optimistes ; la médiane l'absorbe.
 * Sur un chiffre censé répondre à « combien je peux dépenser », le sens de
 * l'erreur compte plus que sa taille.
 */
import { comparer, type CivilDate } from './civilDate'
import { arrondirCents, cents, type Cents } from './money'

/** Une occurrence dont le montant réel est connu. */
export type OccurrenceRealisee = {
  /** Date théorique — la clé de l'occurrence, pas sa date d'affichage. */
  date_theorique: CivilDate
  montant_cents: Cents
  /** Mise à l'écart d'une valeur atypique : prime, régularisation, rappel. */
  exclu_de_estimation?: boolean
}

export type Estimation = {
  /** Valeur centrale, celle qu'affichent le patrimoine et les graphiques. */
  mediane: Cents
  /** Plus petite valeur de la fenêtre — borne basse pour une rentrée. */
  min: Cents
  /** Plus grande valeur de la fenêtre — borne haute. */
  max: Cents
  /** Nombre d'occurrences réellement prises en compte. */
  echantillon: number
  /** Vrai si la fenêtre demandée n'a pas pu être remplie. */
  echantillonIncomplet: boolean
}

export const FENETRE_PAR_DEFAUT = 6

/**
 * Médiane d'une série non vide.
 *
 * Fenêtre de taille paire : moyenne des deux valeurs centrales, arrondie par
 * `arrondirCents`. Figé ici pour que le résultat soit le même partout — une
 * médiane « approximative » rendrait les tests non déterministes et les écarts
 * inexplicables.
 */
export function mediane(valeurs: readonly Cents[]): Cents {
  if (valeurs.length === 0) throw new RangeError('Médiane d’une série vide')
  const triees = [...valeurs].sort((a, b) => a - b)
  const milieu = Math.floor(triees.length / 2)
  if (triees.length % 2 === 1) return triees[milieu]!
  return arrondirCents((triees[milieu - 1]! + triees[milieu]!) / 2)
}

/**
 * Estime le montant d'une occurrence à venir depuis les occurrences réalisées.
 *
 * Retourne `null` s'il n'y a rien à estimer : au premier mois, il n'existe aucun
 * historique, et inventer une valeur serait pire que demander une saisie.
 * L'onboarding demande déjà ce montant de départ.
 */
export function estimer(
  realisees: readonly OccurrenceRealisee[],
  fenetre: number = FENETRE_PAR_DEFAUT,
): Estimation | null {
  if (!Number.isInteger(fenetre) || fenetre < 1)
    throw new RangeError(`Fenêtre invalide : ${fenetre}`)

  const retenues = realisees
    .filter((o) => o.exclu_de_estimation !== true)
    .sort((a, b) => comparer(b.date_theorique, a.date_theorique))
    .slice(0, fenetre)

  if (retenues.length === 0) return null

  const montants = retenues.map((o) => o.montant_cents)
  return {
    mediane: mediane(montants),
    min: cents(Math.min(...montants)),
    max: cents(Math.max(...montants)),
    echantillon: retenues.length,
    echantillonIncomplet: retenues.length < fenetre,
  }
}

export type StatutOccurrence = 'previsionnel' | 'realise'

/** Exception enregistrée sur une occurrence précise. */
export type Exception = {
  date_theorique: CivilDate
  montant_cents: Cents
  statut: StatutOccurrence
  exclu_de_estimation?: boolean
}

export type MontantResolu = {
  montant_cents: Cents
  /** Borne la plus défavorable au solde, et la plus favorable. Égales si le montant est certain. */
  borne_basse_cents: Cents
  borne_haute_cents: Cents
  origine: 'realise' | 'previsionnel' | 'fixe' | 'estimation' | 'depart'
  estime: boolean
}

/**
 * Résout le montant d'une occurrence, par priorité décroissante :
 *
 * 1. **Réalisé** — le montant réel est connu, il gagne toujours.
 * 2. **Prévisionnel saisi** — l'utilisateur a annoncé un montant pour cette date.
 * 3. **Montant contractuel**, pour une récurrence à montant fixe.
 * 4. **Estimation** — médiane de la fenêtre glissante.
 * 5. **Montant de départ** — la valeur saisie à la création, quand aucune
 *    occurrence n'a encore été réalisée. Sans lui, une récurrence estimée
 *    disparaîtrait de la projection pendant tout le premier mois, puis
 *    réapparaîtrait : l'onboarding demande ce montant pour cette raison.
 *
 * Les bornes encadrent le montant central. Elles sont **signées** : la borne
 * basse est toujours la valeur la plus petite, donc la plus défavorable au
 * solde, qu'il s'agisse d'une rentrée qu'on espère grosse ou d'une dépense qu'on
 * craint grosse. Cette symétrie évite d'avoir à traiter les deux sens séparément,
 * et donc de se tromper de côté sur l'un des deux.
 */
export function resoudreMontant(parametres: {
  /** Montant contractuel, pour une récurrence à montant fixe. */
  montantFixe?: Cents
  /** Valeur de repli d'une récurrence estimée sans historique. */
  montantDeDepart?: Cents
  /** Exception enregistrée pour cette date théorique, s'il y en a une. */
  exception?: Exception
  /** Estimation calculée sur la fenêtre, si la récurrence est à montant estimé. */
  estimation?: Estimation | null
  /** Sens du mouvement : une dépense est portée en négatif. */
  sens: 'depense' | 'rentree'
}): MontantResolu | null {
  const { exception, estimation, montantFixe, montantDeDepart, sens } = parametres
  const signer = (montant: Cents): Cents =>
    cents(sens === 'depense' ? -Math.abs(montant) : Math.abs(montant))

  if (exception?.statut === 'realise') {
    const montant = signer(exception.montant_cents)
    return {
      montant_cents: montant,
      borne_basse_cents: montant,
      borne_haute_cents: montant,
      origine: 'realise',
      estime: false,
    }
  }
  if (exception?.statut === 'previsionnel') {
    const montant = signer(exception.montant_cents)
    return {
      montant_cents: montant,
      borne_basse_cents: montant,
      borne_haute_cents: montant,
      origine: 'previsionnel',
      estime: false,
    }
  }
  if (montantFixe !== undefined) {
    const montant = signer(montantFixe)
    return {
      montant_cents: montant,
      borne_basse_cents: montant,
      borne_haute_cents: montant,
      origine: 'fixe',
      estime: false,
    }
  }
  if (estimation) {
    const centrale = signer(estimation.mediane)
    const a = signer(estimation.min)
    const b = signer(estimation.max)
    return {
      montant_cents: centrale,
      borne_basse_cents: cents(Math.min(a, b)),
      borne_haute_cents: cents(Math.max(a, b)),
      origine: 'estimation',
      estime: true,
    }
  }
  if (montantDeDepart !== undefined) {
    // Marqué estimé : c'est une valeur annoncée, pas constatée. Les bornes sont
    // confondues faute de dispersion connue — dire « entre X et X » serait plus
    // honnête que d'inventer une fourchette qu'on n'a pas mesurée.
    const montant = signer(montantDeDepart)
    return {
      montant_cents: montant,
      borne_basse_cents: montant,
      borne_haute_cents: montant,
      origine: 'depart',
      estime: true,
    }
  }
  return null
}
