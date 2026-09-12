/**
 * Persistance du stockage.
 *
 * Safari purge IndexedDB après quelques jours sans visite. `navigator.storage.persist()`
 * n'y change rien : sur iOS, **la seule protection est l'installation sur l'écran
 * d'accueil**. L'appel reste utile sur Chrome et sur macOS, il est donc fait — mais
 * l'état obtenu est affiché tel quel plutôt que supposé, et l'export reste la vraie
 * sauvegarde.
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
