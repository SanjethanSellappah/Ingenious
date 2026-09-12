/**
 * Automatismes d'ouverture.
 *
 * Sans serveur, il n'y a pas de cron : tout se déclenche à l'ouverture de
 * l'application. Deux conséquences assumées et visibles dans l'interface :
 *
 * - **La courbe de patrimoine aura des trous** les semaines sans ouverture. On
 *   relie les points existants, on n'invente jamais de valeur intermédiaire.
 * - **Le rappel de sauvegarde arrive en retard** si l'application n'est pas
 *   ouverte. C'est mieux que rien, et il faut le dire plutôt que de promettre
 *   une régularité qu'on ne peut pas tenir.
 */
import { ajouterJours, dateCivile, joursEntre, type CivilDate } from '../core/civilDate'
import { aujourdhui } from '../core/clock'
import type { Etat } from '../domain/etat'
import { soldeDuCompte } from '../domain/selecteurs'
import { ecrire } from './magasin'

/** Un instantané par compte et par jour, au plus. */
export async function enregistrerInstantanes(
  etat: Etat,
  jour: CivilDate = aujourdhui(),
): Promise<number> {
  const dejaFait = new Set(etat.instantanes.filter((i) => i.date === jour).map((i) => i.account_id))
  const entrees: Parameters<typeof ecrire>[0][number][] = []

  for (const compte of etat.comptes.values()) {
    if (compte.archived_at !== undefined) continue
    if (dejaFait.has(compte.id)) continue
    entrees.push({
      type: 'snapshot.recorded',
      payload: {
        account_id: compte.id,
        date: jour,
        valeur_cents: soldeDuCompte(etat, compte.id, jour),
      },
    })
  }

  if (entrees.length === 0) return 0
  await ecrire(entrees)
  return entrees.length
}

/** Trente jours : un rappel mensuel, pas un harcèlement. */
export const DELAI_RAPPEL_JOURS = 30
const CLE_DERNIER_EXPORT = 'ingenious.dernier-export'

/**
 * Date du dernier export.
 *
 * Stockée hors du journal, délibérément : c'est une propriété de **cet appareil**,
 * pas de la donnée. Un journal importé sur un second téléphone ne doit pas lui
 * faire croire qu'il a été sauvegardé.
 */
export function dernierExport(): CivilDate | null {
  try {
    const brut = localStorage.getItem(CLE_DERNIER_EXPORT)
    return brut !== null && /^\d{4}-\d{2}-\d{2}$/.test(brut) ? (brut as CivilDate) : null
  } catch {
    // Stockage bloqué (navigation privée, réglages) : on ne rappelle rien plutôt
    // que de planter.
    return null
  }
}

export function marquerExport(jour: CivilDate = aujourdhui()): void {
  try {
    localStorage.setItem(CLE_DERNIER_EXPORT, jour)
  } catch {
    // Sans mémoire locale, le rappel réapparaîtra : c'est le bon sens de l'erreur.
  }
}

export type EtatRappel = { du: boolean; dernier: CivilDate | null; jours: number | null }

export function rappelSauvegarde(jour: CivilDate = aujourdhui()): EtatRappel {
  const dernier = dernierExport()
  if (dernier === null) return { du: true, dernier: null, jours: null }
  const limite = ajouterJours(dateCivile(dernier), DELAI_RAPPEL_JOURS)
  const jours = joursEntre(dateCivile(dernier), jour)
  return { du: jour > limite, dernier, jours }
}
