/**
 * Récupération automatique des cours.
 *
 * C'est le seul endroit de l'application qui sorte sur le réseau, et cela mérite
 * d'être dit trois fois :
 *
 * - **La clé n'entre jamais dans le journal.** Elle vit en mémoire locale, à
 *   côté des données, jamais dedans : l'export est en clair et se transmet, et
 *   une clé partie dans une sauvegarde est une clé publiée. C'est aussi pourquoi
 *   elle n'est pas chiffrée par le code de verrouillage — elle n'a rien à faire
 *   dans ce qui se recopie d'un appareil à l'autre.
 * - **L'application marche sans.** Sans clé, sans réseau, ou si le service
 *   répond mal, les cours saisis à la main continuent de valoir. Rien n'est
 *   effacé, rien ne se met à zéro : on garde le dernier cours connu et on dit
 *   sa date.
 * - **Un cours reçu est un événement comme un autre.** Il est écrit dans le
 *   journal, daté, avec sa source. On peut donc relire le patrimoine d'un mois
 *   passé avec les cours de ce mois-là, et non avec ceux d'aujourd'hui.
 */
import { aujourdhui } from '../core/clock'
import { arrondirCents } from '../core/money'
import { ecrire } from './magasin'
import type { Etat, Instrument } from '../domain/etat'

const CLE_API = 'ingenious.cle-cours'

/**
 * Le service interrogé.
 *
 * Un seul, nommé ici et nulle part ailleurs : la politique de sécurité du
 * contenu n'autorise que cet hôte, et une liste de services voudrait dire une
 * liste d'hôtes autorisés — donc une politique plus large pour un bénéfice que
 * personne n'a demandé.
 */
export const SERVICE = {
  nom: 'Twelve Data',
  hote: 'https://api.twelvedata.com',
  inscription: 'https://twelvedata.com/pricing',
}

export function cleCours(): string {
  try {
    return localStorage.getItem(CLE_API) ?? ''
  } catch {
    return ''
  }
}

export function enregistrerCleCours(cle: string): void {
  try {
    if (cle.trim() === '') localStorage.removeItem(CLE_API)
    else localStorage.setItem(CLE_API, cle.trim())
  } catch {
    // Sans mémoire locale, l'actualisation automatique est simplement
    // indisponible : les cours saisis à la main continuent de valoir.
  }
}

export type ResultatCours = {
  misAJour: number
  /** Instruments que le service n'a pas su coter, avec la raison. */
  echecs: { symbole: string; raison: string }[]
}

/**
 * Symbole interrogeable.
 *
 * L'or ne se cote pas sous le nom qu'on lui a donné : c'est une paire de
 * devises. Sans cette traduction, un utilisateur qui appelle sa ligne « Or
 * physique » n'obtiendrait jamais de cours et n'aurait aucun moyen de deviner
 * pourquoi.
 */
export function symboleInterrogeable(instrument: Instrument): string {
  if (instrument.genre === 'or') return 'XAU/EUR'
  return instrument.symbole.trim()
}

/**
 * Le cours reçu porte sur une unité de cotation, pas forcément sur la nôtre.
 *
 * L'or se cote à l'once ; quelqu'un qui compte en grammes verrait sinon son
 * patrimoine multiplié par trente et un.
 */
const GRAMMES_PAR_ONCE = 31.1034768

export function convertirVersUnite(cours: number, instrument: Instrument): number {
  if (instrument.genre !== 'or') return cours
  if (instrument.unite === 'gramme') return cours / GRAMMES_PAR_ONCE
  return cours
}

/** Extrait un prix d'une réponse, sans supposer qu'elle soit bien formée. */
export function lirePrix(charge: unknown): number | null {
  if (typeof charge !== 'object' || charge === null) return null
  const brut = (charge as { price?: unknown }).price
  const nombre = typeof brut === 'string' ? Number(brut) : typeof brut === 'number' ? brut : NaN
  return Number.isFinite(nombre) && nombre > 0 ? nombre : null
}

/**
 * Interroge le service pour chaque instrument coté, et écrit ce qui revient.
 *
 * `recuperer` est injectable : c'est ce qui permet d'éprouver tout le chemin —
 * la traduction des symboles, la conversion d'unité, l'écriture au journal, le
 * traitement des échecs — sans dépendre d'un service extérieur ni d'une clé.
 */
export async function actualiserCours(
  etat: Etat,
  options: {
    cle?: string
    recuperer?: (url: string) => Promise<unknown>
    jour?: string
  } = {},
): Promise<ResultatCours> {
  const cle = options.cle ?? cleCours()
  if (cle === '')
    return { misAJour: 0, echecs: [{ symbole: '—', raison: 'aucune clé enregistrée' }] }

  const recuperer =
    options.recuperer ??
    (async (url: string) => {
      const reponse = await fetch(url)
      if (!reponse.ok) throw new Error(`réponse ${reponse.status}`)
      return (await reponse.json()) as unknown
    })

  const jour = options.jour ?? aujourdhui()
  const entrees: Parameters<typeof ecrire>[0][number][] = []
  const echecs: ResultatCours['echecs'] = []

  for (const instrument of etat.instruments.values()) {
    const symbole = symboleInterrogeable(instrument)
    if (symbole === '') {
      echecs.push({ symbole: instrument.nom, raison: 'aucun symbole renseigné' })
      continue
    }
    try {
      const charge = await recuperer(
        `${SERVICE.hote}/price?symbol=${encodeURIComponent(symbole)}&apikey=${encodeURIComponent(cle)}`,
      )
      const prix = lirePrix(charge)
      if (prix === null) {
        echecs.push({ symbole, raison: 'cours absent de la réponse' })
        continue
      }
      const parUnite = convertirVersUnite(prix, instrument)
      entrees.push({
        type: 'instrument.quoted',
        payload: {
          instrument_id: instrument.id,
          date: jour,
          cours_cents: arrondirCents(parUnite * 100),
          source: SERVICE.nom,
        },
      })
    } catch (erreur) {
      echecs.push({
        symbole,
        raison: erreur instanceof Error ? erreur.message : String(erreur),
      })
    }
  }

  // Une seule écriture : les cours d'une même actualisation décrivent le même
  // instant, et les écrire un par un ferait autant de replis inutiles.
  if (entrees.length > 0) await ecrire(entrees)
  return { misAJour: entrees.length, echecs }
}
