/**
 * Dépôt du journal.
 *
 * Toutes les écritures passent par `ajouter`. Rien d'autre ne touche la base :
 * c'est ce qui garantit qu'aucun chemin n'écrit un événement non validé, et donc
 * qu'aucun import ne peut faire planter le pliage.
 *
 * **L'export est le seul filet.** Sans serveur, un téléphone cassé égale tout
 * perdu. L'export est donc en clair : il doit rester lisible et réimportable
 * dans dix ans avec n'importe quel outil, pas seulement avec cette application.
 */
import { horodatageISO, maintenant } from '../core/clock'
import {
  FORMAT_JOURNAL,
  fusionnerJournaux,
  trierJournal,
  validerEvenement,
  validerEvenements,
  VERSION_JOURNAL,
  type Evenement,
  type JournalExporte,
  type TypeEvenement,
} from '../domain/events'
import { objet, chaine, entier, tableau, ErreurValidation } from '../domain/valider'
import { chiffreurIdentite, estScelle, type Chiffreur } from './crypto'
import { CLE_APPAREIL, ouvrirBase, type BaseIngenious } from './db'

export type Depot = {
  /** Écrit un événement neuf dans le journal. */
  ajouter: (type: TypeEvenement, payload: Record<string, unknown>) => Promise<Evenement>
  /** Écrit plusieurs événements d'un coup, dans l'ordre donné. */
  ajouterPlusieurs: (
    entrees: readonly { type: TypeEvenement; payload: Record<string, unknown> }[],
  ) => Promise<Evenement[]>
  /** Relit tout le journal, trié, avec la liste de ce qui n'a pas pu être relu. */
  chargerTout: () => Promise<{
    evenements: Evenement[]
    rejets: { index: number; raison: string }[]
  }>
  exporter: () => Promise<JournalExporte>
  exporterTexte: () => Promise<string>
  importer: (texte: string) => Promise<ResultatImport>
  appareil: string
  chiffreur: Chiffreur
  fermer: () => void
}

export type ResultatImport = {
  /** Événements réellement ajoutés — ceux qu'on avait déjà ne comptent pas. */
  ajoutes: number
  /** Événements déjà présents, reconnus par leur `id`. */
  deja: number
  rejets: { index: number; raison: string }[]
}

/** Identifiant d'appareil : pour le diagnostic, jamais pour arbitrer une fusion. */
async function identifiantAppareil(base: BaseIngenious): Promise<string> {
  const existant = await base.meta.get(CLE_APPAREIL)
  if (typeof existant?.valeur === 'string') return existant.valeur
  const nouveau = crypto.randomUUID().slice(0, 8)
  await base.meta.put({ cle: CLE_APPAREIL, valeur: nouveau })
  return nouveau
}

