/**
 * Magasin d'état.
 *
 * Le journal joue déjà le rôle qu'aurait tenu un Redux : il est la source de
 * vérité, append-only, et l'état se recalcule en le repliant. Le magasin n'a
 * donc qu'un travail — garder le journal en mémoire, le replier à chaque
 * écriture, et prévenir React.
 *
 * `useSyncExternalStore` suffit : aucune dépendance, et un seul chemin d'écriture.
 */
import { plier, type Etat, etatVide } from '../domain/etat'
import type { Evenement, TypeEvenement } from '../domain/events'
import type { Depot } from '../storage/repository'

export type EtatApplication = {
  /** État déplié, recalculé à chaque écriture. */
  etat: Etat
  journal: Evenement[]
  /** Événements que le dépôt n'a pas su relire. Affichés dans Réglages, jamais tus. */
  rejets: { index: number; raison: string }[]
  /**
   * Vrai seulement tant que le journal n'a **jamais** été lu.
   *
   * Une relecture ultérieure — après un import, par exemple — ne doit pas vider
   * l'écran : l'écran disparaîtrait, l'état local des composants avec lui, et le
   * message qui annonce le résultat de l'import serait perdu au moment précis où
   * il compte.
   */
  chargement: boolean
  /** Vrai pendant une relecture, écran conservé. */
  relecture: boolean
  erreur: string | null
}

type Abonne = () => void

const initial: EtatApplication = {
  etat: etatVide(),
  journal: [],
  rejets: [],
  chargement: true,
  relecture: false,
  erreur: null,
}

let instantane: EtatApplication = initial
const abonnes = new Set<Abonne>()
let depot: Depot | null = null

function publier(suivant: EtatApplication): void {
  instantane = suivant
  for (const abonne of abonnes) abonne()
}

export function sabonner(abonne: Abonne): () => void {
  abonnes.add(abonne)
  return () => abonnes.delete(abonne)
}

export function lire(): EtatApplication {
  return instantane
}

/** Rattache un dépôt et charge le journal. Appelé une fois, au démarrage. */
export async function brancherDepot(nouveau: Depot): Promise<void> {
  depot = nouveau
  await recharger()
}

export async function recharger(): Promise<void> {
  if (!depot) throw new Error('Aucun dépôt branché')
  publier({ ...instantane, relecture: true, erreur: null })
  try {
    const { evenements, rejets } = await depot.chargerTout()
    publier({
      etat: plier(evenements),
      journal: evenements,
      rejets,
      chargement: false,
      relecture: false,
      erreur: null,
    })
  } catch (erreur) {
    publier({
      ...instantane,
      chargement: false,
      relecture: false,
      erreur: erreur instanceof Error ? erreur.message : String(erreur),
    })
  }
}

/**
 * Écrit un ou plusieurs événements, puis replie.
 *
 * Une seule passe pour plusieurs événements : leur ordre relatif est garanti,
 * ce dont la réconciliation dépend.
 */
export async function ecrire(
  entrees: readonly { type: TypeEvenement; payload: Record<string, unknown> }[],
): Promise<Evenement[]> {
  if (!depot) throw new Error('Aucun dépôt branché')
  const ecrits = await depot.ajouterPlusieurs(entrees)
  const journal = [...instantane.journal, ...ecrits]
  publier({ ...instantane, journal, etat: plier(journal) })
  return ecrits
}

export function depotCourant(): Depot | null {
  return depot
}

/** Remet le magasin à zéro. Réservé aux tests. */
export function reinitialiserMagasin(): void {
  depot = null
  publier(initial)
  abonnes.clear()
}
