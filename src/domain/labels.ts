/**
 * Choisir un label, ou en créer un en le nommant.
 *
 * Les labels naissaient uniquement dans l'ajout rapide. Partout ailleurs — sur
 * un abonnement, par exemple — on ne pouvait que choisir parmi ceux qui
 * existaient déjà, c'est-à-dire aucun sur une application neuve. Un abonnement
 * ne pouvait donc pas être catégorisé le jour où on le crée, moment précis où
 * l'on sait à quoi il sert.
 *
 * La résolution est ici, une fois, plutôt que recopiée dans chaque écran : c'est
 * elle qui porte la règle d'unicité, et une règle d'unicité recopiée finit
 * toujours par diverger.
 */
import { identifiant } from './identifiant'
import { normaliserNom } from './etat'
import { labelParNom } from './selecteurs'
import type { Etat } from './etat'
import type { TypeEvenement } from './events'

export type ChoixLabel = {
  /** Identifiant d'un label existant, ou `''`. */
  labelId: string
  /** Nom d'un label à créer. L'emporte sur `labelId` s'il est renseigné. */
  nouveauNom: string
}

export type LabelResolu = {
  /** Le label à rattacher, ou `''` pour « non catégorisé ». */
  labelId: string
  /** L'événement de création, s'il y a lieu. À écrire **avant** ce qui l'utilise. */
  entrees: { type: TypeEvenement; payload: Record<string, unknown> }[]
}

/** Couleur par défaut d'un label créé à la volée. */
export const COULEUR_LABEL = '#4ade80'

/**
 * Rend le label à employer, en créant celui qui manque.
 *
 * Un nom déjà pris sous une autre casse ne crée rien : « courses », « Courses »
 * et « COURSES » sont le même label. Sans cela, une même dépense se répartirait
 * entre trois postes selon la façon dont on l'a tapée ce jour-là.
 */
export function resoudreLabel(etat: Etat, choix: ChoixLabel): LabelResolu {
  const nom = choix.nouveauNom.trim()
  if (nom === '') return { labelId: choix.labelId, entrees: [] }

  const existant = labelParNom(etat, nom)
  if (existant) return { labelId: existant.id, entrees: [] }

  const labelId = identifiant(`label-${normaliserNom(nom).replace(/[^a-z0-9]+/g, '-')}`)
  return {
    labelId,
    entrees: [{ type: 'label.created', payload: { id: labelId, nom, couleur: COULEUR_LABEL } }],
  }
}

/** Labels utilisables : les archivés n'ont plus à être proposés. */
export function labelsActifs(etat: Etat) {
  return [...etat.labels.values()]
    .filter((label) => label.archived_at === undefined)
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
}
