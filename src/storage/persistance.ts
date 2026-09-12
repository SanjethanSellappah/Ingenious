/**
 * Persistance du stockage.
 *
 * Un navigateur fait le ménage dans les données des sites qu'on ne visite plus,
 * et il ne distingue pas un site oublié d'une application qu'on n'a pas ouverte
 * de la semaine. `navigator.storage.persist()` demande d'être épargné ; les
 * navigateurs y répondent différemment — Chrome l'accorde volontiers à une
 * application installée, Safari sur iOS ne l'accorde pas du tout, et là seule
 * l'installation sur l'écran d'accueil protège.
 *
 * D'où le parti pris : on demande, puis on **affiche la réponse obtenue** au
 * lieu de deviner d'après l'appareil. L'interface s'accorde à ce que le
 * navigateur a répondu. Et dans tous les cas, la vraie sauvegarde reste l'export.
 */

export type EtatPersistance = {
  /** Le navigateur garantit-il de ne pas purger ? */
  accorde: boolean
  /** L'API existe-t-elle seulement ? */
  disponible: boolean
  /** L'application tourne-t-elle installée sur l'écran d'accueil ? */
  installee: boolean
  octetsUtilises?: number
  quotaOctets?: number
}

export function estInstallee(): boolean {
  if (typeof window === 'undefined') return false
  const autonome = window.matchMedia?.('(display-mode: standalone)')?.matches === true
  const iosAutonome = (window.navigator as { standalone?: boolean }).standalone === true
  return autonome || iosAutonome
}

/** Demande la persistance et rend l'état réellement obtenu. */
export async function demanderPersistance(): Promise<EtatPersistance> {
  const installee = estInstallee()
  const stockage = typeof navigator !== 'undefined' ? navigator.storage : undefined
  if (!stockage?.persist) return { accorde: false, disponible: false, installee }

  let accorde: boolean
  try {
    accorde = (await stockage.persisted?.()) || (await stockage.persist())
  } catch {
    accorde = false
  }

  const etat: EtatPersistance = { accorde, disponible: true, installee }
  try {
    const estimation = await stockage.estimate?.()
    if (estimation?.usage !== undefined) etat.octetsUtilises = estimation.usage
    if (estimation?.quota !== undefined) etat.quotaOctets = estimation.quota
  } catch {
    // Une estimation indisponible n'est pas une erreur : on affiche ce qu'on a.
  }
  return etat
}
