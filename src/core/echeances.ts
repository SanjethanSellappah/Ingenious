/**
 * Des règles aux échéances valorisées.
 *
 * Point de jonction du noyau : une récurrence, son historique de prix, ses
 * exceptions et ses occurrences réalisées entrent ; des échéances datées,
 * signées et encadrées sortent — exactement ce que consomment la projection et
 * le reste à vivre.
 *
 * Tout ce qui ne peut pas être valorisé est rendu à part plutôt qu'omis ou
 * comblé par un zéro : un abonnement estimé sans historique n'a pas de montant,
 * et l'écran doit le réclamer au lieu de faire comme s'il valait zéro.
 */
import { type CivilDate } from './civilDate'
import {
  estimer,
  resoudreMontant,
  type Estimation,
  type Exception,
  type OccurrenceRealisee,
} from './estimation'
import { montantValideA, type PrixAbonnement } from './prixAbonnement'
import type { EcheanceProjetee } from './projection'
import { occurrences, type Occurrence, type RegleRecurrence } from './recurrence'

export type Recurrence = {
  id: string
  libelle: string
  regle: RegleRecurrence
  sens: 'depense' | 'rentree'
  montant_mode: 'fixe' | 'estime'
  /** Historique tarifaire, pour le mode `fixe`. */
  prix?: readonly PrixAbonnement[]
  /** Exceptions enregistrées, indexées par date théorique. */
  exceptions?: readonly Exception[]
  /** Occurrences dont le montant réel est connu, pour le mode `estime`. */
  realisees?: readonly OccurrenceRealisee[]
  estimation_fenetre?: number
  /** Défaut vrai. Un abonnement résilié ne produit plus d'échéance. */
  actif?: boolean
  label_id?: string
}

/** Une occurrence qu'on n'a pas su valoriser, et pourquoi. */
export type EcheanceNonResolue = {
  recurrence_id: string
  libelle: string
  occurrence: Occurrence
  raison: 'aucun_tarif_connu' | 'aucun_historique_a_estimer'
}

export type ResultatEcheances = {
  echeances: EcheanceProjetee[]
  nonResolues: EcheanceNonResolue[]
}

/**
 * Échéances d'une récurrence dont la **date décalée** tombe dans `[debut, fin]`.
 *
 * Le tarif retenu est celui valide à la **date théorique** : c'est la date que
 * porte le contrat. Un prélèvement avancé au vendredi parce que le 1er tombe un
 * dimanche ne change pas de tarif pour autant.
 */
export function echeancesDeLaRecurrence(
  recurrence: Recurrence,
  debut: CivilDate,
  fin: CivilDate,
): ResultatEcheances {
  const echeances: EcheanceProjetee[] = []
  const nonResolues: EcheanceNonResolue[] = []
  if (recurrence.actif === false) return { echeances, nonResolues }

  // L'estimation ne porte que sur des occurrences déjà réalisées, donc passées :
  // elle est la même pour toutes les échéances à venir, et se calcule une fois.
  const estimation: Estimation | null =
    recurrence.montant_mode === 'estime'
      ? estimer(recurrence.realisees ?? [], recurrence.estimation_fenetre)
      : null

  for (const occurrence of occurrences(recurrence.regle, debut, fin)) {
    const exception = recurrence.exceptions?.find(
      (e) => e.date_theorique === occurrence.date_theorique,
    )
    // Le tarif enregistré sert de montant contractuel en mode `fixe`, et de
    // montant de départ en mode `estime` — la valeur annoncée à la création,
    // utilisée tant qu'aucune occurrence n'a été confirmée.
    const tarif = montantValideA(recurrence.prix ?? [], occurrence.date_theorique) ?? undefined
    const montantFixe = recurrence.montant_mode === 'fixe' ? tarif : undefined
    const montantDeDepart = recurrence.montant_mode === 'estime' ? tarif : undefined

    const resolu = resoudreMontant({
      ...(montantFixe !== undefined ? { montantFixe } : {}),
      ...(montantDeDepart !== undefined ? { montantDeDepart } : {}),
      ...(exception ? { exception } : {}),
      estimation,
      sens: recurrence.sens,
    })

    if (resolu === null) {
      nonResolues.push({
        recurrence_id: recurrence.id,
        libelle: recurrence.libelle,
        occurrence,
        raison:
          recurrence.montant_mode === 'fixe' ? 'aucun_tarif_connu' : 'aucun_historique_a_estimer',
      })
      continue
    }

    echeances.push({
      date: occurrence.date_affichee,
      montant_cents: resolu.montant_cents,
      borne_basse_cents: resolu.borne_basse_cents,
      borne_haute_cents: resolu.borne_haute_cents,
      estime: resolu.estime,
      libelle: recurrence.libelle,
      reference: { subscription_id: recurrence.id, date_theorique: occurrence.date_theorique },
    })
  }

  return { echeances, nonResolues }
}

/** Même chose pour un ensemble de récurrences, échéances triées par date réelle. */
export function echeancesDesRecurrences(
  recurrences: readonly Recurrence[],
  debut: CivilDate,
  fin: CivilDate,
): ResultatEcheances {
  const echeances: EcheanceProjetee[] = []
  const nonResolues: EcheanceNonResolue[] = []
  for (const recurrence of recurrences) {
    const resultat = echeancesDeLaRecurrence(recurrence, debut, fin)
    echeances.push(...resultat.echeances)
    nonResolues.push(...resultat.nonResolues)
  }
  echeances.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return { echeances, nonResolues }
}