export async function ouvrirDepot(
  options: {
    base?: BaseIngenious
    chiffreur?: Chiffreur
    nomBase?: string
  } = {},
): Promise<Depot> {
  const base = options.base ?? ouvrirBase(options.nomBase)
  const chiffreur = options.chiffreur ?? chiffreurIdentite()
  const appareil = await identifiantAppareil(base)

  async function ecrire(evenements: readonly Evenement[]): Promise<void> {
    const enregistrements = await Promise.all(
      evenements.map(async (evenement) => ({
        id: evenement.id,
        donnees: await chiffreur.chiffrer(evenement),
      })),
    )
    await base.events.bulkPut(enregistrements)
  }

  async function ajouterPlusieurs(
    entrees: readonly { type: TypeEvenement; payload: Record<string, unknown> }[],
  ): Promise<Evenement[]> {
    const instant = maintenant()
    const evenements = entrees.map((entree, rang) =>
      // Le rang décale l'instant d'une milliseconde : deux événements écrits dans
      // la même passe doivent rester ordonnables entre eux, et la réconciliation
      // en dépend — l'écart doit se poser avant la nouvelle ancre de solde.
      validerEvenement({
        id: crypto.randomUUID(),
        ts: instant + rang,
        device: appareil,
        type: entree.type,
        payload: entree.payload,
      }),
    )
    await ecrire(evenements)
    return evenements
  }

  async function chargerTout(): Promise<{
    evenements: Evenement[]
    rejets: { index: number; raison: string }[]
  }> {
    const enregistrements = await base.events.toArray()
    const clairs: unknown[] = []
    const rejets: { index: number; raison: string }[] = []
    for (const [index, enregistrement] of enregistrements.entries()) {
      try {
        clairs.push(await chiffreur.dechiffrer(enregistrement.donnees))
      } catch (erreur) {
        rejets.push({
          index,
          raison: `${enregistrement.id} illisible : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
        })
      }
    }
    const lecture = validerEvenements(clairs)
    return { evenements: trierJournal(lecture.evenements), rejets: [...rejets, ...lecture.rejets] }
  }

  async function exporter(): Promise<JournalExporte> {
    const { evenements } = await chargerTout()
    return {
      format: FORMAT_JOURNAL,
      version: VERSION_JOURNAL,
      chiffre: false,
      genere_le: horodatageISO(),
      appareil,
      events: evenements,
    }
  }

  async function importer(texte: string): Promise<ResultatImport> {
    const journal = lireJournalExporte(texte)
    const lecture = validerEvenements(journal.events)
    const { evenements: existants } = await chargerTout()
    const connus = new Set(existants.map((e) => e.id))
    // Union sur `id` : un événement n'est jamais modifié, donc deux exemplaires
    // du même identifiant sont le même événement. Jamais d'écrasement.
    const nouveaux = fusionnerJournaux(lecture.evenements).filter((e) => !connus.has(e.id))
    await ecrire(nouveaux)
    return {
      ajoutes: nouveaux.length,
      deja: lecture.evenements.length - nouveaux.length,
      rejets: lecture.rejets,
    }
  }

  return {
    ajouter: async (type, payload) => (await ajouterPlusieurs([{ type, payload }]))[0]!,
    ajouterPlusieurs,
    chargerTout,
    exporter,
    exporterTexte: async () => JSON.stringify(await exporter(), null, 2),
    importer,
    appareil,
    chiffreur,
    fermer: () => base.close(),
  }
}

/**
 * Compte les enregistrements qui ne sont pas au format d'un chiffreur.
 *
 * Sans aucune opération cryptographique : seule la **forme** est regardée. C'est
 * ce qui permet de poser la question à chaque ouverture — déchiffrer tout le
 * journal pour savoir s'il faut le rechiffrer doublerait le temps d'ouverture,
 * tous les jours, pour un cas qui ne se produit presque jamais.
 */
export async function compterHorsFormat(
  base: BaseIngenious,
  chiffreur: Chiffreur,
): Promise<number> {
  let hors = 0
  for (const enregistrement of await base.events.toArray()) {
    if (estScelle(enregistrement.donnees) !== chiffreur.actif) hors += 1
  }
  return hors
}

/**
 * Rechiffre tout le journal d'un chiffreur vers un autre.
 *
 * **Reprenable, et c'est indispensable.** Rechiffrer quinze ans de journal prend
 * une dizaine de secondes sur une machine de bureau, davantage sur un téléphone ;
 * l'application peut être fermée entre-temps. L'opération saute donc ce qui est
 * déjà au format d'arrivée, de sorte que la relancer termine le travail au lieu
 * de l'abîmer.
 *
 * Indispensable au moment où l'utilisateur configure un code après avoir déjà
 * saisi des données : sans cette opération, les enregistrements écrits en clair
 * seraient rejetés à la relecture et **toutes les données existantes
 * deviendraient illisibles** — une perte totale et silencieuse, provoquée par un
 * geste censé protéger.
 *
 * L'écriture se fait par lots pour ne pas garder tout le journal déchiffré en
 * mémoire deux fois, et chaque enregistrement est relu avant d'être réécrit :
 * un enregistrement illisible est signalé, jamais remplacé par du vide.
 */
export async function rechiffrerJournal(
  base: BaseIngenious,
  ancien: Chiffreur,
  nouveau: Chiffreur,
  tailleLot = 200,
): Promise<{
  rechiffres: number
  deja: number
  rejets: { index: number; raison: string }[]
}> {
  const enregistrements = await base.events.toArray()
  const rejets: { index: number; raison: string }[] = []
  let rechiffres = 0
  let deja = 0

  for (let debut = 0; debut < enregistrements.length; debut += tailleLot) {
    const lot = enregistrements.slice(debut, debut + tailleLot)
    const aEcrire: { id: string; donnees: unknown }[] = []
    for (const [rang, enregistrement] of lot.entries()) {
      // Déjà au format d'arrivée : on n'y touche pas. Sans ce test, reprendre un
      // rechiffrement interrompu chiffrerait une seconde fois ce qui l'était
      // déjà — la reprise détruirait précisément ce qu'elle vient sauver.
      if (estScelle(enregistrement.donnees) === nouveau.actif) {
        try {
          await nouveau.dechiffrer(enregistrement.donnees)
          deja += 1
          continue
        } catch (erreur) {
          // Bon format, mauvaise clé : `ancien` ne le lira pas davantage. On le
          // signale plutôt que de le réécrire à partir de rien.
          rejets.push({
            index: debut + rang,
            raison: `${enregistrement.id} : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
          })
          continue
        }
      }
      try {
        const clair = await ancien.dechiffrer(enregistrement.donnees)
        aEcrire.push({ id: enregistrement.id, donnees: await nouveau.chiffrer(clair) })
      } catch (erreur) {
        rejets.push({
          index: debut + rang,
          raison: `${enregistrement.id} : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
        })
      }
    }
    if (aEcrire.length > 0) {
      await base.events.bulkPut(aEcrire)
      rechiffres += aEcrire.length
    }
  }

  return { rechiffres, deja, rejets }
}

/**
 * Lit une enveloppe d'export.
 *
 * L'en-tête est vérifié avant tout : importer un fichier qui n'est pas un
 * journal, ou d'une version qu'on ne sait pas lire, doit échouer en le disant,
 * pas se deviner à moitié.
 */
export function lireJournalExporte(texte: string): { events: unknown[] } {
  let brut: unknown
  try {
    brut = JSON.parse(texte)
  } catch {
    throw new ErreurValidation('fichier', "ce n'est pas du JSON")
  }
  const enveloppe = objet(brut, 'journal')
  const format = chaine(enveloppe.format, 'journal.format')
  if (format !== FORMAT_JOURNAL) {
    throw new ErreurValidation(
      'journal.format',
      `« ${FORMAT_JOURNAL} » attendu, reçu « ${format} »`,
    )
  }
  const version = entier(enveloppe.version, 'journal.version', { min: 1 })
  if (version > VERSION_JOURNAL) {
    throw new ErreurValidation(
      'journal.version',
      `version ${version} écrite par une application plus récente ; cette version lit jusqu'à ${VERSION_JOURNAL}`,
    )
  }
  if (enveloppe.chiffre === true) {
    throw new ErreurValidation(
      'journal.chiffre',
      'journal chiffré : le déchiffrer avant de l’importer',
    )
  }
  return { events: tableau(enveloppe.events, 'journal.events') }
}
