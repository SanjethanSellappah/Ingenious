/**
 * Récurrences.
 *
 * Deux principes, qui tiennent tout le reste :
 *
 * 1. **Les occurrences ne sont pas stockées, elles se calculent.** Une règle et
 *    une liste d'exceptions, comme iCalendar. Matérialiser les échéances futures
 *    oblige à les régénérer à chaque modification de la règle, et à réconcilier
 *    ce qui a déjà été touché à la main.
 * 2. **La date théorique est la clé, la date décalée est un affichage.** Stocker
 *    la date décalée fait dériver la règle : un prélèvement « le 5 » décalé au 7
 *    un mois donné deviendrait un prélèvement « le 7 » le mois suivant.
 *
 * Corollaire d'implémentation : une occurrence ne se calcule jamais par additions
 * successives depuis la précédente — un mois court rognerait le quantième et la
 * série dériverait. Chaque occurrence se recalcule depuis le mois d'ancrage.
 */
import {
  ajouterJours,
  composantes,
  depuisComposantes,
  joursDansLeMois,
  joursEntre,
  moisEntre,
  type CivilDate,
} from './civilDate'
import { precedentJourOuvre, prochainJourOuvre } from './holidaysFR'

export type Frequence = 'mensuel' | 'trimestriel' | 'annuel' | 'personnalise'
export type UniteIntervalle = 'mois' | 'semaine' | 'jour'
export type RegleWeekend = 'exact' | 'jour_ouvre_suivant' | 'jour_ouvre_precedent'
export type RegleMoisCourt = 'dernier_jour' | 'ignorer'

export type RegleRecurrence = {
  frequence: Frequence
  /** Nombre de périodes entre deux occurrences. Défaut 1. */
  intervalle?: number
  /**
   * Unité de l'intervalle, seulement pour `personnalise`. Défaut `mois`.
   * Les autres fréquences imposent la leur : 1, 3 ou 12 mois.
   */
  unite_intervalle?: UniteIntervalle
  /** Quantième visé, 1 à 31. Défaut : celui de `date_debut`. Ignoré si l'unité est en jours ou semaines. */
  jour_du_mois?: number
  /** Que faire quand le mois est trop court. Défaut `dernier_jour`. */
  regle_mois_court?: RegleMoisCourt
  /** Décalage appliqué à l'affichage quand la date théorique n'est pas ouvrée. Défaut `exact`. */
  regle_weekend?: RegleWeekend
  date_debut: CivilDate
  date_fin?: CivilDate
}

export type Occurrence = {
  /** Date issue de la règle. C'est elle qui identifie l'occurrence, et elle seule. */
  date_theorique: CivilDate
  /** Date à laquelle l'argent bouge réellement, après décalage jour ouvré. */
  date_affichee: CivilDate
}

/**
 * Marge de génération, en jours, de part et d'autre de la fenêtre demandée.
 *
 * Une occurrence théorique hors fenêtre peut s'y afficher après décalage — un
 * prélèvement théorique au 1er août, samedi, réglé sur `jour_ouvre_precedent`,
 * tombe le 31 juillet. Sans marge, il disparaîtrait de la projection de juillet.
 */
const MARGE_JOURS = 12

/** Applique le décalage jour ouvré. La date théorique n'est jamais modifiée. */
export function dateAffichee(dateTheorique: CivilDate, regle: RegleWeekend = 'exact'): CivilDate {
  switch (regle) {
    case 'exact':
      return dateTheorique
    case 'jour_ouvre_suivant':
      return prochainJourOuvre(dateTheorique)
    case 'jour_ouvre_precedent':
      return precedentJourOuvre(dateTheorique)
  }
}

type ReglePreparee = Required<Omit<RegleRecurrence, 'date_fin'>> & { date_fin?: CivilDate }

/** Complète les défauts et refuse une règle incohérente. */
export function preparerRegle(regle: RegleRecurrence): ReglePreparee {
  const intervalle = regle.intervalle ?? 1
  if (!Number.isInteger(intervalle) || intervalle < 1) {
    throw new RangeError(`Intervalle invalide : ${intervalle}`)
  }
  const jourDuMois = regle.jour_du_mois ?? composantes(regle.date_debut).jour
  if (!Number.isInteger(jourDuMois) || jourDuMois < 1 || jourDuMois > 31) {
    throw new RangeError(`Jour du mois invalide : ${jourDuMois}`)
  }
  if (regle.date_fin !== undefined && regle.date_fin < regle.date_debut) {
    throw new RangeError(`Fin (${regle.date_fin}) antérieure au début (${regle.date_debut})`)
  }
  const unite = regle.frequence === 'personnalise' ? (regle.unite_intervalle ?? 'mois') : 'mois'
  const preparee: ReglePreparee = {
    frequence: regle.frequence,
    intervalle,
    unite_intervalle: unite,
    jour_du_mois: jourDuMois,
    regle_mois_court: regle.regle_mois_court ?? 'dernier_jour',
    regle_weekend: regle.regle_weekend ?? 'exact',
    date_debut: regle.date_debut,
  }
  if (regle.date_fin !== undefined) preparee.date_fin = regle.date_fin
  return preparee
}

