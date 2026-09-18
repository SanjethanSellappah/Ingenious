/**
 * Lectures dérivées de l'état.
 *
 * Deux notions portent tout le reste :
 *
 * - **Le mouvement unifié** — transactions, virements et occurrences réalisées
 *   vus sous la même forme. Les virements y portent leur nature et sortent par
 *   construction des totaux de dépenses : c'est l'erreur classique du
 *   multi-comptes, et la seule façon sûre de ne pas la commettre est de ne
 *   jamais pouvoir les confondre.
 * - **L'ancre de solde** — le dernier relevé saisi, auquel s'ajoutent les
 *   mouvements postérieurs. Le départage à la journée se fait par instant
 *   d'événement, sans quoi une dépense saisie après une réconciliation du même
 *   jour disparaîtrait du calcul, en silence.
 */
import { type CivilDate } from '../core/civilDate'
import { dateAffichee } from '../core/recurrence'
import { cents, negatif, type Cents } from '../core/money'
import { valoriser, type Valorisation } from '../core/valorisation'
import type { Etat, Exception, Label, Ligne, Releve, Transaction } from './etat'
import { cleException, normaliserNom } from './etat'
import { resumerLibelleBancaire } from './libelleBancaire'

export type NatureMouvement = 'transaction' | 'virement' | 'occurrence'

export type Mouvement = {
  account_id: string
  date: CivilDate
  /** Signé : négatif = sortie du compte. */
  montant_cents: Cents
  nature: NatureMouvement
  label_id?: string
  /** Instant de l'événement d'origine, pour départager une même journée. */
  ts: number
  source_id: string
  /** Ce qu'on affiche : résumé quand la banque a écrit un pavé technique. */
  libelle?: string
  /**
   * Le libellé tel que la banque l'a écrit, quand il diffère.
   *
   * Il n'est pas affiché en liste — c'est tout l'objet du résumé — mais l'écran
   * du mouvement le montre. Ce qui vient d'un relevé doit rester consultable
   * mot pour mot : c'est la pièce justificative, et un résumé n'en est pas une.
   */
  libelle_complet?: string
}

/**
 * Le libellé d'une transaction, résumé s'il vient d'un relevé.
 *
 * Le résumé ne s'applique **qu'aux lignes importées**. Une note écrite à la
 * main est déjà celle qu'on voulait lire : la retoucher — ne serait-ce qu'en
 * changeant sa casse — serait corriger quelqu'un chez lui.
 */
function libellesDe(transaction: Transaction): { libelle?: string; libelle_complet?: string } {
  const note = transaction.note
  if (note === undefined || note.trim() === '') return {}
  if (transaction.origine !== 'csv') return { libelle: note }
  const resume = resumerLibelleBancaire(note)
  return resume === note ? { libelle: note } : { libelle: resume, libelle_complet: note }
}

/**
 * Tous les mouvements d'un compte, dans l'ordre où l'argent bouge.
 *
 * Un virement produit deux mouvements, un par compte, de signes opposés — c'est
 * une seule entité, vue de deux côtés. Il n'est jamais dédoublé en deux
 * transactions : sinon rien ne le distinguerait d'une dépense.
 */
export function mouvementsDuCompte(etat: Etat, account_id: string): Mouvement[] {
  const mouvements: Mouvement[] = []

  for (const transaction of etat.transactions.values()) {
    if (transaction.account_id !== account_id) continue
    mouvements.push({
      account_id,
      date: transaction.date,
      montant_cents: transaction.montant_cents,
      nature: 'transaction',
      ts: transaction.ts,
      source_id: transaction.id,
      ...(transaction.label_id !== undefined ? { label_id: transaction.label_id } : {}),
      ...libellesDe(transaction),
    })
  }

  for (const virement of etat.virements.values()) {
    const sortant = virement.from_account_id === account_id
    const entrant = virement.to_account_id === account_id
    if (!sortant && !entrant) continue
    mouvements.push({
      account_id,
      date: virement.date,
      montant_cents: sortant ? negatif(virement.montant_cents) : virement.montant_cents,
      nature: 'virement',
      ts: virement.ts,
      source_id: virement.id,
      ...(virement.note !== undefined ? { libelle: virement.note } : {}),
    })
  }

  // Une occurrence confirmée **est** un mouvement : c'est ce que promet l'écran
  // « à confirmer », et c'est ce qui fait que confirmer recale le solde. Elle
  // apporte aussi le label de son abonnement, de sorte qu'un prélèvement
  // récurrent compte dans son poste de dépense sans double saisie.
  for (const exception of etat.exceptions.values()) {
    if (exception.statut !== 'realise') continue
    const abonnement = etat.abonnements.get(exception.subscription_id)
    if (!abonnement || abonnement.account_id !== account_id) continue
    const absolu = Math.abs(exception.montant_cents)
    mouvements.push({
      account_id,
      // La date d'affichage, pas la théorique : c'est le jour où l'argent bouge.
      date: dateAffichee(exception.date_theorique, abonnement.regle.regle_weekend),
      montant_cents: cents(abonnement.sens === 'depense' ? -absolu : absolu),
      nature: 'occurrence',
      ts: exception.ts,
      source_id: cleException(exception.subscription_id, exception.date_theorique),
      libelle: abonnement.nom,
      ...(abonnement.label_id !== undefined ? { label_id: abonnement.label_id } : {}),
    })
  }

  return trierMouvements(mouvements)
}

