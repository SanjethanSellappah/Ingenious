/**
 * Démarrage de l'application.
 *
 * Trois choses à établir avant d'afficher quoi que ce soit : y a-t-il un coffre,
 * la base est-elle persistante, et le journal est-il lisible. Aucune ne doit être
 * supposée — chacune est constatée et affichable dans Réglages.
 */
import { ouvrirBase, CLE_COFFRE, type BaseIngenious } from '../storage/db'
import { demanderPersistance, type EtatPersistance } from '../storage/persistance'
import type { MetaCoffre } from '../storage/crypto'
import { ouvrirDepot } from '../storage/repository'
import { brancherDepot } from './magasin'
import { verrouFerme, verrouSansPin, type Verrou } from './verrou'

export type Demarrage = {
  base: BaseIngenious
  verrou: Verrou
  persistance: EtatPersistance
}

export async function demarrer(nomBase?: string): Promise<Demarrage> {
  const base = ouvrirBase(nomBase)
  const enregistrement = await base.meta.get(CLE_COFFRE)
  const meta = enregistrement?.valeur as MetaCoffre | undefined
  const verrou = meta ? verrouFerme(meta) : verrouSansPin()

  // Demandée au premier lancement. Le résultat est constaté, pas supposé : sur
  // iOS l'appel n'accorde rien, seule l'installation protège.
  const persistance = await demanderPersistance()

  // Sans coffre, le journal est lisible tout de suite ; avec, il attend le code.
  if (verrou.etat.statut === 'sans_pin') {
    await brancherDepot(await ouvrirDepot({ base, chiffreur: verrou.chiffreur }))
  }
  return { base, verrou, persistance }
}

/** Branche le dépôt une fois le verrou ouvert. */
export async function ouvrirJournal(base: BaseIngenious, verrou: Verrou): Promise<void> {
  await brancherDepot(await ouvrirDepot({ base, chiffreur: verrou.chiffreur }))
}

/** Enregistre le coffre après configuration d'un PIN. */
export async function enregistrerCoffre(base: BaseIngenious, meta: MetaCoffre): Promise<void> {
  await base.meta.put({ cle: CLE_COFFRE, valeur: meta })
}