/** Nombre de mois entre deux occurrences, pour les règles mensuelles. */
function pasEnMois(regle: ReglePreparee): number {
  switch (regle.frequence) {
    case 'mensuel':
      return regle.intervalle
    case 'trimestriel':
      return 3 * regle.intervalle
    case 'annuel':
      return 12 * regle.intervalle
    case 'personnalise':
      return regle.intervalle
  }
}

/**
 * Date théorique d'une occurrence dans un mois donné, ou `null` si le mois est
 * trop court et que la règle demande de l'ignorer.
 */
function dateDansLeMois(regle: ReglePreparee, annee: number, mois: number): CivilDate | null {
  const max = joursDansLeMois(annee, mois)
  if (regle.jour_du_mois > max) {
    if (regle.regle_mois_court === 'ignorer') return null
    return depuisComposantes(annee, mois, max)
  }
  return depuisComposantes(annee, mois, regle.jour_du_mois)
}

/**
 * Dates théoriques dont la **date théorique** tombe dans `[debut, fin]`.
 * Pour projeter, utiliser `occurrences` : c'est la date décalée qui compte.
 */
export function occurrencesTheoriques(
  regleBrute: RegleRecurrence,
  debut: CivilDate,
  fin: CivilDate,
): CivilDate[] {
  const regle = preparerRegle(regleBrute)
  if (fin < debut) return []
  const bornesHautes = regle.date_fin !== undefined && regle.date_fin < fin ? regle.date_fin : fin
  if (bornesHautes < regle.date_debut) return []

  const dates: CivilDate[] = []

  if (regle.unite_intervalle !== 'mois') {
    const pas = regle.unite_intervalle === 'semaine' ? 7 * regle.intervalle : regle.intervalle
    // Départ calé sur la première occurrence utile plutôt qu'itéré depuis
    // `date_debut` : une règle démarrée il y a dix ans ne doit pas coûter
    // trois mille tours de boucle à chaque affichage.
    const depuisDebut = joursEntre(regle.date_debut, debut)
    const premierK = depuisDebut <= 0 ? 0 : Math.ceil(depuisDebut / pas)
    for (let k = premierK; ; k++) {
      const date = ajouterJours(regle.date_debut, k * pas)
      if (date > bornesHautes) break
      if (date >= debut && date >= regle.date_debut) dates.push(date)
    }
    return dates
  }

  const pas = pasEnMois(regle)
  const ancre = composantes(regle.date_debut)
  const ecartMois = moisEntre(regle.date_debut, debut)
  const premierK = Math.max(0, Math.floor(ecartMois / pas) - 1)
  for (let k = premierK; ; k++) {
    const indiceMois = ancre.annee * 12 + (ancre.mois - 1) + k * pas
    const annee = Math.floor(indiceMois / 12)
    const mois = (indiceMois % 12) + 1
    // Le mois lui-même dépasse la borne : plus rien ne viendra.
    if (depuisComposantes(annee, mois, 1) > bornesHautes) break
    const date = dateDansLeMois(regle, annee, mois)
    if (date === null) continue
    if (date > bornesHautes) break
    if (date >= debut && date >= regle.date_debut) dates.push(date)
  }
  return dates
}

/**
 * Occurrences dont la **date décalée** tombe dans `[debut, fin]`.
 *
 * C'est la fonction que consomment la projection et le calendrier : ce qui
 * intéresse un solde, c'est le jour où l'argent bouge.
 */
export function occurrences(
  regleBrute: RegleRecurrence,
  debut: CivilDate,
  fin: CivilDate,
): Occurrence[] {
  const regle = preparerRegle(regleBrute)
  if (fin < debut) return []
  const theoriques = occurrencesTheoriques(
    regleBrute,
    ajouterJours(debut, -MARGE_JOURS),
    ajouterJours(fin, MARGE_JOURS),
  )
  const retenues: Occurrence[] = []
  for (const theorique of theoriques) {
    const affichee = dateAffichee(theorique, regle.regle_weekend)
    if (affichee >= debut && affichee <= fin) {
      retenues.push({ date_theorique: theorique, date_affichee: affichee })
    }
  }
  // Le décalage peut inverser deux occurrences proches : on trie sur la date
  // réelle, qui est l'ordre dans lequel le compte sera débité.
  return retenues.sort((a, b) =>
    a.date_affichee < b.date_affichee ? -1 : a.date_affichee > b.date_affichee ? 1 : 0,
  )
}

/**
 * Les `combien` prochaines occurrences à partir de `depuis` incluse.
 * Sert l'aperçu du formulaire d'abonnement — dates décalées comprises.
 */
export function prochainesOccurrences(
  regleBrute: RegleRecurrence,
  depuis: CivilDate,
  combien: number,
): Occurrence[] {
  if (combien <= 0) return []
  const trouvees: Occurrence[] = []
  let fenetreDebut = depuis
  // Fenêtres élargies : une règle annuelle n'a rien à donner sur trois mois.
  for (const longueurJours of [92, 400, 1500, 4000]) {
    const fin = ajouterJours(fenetreDebut, longueurJours)
    for (const occurrence of occurrences(regleBrute, fenetreDebut, fin)) {
      trouvees.push(occurrence)
      if (trouvees.length === combien) return trouvees
    }
    fenetreDebut = ajouterJours(fin, 1)
  }
  return trouvees
}