function trierMouvements(mouvements: Mouvement[]): Mouvement[] {
  return mouvements.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.ts - b.ts))
}

/** Dernier relevé d'un compte à une date donnée. C'est l'ancre du calcul de solde. */
export function ancreDuCompte(etat: Etat, account_id: string, jusqua?: CivilDate): Releve | null {
  let ancre: Releve | null = null
  for (const releve of etat.releves) {
    if (releve.account_id !== account_id) continue
    if (jusqua !== undefined && releve.date > jusqua) continue
    if (
      ancre === null ||
      releve.date > ancre.date ||
      (releve.date === ancre.date && releve.ts > ancre.ts)
    ) {
      ancre = releve
    }
  }
  return ancre
}

/**
 * Solde d'un compte à une date donnée.
 *
 * ```
 * solde = ancre
 *       + Σ mouvements postérieurs à l'ancre et antérieurs ou égaux à J
 * ```
 *
 * « Postérieur à l'ancre » se lit sur la date **et** sur l'instant : un
 * mouvement du même jour que l'ancre ne compte que s'il a été écrit après elle.
 * C'est ce qui fait tenir la réconciliation — l'écart est posé avant la nouvelle
 * ancre, donc l'ancre le contient déjà et il n'est pas compté deux fois — et ce
 * qui permet de saisir une dépense après avoir réconcilié le même jour.
 */
export function soldeDuCompte(etat: Etat, account_id: string, jusqua: CivilDate): Cents {
  // Un compte calculé n'a pas de solde qu'on relèverait : il vaut ses lignes au
  // cours du jour. Y ajouter des mouvements mélangerait deux façons de compter.
  const compte = etat.comptes.get(account_id)
  if (compte?.mode === 'calcule') return valorisationDuCompte(etat, account_id, jusqua).total_cents

  const ancre = ancreDuCompte(etat, account_id, jusqua)
  let total = ancre?.solde_cents ?? 0
  for (const mouvement of mouvementsDuCompte(etat, account_id)) {
    if (mouvement.date > jusqua) continue
    if (ancre !== null) {
      if (mouvement.date < ancre.date) continue
      if (mouvement.date === ancre.date && mouvement.ts <= ancre.ts) continue
    }
    total += mouvement.montant_cents
  }
  return cents(total)
}

/** Lignes détenues sur un compte, celles qu'on a retirées exclues. */
export function lignesDuCompte(etat: Etat, account_id: string): Ligne[] {
  return [...etat.lignes.values()].filter(
    (ligne) => ligne.account_id === account_id && ligne.supprime !== true,
  )
}

/**
 * Valeur d'un compte calculé, et ce qu'on sait de sa fraîcheur.
 *
 * La date du cours le plus ancien remonte avec le total : une valorisation dont
 * on ignore l'âge n'apprend rien, et « 4 300 € » ne veut pas dire la même chose
 * selon qu'il date d'hier ou de mars.
 */
export function valorisationDuCompte(
  etat: Etat,
  account_id: string,
  jusqua: CivilDate,
): Valorisation {
  const coursParInstrument = new Map(
    [...etat.instruments.values()].map((instrument) => [instrument.id, instrument.cours]),
  )
  return valoriser(lignesDuCompte(etat, account_id), coursParInstrument, jusqua)
}

