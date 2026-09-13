/**
 * Le journal d'événements.
 *
 * C'est la source de vérité : **append-only**, jamais modifié, jamais supprimé
 * en place. Une correction est un nouvel événement, pas une réécriture — sans
 * quoi il devient impossible de savoir ce qu'on croyait savoir hier, et une
 * fusion entre deux appareils devient un arbitrage.
 *
 * Deux appareils fusionnent par simple **union sur `id`**. Il n'y a aucun
 * conflit possible, donc aucun code d'arbitrage à écrire : c'est la seule raison
 * pour laquelle cette application peut se synchroniser sans serveur.
 */
import { estDateCivile, type CivilDate } from '../core/civilDate'
import {
  booleen,
  chaine,
  entier,
  ErreurValidation,
  objet,
  optionnel,
  parmi,
  sansIndefinis,
  uuid,
} from './valider'

export const TYPES_EVENEMENT = [
  'account.created',
  'account.updated',
  'account.archived',
  'account.unarchived',
  'account.balance_set',
  'transaction.created',
  'transaction.updated',
  'transaction.deleted',
  'transfer.created',
  'transfer.updated',
  'transfer.deleted',
  'subscription.created',
  'subscription.updated',
  'subscription.price_changed',
  'subscription.ended',
  'label.created',
  'label.renamed',
  'label.budget_set',
  'label.archived',
  'occurrence.overridden',
  'occurrence.override_cleared',
  'snapshot.recorded',
  'settings.updated',
  // Phase 2, réservés maintenant pour ne pas renuméroter le format plus tard.
  'instrument.created',
  'instrument.updated',
  'instrument.quoted',
  'holding.created',
  'holding.updated',
] as const

export type TypeEvenement = (typeof TYPES_EVENEMENT)[number]

export type Evenement = {
  /** UUID v4. C'est la clé de fusion entre appareils. */
  id: string
  /** Instant d'écriture, epoch ms. Départage deux événements du même jour. */
  ts: number
  /** Identifiant d'appareil, pour le diagnostic. Jamais pour un arbitrage. */
  device: string
  type: TypeEvenement
  payload: Record<string, unknown>
}

/**
 * Une écriture demandée au journal.
 *
 * L'`id` est presque toujours absent : le dépôt en tire un au hasard, et deux
 * saisies ne peuvent pas se confondre. Il n'est fourni que lorsque l'événement
 * doit être **reconnaissable** — une ligne de relevé bancaire, qui doit porter
 * le même identifiant quel que soit l'appareil qui l'importe et le nombre de
 * fois qu'on l'importe. C'est ce qui fait qu'un réimport n'ajoute rien.
 */
export type EntreeJournal = {
  type: TypeEvenement
  payload: Record<string, unknown>
  /** UUID imposé. Un événement déjà présent sous cet `id` n'est pas réécrit. */
  id?: string
}

/** Enveloppe d'export. L'en-tête reste lisible même quand le contenu est chiffré. */
export const FORMAT_JOURNAL = 'ingenious.journal'
export const VERSION_JOURNAL = 1

export type JournalExporte = {
  format: typeof FORMAT_JOURNAL
  version: number
  chiffre: false
  genere_le: string | null
  appareil: string | null
  events: Evenement[]
}

// --- Validation ---------------------------------------------------------------

function dateCivileChamp(valeur: unknown, chemin: string): CivilDate {
  const texte = chaine(valeur, chemin)
  if (!estDateCivile(texte)) {
    throw new ErreurValidation(
      chemin,
      `date civile YYYY-MM-DD attendue, reçu ${JSON.stringify(texte)}`,
    )
  }
  return texte as CivilDate
}

const TYPES_COMPTE = ['courant', 'livret', 'pea', 'cto', 'av', 'or', 'autre'] as const
const GROUPES_COMPTE = ['bancaire', 'investissement'] as const
const MODES_COMPTE = ['saisi', 'calcule'] as const
const GENRES_INSTRUMENT = ['action', 'etf', 'or'] as const
const UNITES_INSTRUMENT = ['part', 'gramme', 'once'] as const
const ORIGINES = ['manuel', 'csv', 'recurrence', 'reconciliation'] as const
const SENS = ['depense', 'rentree'] as const
const MODES_MONTANT = ['fixe', 'estime'] as const
const FREQUENCES = ['mensuel', 'trimestriel', 'annuel', 'personnalise'] as const
const UNITES = ['mois', 'semaine', 'jour'] as const
const REGLES_WEEKEND = ['exact', 'jour_ouvre_suivant', 'jour_ouvre_precedent'] as const
const REGLES_MOIS_COURT = ['dernier_jour', 'ignorer'] as const
const STATUTS_OCCURRENCE = ['previsionnel', 'realise'] as const

