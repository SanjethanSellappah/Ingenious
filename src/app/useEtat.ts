import { useSyncExternalStore } from 'react'
import { lire, sabonner, type EtatApplication } from './magasin'

/** Abonne un composant à l'état applicatif. */
export function useEtat(): EtatApplication {
  return useSyncExternalStore(sabonner, lire, lire)
}
