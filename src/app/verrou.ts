/**
 * Verrou d'appareil.
 *
 * Ce n'est pas une authentification : il n'y a ni compte, ni session, ni serveur.
 * C'est un verrou physique — empêcher quelqu'un qui emprunte le téléphone de
 * lire les données.
 *
 * Deux règles qui ne sont pas négociables :
 *
 * - **Temporisation exponentielle** sur échec, pour que l'essai systématique
 *   coûte du temps.
 * - **Aucun effacement automatique** après N essais. Avec un PIN irrécupérable,
 *   l'effacement ne serait pas une protection mais un piège : la plus mauvaise
 *   façon de perdre ses données serait de se tromper six fois de suite.
 */
import {
  chiffreurCoffre,
  chiffreurIdentite,
  creerCoffre,
  ouvrirCoffre,
  PinIncorrect,
  type Chiffreur,
  type MetaCoffre,
} from '../storage/crypto'

export const PIN_LONGUEUR_MIN = 4
export const PIN_LONGUEUR_RECOMMANDEE = 6

/** Attente imposée après `echecs` tentatives ratées, en millisecondes. */
export function attenteApresEchecs(echecs: number): number {
  if (echecs <= 2) return 0
  // 1 s, 2 s, 4 s… plafonné à 5 minutes : au-delà, c'est l'utilisateur légitime
  // qu'on punit, et l'attaquant a de toute façon renoncé ou automatisé.
  return Math.min(1000 * 2 ** (echecs - 3), 300_000)
}

export type EtatVerrou =
  | { statut: 'sans_pin' }
  | { statut: 'verrouille'; echecs: number; attenteJusqua: number }
  | { statut: 'ouvert' }

export type Verrou = {
  etat: EtatVerrou
  chiffreur: Chiffreur
  meta: MetaCoffre | null
}

export function verrouSansPin(): Verrou {
  return { etat: { statut: 'sans_pin' }, chiffreur: chiffreurIdentite(), meta: null }
}

export function verrouFerme(meta: MetaCoffre): Verrou {
  return {
    etat: { statut: 'verrouille', echecs: 0, attenteJusqua: 0 },
    chiffreur: chiffreurIdentite(),
    meta,
  }
}

/**
 * Résultat d'une tentative.
 *
 * Un échec n'est pas une exception : c'est un cas prévu, qui fait avancer le
 * compteur et rend un verrou mis à jour. L'appelant n'a rien à reconstruire.
 */
export type ResultatDeverrouillage =
  | { ok: true; verrou: Verrou }
  | { ok: false; raison: 'pin_incorrect'; verrou: Verrou }
  | { ok: false; raison: 'trop_tot'; verrou: Verrou; resteMs: number }

/** Tente d'ouvrir le coffre. Rend toujours le verrou à jour, ouvert ou non. */
export async function deverrouiller(
  verrou: Verrou,
  pin: string,
  maintenant: number,
): Promise<ResultatDeverrouillage> {
  if (verrou.meta === null) throw new Error('Aucun coffre à ouvrir')
  const etat = verrou.etat
  if (etat.statut === 'verrouille' && maintenant < etat.attenteJusqua) {
    return { ok: false, raison: 'trop_tot', verrou, resteMs: etat.attenteJusqua - maintenant }
  }
  try {
    const coffre = await ouvrirCoffre(pin, verrou.meta)
    return {
      ok: true,
      verrou: { etat: { statut: 'ouvert' }, chiffreur: chiffreurCoffre(coffre), meta: verrou.meta },
    }
  } catch (erreur) {
    if (!(erreur instanceof PinIncorrect)) throw erreur
    const echecs = (etat.statut === 'verrouille' ? etat.echecs : 0) + 1
    return {
      ok: false,
      raison: 'pin_incorrect',
      verrou: {
        etat: {
          statut: 'verrouille',
          echecs,
          attenteJusqua: maintenant + attenteApresEchecs(echecs),
        },
        chiffreur: chiffreurIdentite(),
        meta: verrou.meta,
      },
    }
  }
}

/** Configure un PIN pour la première fois. */
export async function configurerPin(pin: string): Promise<Verrou> {
  verifierPin(pin)
  const coffre = await creerCoffre(pin)
  return { etat: { statut: 'ouvert' }, chiffreur: chiffreurCoffre(coffre), meta: coffre.meta }
}

export function verifierPin(pin: string): void {
  if (!/^\d+$/.test(pin)) throw new Error('Le code ne contient que des chiffres')
  if (pin.length < PIN_LONGUEUR_MIN) {
    throw new Error(`Le code fait au moins ${PIN_LONGUEUR_MIN} chiffres`)
  }
}

/** Verrouille à nouveau : la clé quitte la mémoire. */
export function verrouiller(verrou: Verrou): Verrou {
  if (verrou.meta === null) return verrou
  return verrouFerme(verrou.meta)
}

/**
 * Délai d'inactivité avant re-verrouillage automatique.
 *
 * Deux minutes : assez pour répondre à un message sans retaper le code, trop peu
 * pour qu'un téléphone posé sur une table reste ouvert.
 */
export const DELAI_REVERROUILLAGE_MS = 120_000
