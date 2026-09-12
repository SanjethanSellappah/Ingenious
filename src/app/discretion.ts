/**
 * Mode discrétion : masquer les montants à l'écran.
 *
 * Le besoin n'est pas la sécurité — le code de verrouillage s'en charge — mais
 * le regard d'à côté : consulter son reste à vivre dans le métro, tendre son
 * téléphone à quelqu'un pour lui montrer autre chose. Masquer doit donc se faire
 * et se défaire **en un geste**, sans code à ressaisir.
 *
 * C'est un réglage d'appareil, pas une donnée : il reste en mémoire locale et
 * n'entre pas dans le journal. Le masquage de tel ou tel compte, lui, décrit le
 * compte et voyage avec lui.
 */
import { useSyncExternalStore } from 'react'
import { formaterMontant, type Cents } from '../core/money'

const CLE = 'ingenious.discretion'

let masque = lireAuDemarrage()
const abonnes = new Set<() => void>()

function lireAuDemarrage(): boolean {
  try {
    return localStorage.getItem(CLE) === 'oui'
  } catch {
    // Mémoire locale refusée : on démarre à découvert, ce qui est l'état attendu.
    return false
  }
}

export function montantsMasques(): boolean {
  return masque
}

export function basculerDiscretion(): void {
  masque = !masque
  try {
    localStorage.setItem(CLE, masque ? 'oui' : 'non')
  } catch {
    // Sans mémoire locale, le mode ne survit pas au rechargement : c'est
    // dégradé, jamais bloquant.
  }
  for (const abonne of abonnes) abonne()
}

export function sabonnerDiscretion(abonne: () => void): () => void {
  abonnes.add(abonne)
  return () => abonnes.delete(abonne)
}

/**
 * Formatage respectant le mode discrétion.
 *
 * Tous les montants ne passent pas par le composant `Montant` : beaucoup sont
 * enchâssés dans une phrase — « au pire, le solde passe sous zéro le 12/09
 * (-2 260,00 €) ». Ces phrases-là révélaient tout, et un mode discrétion qui
 * laisse un écran lisible ne masque rien du tout.
 */
export function useFormatMontant(): (valeur: Cents) => string {
  const masque = useSyncExternalStore(sabonnerDiscretion, montantsMasques, () => false)
  return (valeur: Cents) => (masque ? '••••' : formaterMontant(valeur))
}