/** Un validateur par type d'événement. Le type `Record` garantit qu'aucun n'est oublié. */
const VALIDATEURS: Record<
  TypeEvenement,
  (p: Record<string, unknown>, c: string) => Record<string, unknown>
> = {
  'account.created': (p, c) =>
    sansIndefinis({
      id: chaine(p.id, `${c}.id`),
      nom: chaine(p.nom, `${c}.nom`, { max: 120 }),
      type: parmi(p.type, `${c}.type`, TYPES_COMPTE),
      groupe: parmi(p.groupe, `${c}.groupe`, GROUPES_COMPTE),
      mode: parmi(p.mode, `${c}.mode`, MODES_COMPTE),
      masque: optionnel(p.masque, (v) => booleen(v, `${c}.masque`)),
    }),
  'account.updated': (p, c) =>
    sansIndefinis({
      id: chaine(p.id, `${c}.id`),
      nom: optionnel(p.nom, (v) => chaine(v, `${c}.nom`, { max: 120 })),
      type: optionnel(p.type, (v) => parmi(v, `${c}.type`, TYPES_COMPTE)),
      groupe: optionnel(p.groupe, (v) => parmi(v, `${c}.groupe`, GROUPES_COMPTE)),
      mode: optionnel(p.mode, (v) => parmi(v, `${c}.mode`, MODES_COMPTE)),
      masque: optionnel(p.masque, (v) => booleen(v, `${c}.masque`)),
    }),
  'account.archived': (p, c) => ({
    id: chaine(p.id, `${c}.id`),
    date: dateCivileChamp(p.date, `${c}.date`),
  }),
  'account.unarchived': (p, c) => ({ id: chaine(p.id, `${c}.id`) }),
  'account.balance_set': (p, c) => ({
    account_id: chaine(p.account_id, `${c}.account_id`),
    date: dateCivileChamp(p.date, `${c}.date`),
    solde_cents: entier(p.solde_cents, `${c}.solde_cents`),
  }),

  'transaction.created': (p, c) =>
    sansIndefinis({
      id: chaine(p.id, `${c}.id`),
      account_id: chaine(p.account_id, `${c}.account_id`),
      date: dateCivileChamp(p.date, `${c}.date`),
      montant_cents: entier(p.montant_cents, `${c}.montant_cents`),
      origine: parmi(p.origine, `${c}.origine`, ORIGINES),
      label_id: optionnel(p.label_id, (v) => chaine(v, `${c}.label_id`)),
      note: optionnel(p.note, (v) => chaine(v, `${c}.note`, { min: 0, max: 500 })),
      subscription_id: optionnel(p.subscription_id, (v) => chaine(v, `${c}.subscription_id`)),
    }),
  'transaction.updated': (p, c) =>
    sansIndefinis({
      id: chaine(p.id, `${c}.id`),
      date: optionnel(p.date, (v) => dateCivileChamp(v, `${c}.date`)),
      montant_cents: optionnel(p.montant_cents, (v) => entier(v, `${c}.montant_cents`)),
      label_id: optionnel(p.label_id, (v) => chaine(v, `${c}.label_id`)),
      note: optionnel(p.note, (v) => chaine(v, `${c}.note`, { min: 0, max: 500 })),
    }),
  'transaction.deleted': (p, c) => ({ id: chaine(p.id, `${c}.id`) }),

  'transfer.created': (p, c) => {
    const depuis = chaine(p.from_account_id, `${c}.from_account_id`)
    const vers = chaine(p.to_account_id, `${c}.to_account_id`)
    // Un virement d'un compte vers lui-même n'a pas de sens, et le pliage n'en
    // produirait qu'un seul mouvement : l'argent disparaîtrait sans trace.
    if (depuis === vers) {
      throw new ErreurValidation(
        `${c}.to_account_id`,
        'un virement ne peut pas viser son compte de départ',
      )
    }
    return sansIndefinis({
      id: chaine(p.id, `${c}.id`),
      date: dateCivileChamp(p.date, `${c}.date`),
      from_account_id: depuis,
      to_account_id: vers,
      montant_cents: entier(p.montant_cents, `${c}.montant_cents`, { min: 1 }),
      note: optionnel(p.note, (v) => chaine(v, `${c}.note`, { min: 0, max: 500 })),
    })
  },
  'transfer.updated': (p, c) =>
    sansIndefinis({
      id: chaine(p.id, `${c}.id`),
      date: optionnel(p.date, (v) => dateCivileChamp(v, `${c}.date`)),
      montant_cents: optionnel(p.montant_cents, (v) => entier(v, `${c}.montant_cents`, { min: 1 })),
      note: optionnel(p.note, (v) => chaine(v, `${c}.note`, { min: 0, max: 500 })),
    }),
  'transfer.deleted': (p, c) => ({ id: chaine(p.id, `${c}.id`) }),

  'subscription.created': (p, c) => validerAbonnement(p, c, true),
  'subscription.updated': (p, c) => validerAbonnement(p, c, false),
  'subscription.price_changed': (p, c) => ({
    subscription_id: chaine(p.subscription_id, `${c}.subscription_id`),
    montant_cents: entier(p.montant_cents, `${c}.montant_cents`),
    valide_du: dateCivileChamp(p.valide_du, `${c}.valide_du`),
  }),
  'subscription.ended': (p, c) => ({
    subscription_id: chaine(p.subscription_id, `${c}.subscription_id`),
    date_fin: dateCivileChamp(p.date_fin, `${c}.date_fin`),
  }),

  'label.created': (p, c) => ({
    id: chaine(p.id, `${c}.id`),
    nom: chaine(p.nom, `${c}.nom`, { max: 80 }),
    couleur: chaine(p.couleur, `${c}.couleur`, { max: 32 }),
  }),
  'label.renamed': (p, c) => ({
    id: chaine(p.id, `${c}.id`),
    nom: chaine(p.nom, `${c}.nom`, { max: 80 }),
  }),
  'label.budget_set': (p, c) =>
    sansIndefinis({
      id: chaine(p.id, `${c}.id`),
      budget_mensuel_cents: optionnel(p.budget_mensuel_cents, (v) =>
        entier(v, `${c}.budget_mensuel_cents`, { min: 0 }),
      ),
    }),
  'label.archived': (p, c) => ({
    id: chaine(p.id, `${c}.id`),
    date: dateCivileChamp(p.date, `${c}.date`),
  }),

  'occurrence.overridden': (p, c) =>
    sansIndefinis({
      subscription_id: chaine(p.subscription_id, `${c}.subscription_id`),
      date_theorique: dateCivileChamp(p.date_theorique, `${c}.date_theorique`),
      montant_cents: entier(p.montant_cents, `${c}.montant_cents`),
      statut: parmi(p.statut, `${c}.statut`, STATUTS_OCCURRENCE),
      exclu_de_estimation: optionnel(p.exclu_de_estimation, (v) =>
        booleen(v, `${c}.exclu_de_estimation`),
      ),
    }),
  'occurrence.override_cleared': (p, c) => ({
    subscription_id: chaine(p.subscription_id, `${c}.subscription_id`),
    date_theorique: dateCivileChamp(p.date_theorique, `${c}.date_theorique`),
  }),

  'snapshot.recorded': (p, c) => ({
    account_id: chaine(p.account_id, `${c}.account_id`),
    date: dateCivileChamp(p.date, `${c}.date`),
    valeur_cents: entier(p.valeur_cents, `${c}.valeur_cents`),
  }),

  'settings.updated': (p, c) => {
    const resultat = sansIndefinis({
      reserve_cents: optionnel(p.reserve_cents, (v) => entier(v, `${c}.reserve_cents`, { min: 0 })),
      compte_courant_id: optionnel(p.compte_courant_id, (v) => chaine(v, `${c}.compte_courant_id`)),
    })
    // Un événement qui ne change rien n'a pas à être écrit : il alourdit le
    // journal sans rien apprendre, et masque les vraies modifications à la relecture.
    if (Object.keys(resultat).length === 0) {
      throw new ErreurValidation(c, 'aucun réglage à modifier')
    }
    return resultat
  },

  // Phase 2 : seul l'identifiant est vérifié. Le reste de la charge utile passe
  // tel quel, comme pour tout champ inconnu — une version qui ne sait pas lire
  // un événement doit quand même savoir le transporter sans l'abîmer.
  'instrument.created': (p, c) =>
    sansIndefinis({
      id: chaine(p.id, `${c}.id`),
      symbole: chaine(p.symbole, `${c}.symbole`, { max: 32 }),
      nom: chaine(p.nom, `${c}.nom`, { max: 120 }),
      genre: parmi(p.genre, `${c}.genre`, GENRES_INSTRUMENT),
      // L'unité de l'or n'est pas une part : on en détient des grammes ou des
      // onces, et confondre les deux fait un facteur trente et un.
      unite: optionnel(p.unite, (v) => parmi(v, `${c}.unite`, UNITES_INSTRUMENT)),
    }),
  'instrument.updated': (p, c) =>
    sansIndefinis({
      id: chaine(p.id, `${c}.id`),
      symbole: optionnel(p.symbole, (v) => chaine(v, `${c}.symbole`, { max: 32 })),
      nom: optionnel(p.nom, (v) => chaine(v, `${c}.nom`, { max: 120 })),
      genre: optionnel(p.genre, (v) => parmi(v, `${c}.genre`, GENRES_INSTRUMENT)),
      unite: optionnel(p.unite, (v) => parmi(v, `${c}.unite`, UNITES_INSTRUMENT)),
    }),
  /**
   * Un cours relevé, à une date.
   *
   * Un cours est daté comme un tarif d'abonnement : sans la date, on ne saurait
   * pas si le chiffre affiché date d'aujourd'hui ou de six mois, et une
   * valorisation dont on ignore l'âge ne vaut rien.
   */
  'instrument.quoted': (p, c) =>
    sansIndefinis({
      instrument_id: chaine(p.instrument_id, `${c}.instrument_id`),
      date: dateCivileChamp(p.date, `${c}.date`),
      cours_cents: entier(p.cours_cents, `${c}.cours_cents`, { min: 0 }),
      source: optionnel(p.source, (v) => chaine(v, `${c}.source`, { max: 64 })),
    }),
  'holding.created': (p, c) => ({
    id: chaine(p.id, `${c}.id`),
    account_id: chaine(p.account_id, `${c}.account_id`),
    instrument_id: chaine(p.instrument_id, `${c}.instrument_id`),
    // Les quantités se comptent en millièmes : on détient 12,345 parts d'un ETF
    // ou 3,5 g d'or, et un entier obligerait à arrondir la quantité elle-même.
    quantite_millimes: entier(p.quantite_millimes, `${c}.quantite_millimes`, { min: 0 }),
  }),
  'holding.updated': (p, c) =>
    sansIndefinis({
      id: chaine(p.id, `${c}.id`),
      quantite_millimes: optionnel(p.quantite_millimes, (v) =>
        entier(v, `${c}.quantite_millimes`, { min: 0 }),
      ),
      supprime: optionnel(p.supprime, (v) => booleen(v, `${c}.supprime`)),
    }),
}

