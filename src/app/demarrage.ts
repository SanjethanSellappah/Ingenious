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
import { compterHorsFormat, ouvrirDepot, rechiffrerJournal } from '../storage/repository'
import { chiffreurIdentite } from '../storage/crypto'
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

  // Demandée au premier lancement. Le résultat est constaté, pas supposé : les
  // navigateurs y répondent différemment, et l'interface s'accorde à la réponse
  // obtenue plutôt qu'à une supposition sur l'appareil.
  const persistance = await demanderPersistance()

  // Sans coffre, le journal est lisible tout de suite ; avec, il attend le code.
  if (verrou.etat.statut === 'sans_pin') {
    await brancherDepot(await ouvrirDepot({ base, chiffreur: verrou.chiffreur }))
  }
  return { base, verrou, persistance }
}

/**
 * Branche le dépôt une fois le verrou ouvert.
 *
 * Avant d'ouvrir, on termine un éventuel chiffrement interrompu. C'est le cas
 * d'un appareil fermé pendant l'activation du code : le coffre est là, une
 * partie du journal est encore en clair, et sans cette reprise ces
 * enregistrements seraient rejetés à chaque ouverture — présents sur le disque,
 * invisibles dans l'application.
 *
 * La question ne coûte rien : elle se lit sur la forme des enregistrements, sans
 * déchiffrer.
 */
export async function ouvrirJournal(base: BaseIngenious, verrou: Verrou): Promise<void> {
  if (verrou.chiffreur.actif && (await compterHorsFormat(base, verrou.chiffreur)) > 0) {
    await rechiffrerJournal(base, chiffreurIdentite(), verrou.chiffreur)
  }
  await brancherDepot(await ouvrirDepot({ base, chiffreur: verrou.chiffreur }))
}

/** Enregistre une enveloppe de coffre mise à jour — changement de code. */
export async function enregistrerCoffre(base: BaseIngenious, meta: MetaCoffre): Promise<void> {
  await base.meta.put({ cle: CLE_COFFRE, valeur: meta })
}

/**
 * Active un coffre neuf sur une base existante.
 *
 * Le coffre est enregistré **avant** le rechiffrement, et c'est l'inverse de ce
 * que dicte l'intuition. La raison est qu'il faut départager deux accidents :
 *
 * - Le rechiffrement **échoue** : les deux ordres se valent, on le signale.
 * - L'application est **fermée pendant** — onglet quitté, mémoire réclamée par
 *   le système, batterie à plat. Rechiffrer quinze ans de journal prend une
 *   dizaine de secondes, davantage sur un téléphone : la fenêtre est réelle.
 *
 * Dans ce second cas, rechiffrer d'abord perd tout ce qui a déjà été scellé —
 * la clé de données n'a jamais été rangée, donc elle n'existe plus nulle part.
 * Enregistrer le coffre d'abord ne perd rien : la clé survit, et l'ouverture
 * suivante termine le travail commencé.
 */
export async function activerCoffre(
  base: BaseIngenious,
  ancien: Verrou,
  nouveau: Verrou,
): Promise<{ rechiffres: number; rejets: { index: number; raison: string }[] }> {
  if (nouveau.meta === null) throw new Error('Aucun coffre à activer')
  await base.meta.put({ cle: CLE_COFFRE, valeur: nouveau.meta })
  const resultat = await rechiffrerJournal(base, ancien.chiffreur, nouveau.chiffreur)
  if (resultat.rejets.length > 0) {
    // Le coffre reste en place : c'est lui qui garde la clé des enregistrements
    // déjà scellés. Le retirer ici perdrait pour de bon ce qu'on cherche à
    // signaler. Les illisibles sont nommés, et l'ouverture suivante retentera.
    throw new Error(
      `${resultat.rejets.length} enregistrement(s) illisible(s) : ${resultat.rejets[0]!.raison}`,
    )
  }
  return resultat
}