/** Patrimoine : somme des soldes, comptes archivés exclus. */
export function patrimoine(
  etat: Etat,
  jusqua: CivilDate,
): { total: Cents; parGroupe: Map<string, Cents> } {
  const parGroupe = new Map<string, Cents>()
  let total = 0
  for (const compte of etat.comptes.values()) {
    if (compte.archived_at !== undefined && compte.archived_at <= jusqua) continue
    const solde = soldeDuCompte(etat, compte.id, jusqua)
    total += solde
    parGroupe.set(compte.groupe, cents((parGroupe.get(compte.groupe) ?? 0) + solde))
  }
  return { total: cents(total), parGroupe }
}

export type TotalLabel = {
  label: Label | null
  total_cents: Cents
  nombre: number
  budget_mensuel_cents?: Cents
  /** Part du budget consommée, `null` si aucun budget n'est fixé. */
  partBudget: number | null
}

/**
 * Dépenses du mois par label.
 *
 * Les virements en sont exclus par leur nature, et les rentrées par leur signe :
 * un total de dépenses qui compte un virement vers le livret fait croire qu'on a
 * dépensé une épargne.
 */
export function depensesParLabel(etat: Etat, mois: string): TotalLabel[] {
  const totaux = new Map<string, { total: number; nombre: number }>()
  for (const compte of etat.comptes.values()) {
    for (const mouvement of mouvementsDuCompte(etat, compte.id)) {
      if (mouvement.nature === 'virement') continue
      if (mouvement.montant_cents >= 0) continue
      if (!mouvement.date.startsWith(mois)) continue
      const cle = mouvement.label_id ?? ''
      const courant = totaux.get(cle) ?? { total: 0, nombre: 0 }
      courant.total += negatif(mouvement.montant_cents)
      courant.nombre += 1
      totaux.set(cle, courant)
    }
  }

  const lignes: TotalLabel[] = []
  for (const [cle, { total, nombre }] of totaux) {
    const label = cle === '' ? null : (etat.labels.get(cle) ?? null)
    const budget = label?.budget_mensuel_cents
    lignes.push({
      label,
      total_cents: cents(total),
      nombre,
      ...(budget !== undefined ? { budget_mensuel_cents: budget } : {}),
      partBudget: budget !== undefined && budget > 0 ? total / budget : null,
    })
  }
  return lignes.sort((a, b) => b.total_cents - a.total_cents)
}

/** Exception enregistrée pour une occurrence, ou `undefined`. */
export function exceptionDe(
  etat: Etat,
  subscription_id: string,
  date_theorique: CivilDate,
): Exception | undefined {
  return etat.exceptions.get(cleException(subscription_id, date_theorique))
}

export type OccurrenceRealiseeVue = {
  date_theorique: CivilDate
  montant_cents: Cents
  exclu_de_estimation?: boolean
}

/** Occurrences réalisées d'un abonnement, pour alimenter l'estimation. */
export function realiseesDe(etat: Etat, subscription_id: string): OccurrenceRealiseeVue[] {
  return [...etat.exceptions.values()]
    .filter((e) => e.subscription_id === subscription_id && e.statut === 'realise')
    .map((e) => ({
      date_theorique: e.date_theorique,
      montant_cents: e.montant_cents,
      ...(e.exclu_de_estimation !== undefined
        ? { exclu_de_estimation: e.exclu_de_estimation }
        : {}),
    }))
}

/**
 * Le compte du reste à vivre, tel qu'il faut le lire.
 *
 * Le réglage explicite prime toujours : le reste à vivre est une promesse sur un
 * compte précis, et deviner à la place de l'utilisateur donnerait un chiffre
 * juste sur le mauvais compte.
 *
 * Mais quand il n'existe qu'un seul compte bancaire ouvert, il n'y a rien à
 * deviner. Demander de choisir entre une seule chose n'est pas une question,
 * c'est un obstacle — et il tombe précisément après une restauration, quand
 * l'événement de réglage manque au journal importé.
 *
 * Au-delà d'un candidat, on se tait et on laisse l'écran poser la question.
 */
export function compteCourantEffectif(etat: Etat): string | undefined {
  const designe = etat.reglages.compte_courant_id
  if (designe !== undefined && etat.comptes.has(designe)) return designe

  const candidats = [...etat.comptes.values()].filter(
    (compte) => compte.archived_at === undefined && compte.groupe === 'bancaire',
  )
  return candidats.length === 1 ? candidats[0]!.id : undefined
}

/** Cherche un label par son nom normalisé — la garantie d'unicité. */
export function labelParNom(etat: Etat, nom: string): Label | null {
  const recherche = normaliserNom(nom)
  for (const label of etat.labels.values()) {
    if (label.nom_normalise === recherche) return label
  }
  return null
}
