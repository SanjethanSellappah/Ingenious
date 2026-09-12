/**
 * Projection de solde.
 *
 * Calculée **par compte**, jamais globalement : un solde global laisse l'épargne
 * masquer un découvert sur le courant, ce qui est exactement l'inverse du service
 * rendu.
 *
 * Trois règles portent tout le module :
 *
 * 1. **La certitude n'est pas uniforme dans le temps.** Tant qu'aucune occurrence
 *    estimée n'a été franchie, la projection ne dépend d'aucune estimation. Au-delà,
 *    elle est encadrée. Une courbe d'apparence homogène sur tout le mois ment sur
 *    ce qu'elle sait.
 * 2. **Les bornes sont signées.** La borne basse accumule toujours le montant le
 *    plus petit : pour une rentrée c'est la plus maigre, pour une dépense la plus
 *    grosse. Un seul calcul, donc pas de côté à confondre.
 * 3. **Une échéance déjà échue mais non confirmée n'entre nulle part.** L'application
 *    ne sait pas si elle est passée en banque ; l'ajouter serait inventer, l'ignorer
 *    en silence serait mentir. Elle est comptée à part, pour que l'écran la réclame.
 */
import { ajouterJours, intervalleDeJours, type CivilDate } from './civilDate'
import { cents, type Cents } from './money'

/** Une échéance prête à projeter : montant déjà signé et résolu. */
export type EcheanceProjetee = {
  /** Jour où l'argent bouge réellement — la date décalée, pas la théorique. */
  date: CivilDate
  /** Signé : négatif pour une sortie. */
  montant_cents: Cents
  /** Valeur la plus défavorable au solde. Égale au montant si celui-ci est certain. */
  borne_basse_cents: Cents
  /** Valeur la plus favorable au solde. */
  borne_haute_cents: Cents
  estime: boolean
  libelle?: string
  /** Renvoie à la récurrence d'origine, pour que l'écran sache quoi réclamer. */
  reference?: { subscription_id: string; date_theorique: CivilDate }
}

export type PointDeSerie = {
  date: CivilDate
  /** Trajectoire centrale : médiane pour les montants estimés. */
  solde_cents: Cents
  /** Trajectoire pessimiste, confondue avec la centrale avant la première estimation. */
  borne_basse_cents: Cents
  borne_haute_cents: Cents
  /** Vrai dès qu'une occurrence estimée a été franchie : au tracé, le trait passe en pointillé. */
  incertain: boolean
}

export type Projection = {
  serie: PointDeSerie[]
  /** Minimum de la trajectoire centrale, et le premier jour où il est atteint. */
  pointBas: { date: CivilDate; solde_cents: Cents }
  /** Minimum de la trajectoire pessimiste. C'est lui qui doit déclencher une alerte. */
  pointBasPessimiste: { date: CivilDate; solde_cents: Cents }
  /** Date de la première échéance estimée, ou `null` si la projection est entièrement certaine. */
  premiereEstimation: CivilDate | null
  /** De quoi le chiffre est composé — l'écran doit pouvoir le dire. */
  composition: {
    echeances: number
    echeancesEstimees: number
    /** Échéances dont le jour est passé sans confirmation : hors calcul, à réclamer. */
    echeancesEchues: EcheanceProjetee[]
  }
}

export type ParametresProjection = {
  /** Solde connu du compte au jour `debut`. */
  soldeActuel: Cents
  echeances: readonly EcheanceProjetee[]
  /** Premier jour de la série. Son solde est `soldeActuel` : rien ne s'y ajoute. */
  debut: CivilDate
  fin: CivilDate
}

/** Garde-fou : au-delà, c'est une erreur d'appel, pas un besoin. */
const JOURS_MAX = 3660

/**
 * Série jour par jour du solde d'un compte.
 *
 * Le premier point vaut `soldeActuel` : les échéances datées du jour même sont
 * déjà reflétées dans le solde connu, ou attendent une confirmation. Seules les
 * échéances **strictement postérieures** à `debut` déplacent la courbe.
 */
export function projeterSolde(parametres: ParametresProjection): Projection {
  const { soldeActuel, echeances, debut, fin } = parametres
  if (fin < debut) throw new RangeError(`Fin (${fin}) antérieure au début (${debut})`)
  const jours = intervalleDeJours(debut, fin)
  if (jours.length > JOURS_MAX) {
    throw new RangeError(`Projection de ${jours.length} jours demandée, maximum ${JOURS_MAX}`)
  }

  const aVenir: EcheanceProjetee[] = []
  const echues: EcheanceProjetee[] = []
  for (const echeance of echeances) {
    if (echeance.date <= debut) echues.push(echeance)
    else if (echeance.date <= fin) aVenir.push(echeance)
  }

  const parDate = new Map<CivilDate, EcheanceProjetee[]>()
  for (const echeance of aVenir) {
    const liste = parDate.get(echeance.date)
    if (liste) liste.push(echeance)
    else parDate.set(echeance.date, [echeance])
  }

  const premiereEstimation =
    aVenir
      .filter((e) => e.estime)
      .map((e) => e.date)
      .sort()[0] ?? null

  let central = soldeActuel as number
  let basse = soldeActuel as number
  let haute = soldeActuel as number
  let incertain = false

  const serie: PointDeSerie[] = []
  let pointBas = { date: debut, solde_cents: soldeActuel }
  let pointBasPessimiste = { date: debut, solde_cents: soldeActuel }

  for (const jour of jours) {
    for (const echeance of parDate.get(jour) ?? []) {
      central += echeance.montant_cents
      basse += echeance.borne_basse_cents
      haute += echeance.borne_haute_cents
      if (echeance.estime) incertain = true
    }
    const point: PointDeSerie = {
      date: jour,
      solde_cents: cents(central),
      borne_basse_cents: cents(basse),
      borne_haute_cents: cents(haute),
      incertain,
    }
    serie.push(point)
    // `<` strict : à valeur égale, on garde la première date, celle qui alerte le plus tôt.
    if (point.solde_cents < pointBas.solde_cents) {
      pointBas = { date: jour, solde_cents: point.solde_cents }
    }
    if (point.borne_basse_cents < pointBasPessimiste.solde_cents) {
      pointBasPessimiste = { date: jour, solde_cents: point.borne_basse_cents }
    }
  }

  return {
    serie,
    pointBas,
    pointBasPessimiste,
    premiereEstimation,
    composition: {
      echeances: aVenir.length,
      echeancesEstimees: aVenir.filter((e) => e.estime).length,
      echeancesEchues: echues,
    },
  }
}

/** Projette sur `nombreDeJours` à partir de `debut` incluse. */
export function projeterSurJours(
  parametres: Omit<ParametresProjection, 'fin'> & { nombreDeJours: number },
): Projection {
  const { nombreDeJours, ...reste } = parametres
  return projeterSolde({ ...reste, fin: ajouterJours(reste.debut, nombreDeJours) })
}

/** Premier jour où la trajectoire centrale passe sous un seuil, ou `null`. */
export function premierJourSous(projection: Projection, seuil: Cents): CivilDate | null {
  return projection.serie.find((point) => point.solde_cents < seuil)?.date ?? null
}

/** Premier jour où la trajectoire **pessimiste** passe sous un seuil. C'est le bon signal d'alerte. */
export function premierJourSousPessimiste(projection: Projection, seuil: Cents): CivilDate | null {
  return projection.serie.find((point) => point.borne_basse_cents < seuil)?.date ?? null
}