function validerAbonnement(
  p: Record<string, unknown>,
  c: string,
  complet: boolean,
): Record<string, unknown> {
  const resultat: Record<string, unknown> = { id: chaine(p.id, `${c}.id`) }
  const lire = <T>(cle: string, lecteur: (v: unknown) => T, requis: boolean): void => {
    const brut = p[cle]
    if (brut === undefined || brut === null) {
      if (requis && complet) throw new ErreurValidation(`${c}.${cle}`, 'champ obligatoire manquant')
      return
    }
    resultat[cle] = lecteur(brut)
  }

  lire('nom', (v) => chaine(v, `${c}.nom`, { max: 120 }), true)
  lire('account_id', (v) => chaine(v, `${c}.account_id`), true)
  lire('label_id', (v) => chaine(v, `${c}.label_id`), false)
  lire('sens', (v) => parmi(v, `${c}.sens`, SENS), true)
  lire('montant_mode', (v) => parmi(v, `${c}.montant_mode`, MODES_MONTANT), true)
  lire(
    'estimation_fenetre',
    (v) => entier(v, `${c}.estimation_fenetre`, { min: 1, max: 60 }),
    false,
  )
  lire('frequence', (v) => parmi(v, `${c}.frequence`, FREQUENCES), true)
  lire('unite_intervalle', (v) => parmi(v, `${c}.unite_intervalle`, UNITES), false)
  lire('intervalle', (v) => entier(v, `${c}.intervalle`, { min: 1, max: 120 }), false)
  lire('jour_du_mois', (v) => entier(v, `${c}.jour_du_mois`, { min: 1, max: 31 }), false)
  lire('regle_weekend', (v) => parmi(v, `${c}.regle_weekend`, REGLES_WEEKEND), false)
  lire('regle_mois_court', (v) => parmi(v, `${c}.regle_mois_court`, REGLES_MOIS_COURT), false)
  lire('date_debut', (v) => dateCivileChamp(v, `${c}.date_debut`), true)
  lire('date_fin', (v) => dateCivileChamp(v, `${c}.date_fin`), false)
  lire('rappel_jours', (v) => entier(v, `${c}.rappel_jours`, { min: 0, max: 90 }), false)
  lire('actif', (v) => booleen(v, `${c}.actif`), false)
  return resultat
}

