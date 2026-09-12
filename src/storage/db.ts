/**
 * Base locale.
 *
 * Deux tables seulement. Le journal n'est jamais interrogé par contenu — il est
 * lu en entier au démarrage et plié en mémoire — donc le chiffrement ne coûte
 * aucun index, et la base n'a pas à comprendre ce qu'elle stocke.
 *
 * Seul l'`id` reste en clair : c'est la clé primaire, et c'est ce qui permet de
 * fusionner deux journaux par union sans rien déchiffrer.
 */
import Dexie, { type EntityTable } from 'dexie'

/** Un événement tel qu'il est posé sur le disque : un identifiant, et un contenu opaque. */
export type EnregistrementEvenement = {
  id: string
  /** Scellé quand un PIN est configuré, événement en clair sinon. */
  donnees: unknown
}

export type EnregistrementMeta = {
  cle: string
  valeur: unknown
}

export type BaseIngenious = Dexie & {
  events: EntityTable<EnregistrementEvenement, 'id'>
  meta: EntityTable<EnregistrementMeta, 'cle'>
}

export const NOM_BASE = 'ingenious'

export function ouvrirBase(nom: string = NOM_BASE): BaseIngenious {
  const base = new Dexie(nom) as BaseIngenious
  base.version(1).stores({
    events: 'id',
    meta: 'cle',
  })
  return base
}

export const CLE_COFFRE = 'coffre'
export const CLE_APPAREIL = 'appareil'
export const CLE_PERSISTANCE = 'persistance'
