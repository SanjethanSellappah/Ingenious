/**
 * Valorisation d'un portefeuille.
 *
 * Un compte d'investissement n'a pas de solde qu'on relèverait : il a des lignes
 * — tant de parts, tant de grammes — et un cours qui bouge sans nous. Sa valeur
 * est donc **calculée**, jamais saisie, et elle change sans qu'aucun événement
 * ne soit écrit.
 *
 * Deux conséquences assumées :
 *
 * - **Un cours a un âge**, et cet âge fait partie de l'information. « 4 300 € »
 *   ne veut pas dire la même chose selon qu'il est d'hier ou de mars. Le calcul
 *   rend donc la date du cours le plus ancien employé, et l'interface la montre.
 * - **Une ligne sans cours ne vaut pas zéro**, elle vaut *on ne sait pas*. La
 *   compter pour rien ferait baisser le patrimoine à l'ajout d'une ligne, ce qui
 *   est exactement le contraire de ce qui vient de se passer.
 */
import { arrondirCents, cents, type Cents } from './money'
import type { CivilDate } from './civilDate'

/** Mille millièmes font une unité. Une quantité est entière en millièmes. */
export const MILLIEMES = 1000

export type LigneValorisable = {
  instrument_id: string
  quantite_millimes: number
}

export type CoursConnu = {
  date: CivilDate
  cours_cents: Cents
}

export type ValeurLigne = {
  instrument_id: string
  quantite_millimes: number
  /** `null` quand aucun cours n'est connu à cette date. */
  cours: CoursConnu | null
  /** `null` quand le cours manque : une valeur inconnue n'est pas zéro. */
  valeur_cents: Cents | null
}

export type Valorisation = {
  lignes: ValeurLigne[]
  /** Somme des lignes valorisables. Les lignes sans cours en sont absentes. */
  total_cents: Cents
  /** Combien de lignes n'ont pas pu être valorisées. */
  sansCours: number
  /** Date du cours le plus ancien employé, pour dire l'âge de la valeur. */
  coursLePlusAncien: CivilDate | null
}

/**
 * Dernier cours connu à une date donnée.
 *
 * « À une date donnée » et non « le dernier tout court » : relire le patrimoine
 * du mois dernier avec les cours d'aujourd'hui donnerait une histoire fausse.
 */
export function coursValideA(cours: readonly CoursConnu[], jusqua: CivilDate): CoursConnu | null {
  let retenu: CoursConnu | null = null
  for (const releve of cours) {
    if (releve.date > jusqua) continue
    if (retenu === null || releve.date > retenu.date) retenu = releve
  }
  return retenu
}

/** Valeur d'une ligne : quantité × cours, en centimes. */
export function valeurLigne(quantite_millimes: number, cours_cents: Cents): Cents {
  return arrondirCents((quantite_millimes * cours_cents) / MILLIEMES)
}

export function valoriser(
  lignes: readonly LigneValorisable[],
  coursParInstrument: ReadonlyMap<string, readonly CoursConnu[]>,
  jusqua: CivilDate,
): Valorisation {
  const detail: ValeurLigne[] = []
  let total = 0
  let sansCours = 0
  let plusAncien: CivilDate | null = null

  for (const ligne of lignes) {
    const cours = coursValideA(coursParInstrument.get(ligne.instrument_id) ?? [], jusqua)
    if (cours === null) {
      sansCours += 1
      detail.push({ ...ligne, cours: null, valeur_cents: null })
      continue
    }
    const valeur = valeurLigne(ligne.quantite_millimes, cours.cours_cents)
    total += valeur
    if (plusAncien === null || cours.date < plusAncien) plusAncien = cours.date
    detail.push({ ...ligne, cours, valeur_cents: valeur })
  }

  return { lignes: detail, total_cents: cents(total), sansCours, coursLePlusAncien: plusAncien }
}