/**
 * Valide un événement.
 *
 * Les champs connus sont vérifiés ; les champs **inconnus sont conservés tels
 * quels**. C'est délibéré : un journal écrit par une version plus récente, relu
 * puis réexporté par une version plus ancienne, ne doit rien perdre en chemin.
 * Un journal append-only qui rogne ce qu'il ne comprend pas n'est plus une
 * source de vérité, c'est une passoire — et la perte serait silencieuse.
 *
 * La validation protège donc le pliage, elle ne mutile pas le journal.
 */
export function validerEvenement(valeur: unknown, chemin = 'event'): Evenement {
  const brut = objet(valeur, chemin)
  const type = parmi(brut.type, `${chemin}.type`, TYPES_EVENEMENT)
  const payload = objet(brut.payload, `${chemin}.payload`)
  return {
    id: uuid(brut.id, `${chemin}.id`),
    ts: entier(brut.ts, `${chemin}.ts`, { min: 0 }),
    device: chaine(brut.device, `${chemin}.device`, { max: 64 }),
    type,
    payload: { ...payload, ...VALIDATEURS[type](payload, `${chemin}.payload`) },
  }
}

export type ResultatLecture = {
  evenements: Evenement[]
  /** Événements refusés, avec la raison. Ils sont signalés, jamais avalés. */
  rejets: { index: number; raison: string }[]
}

/**
 * Valide une liste d'événements sans s'arrêter au premier refus.
 *
 * Un seul événement corrompu dans un export de trois mille ne doit pas rendre
 * l'import impossible : on reprend tout ce qui est lisible, et on dit
 * précisément ce qui ne l'était pas.
 */
export function validerEvenements(valeurs: readonly unknown[]): ResultatLecture {
  const evenements: Evenement[] = []
  const rejets: { index: number; raison: string }[] = []
  valeurs.forEach((valeur, index) => {
    try {
      evenements.push(validerEvenement(valeur, `event[${index}]`))
    } catch (erreur) {
      rejets.push({ index, raison: erreur instanceof Error ? erreur.message : String(erreur) })
    }
  })
  return { evenements, rejets }
}

/** Trie le journal : par instant, puis par `id` pour départager deux instants égaux. */
export function trierJournal(evenements: readonly Evenement[]): Evenement[] {
  return [...evenements].sort((a, b) =>
    a.ts !== b.ts ? a.ts - b.ts : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )
}

/**
 * Fusionne deux journaux par union sur `id`.
 *
 * Aucun arbitrage : un événement n'est jamais modifié, donc deux exemplaires du
 * même `id` sont le même événement. C'est ce qui rend la synchronisation
 * multi-appareils triviale — et c'est pour ça que le journal est append-only.
 */
export function fusionnerJournaux(...journaux: readonly (readonly Evenement[])[]): Evenement[] {
  const parId = new Map<string, Evenement>()
  for (const journal of journaux) {
    for (const evenement of journal) {
      if (!parId.has(evenement.id)) parId.set(evenement.id, evenement)
    }
  }
  return trierJournal([...parId.values()])
}
