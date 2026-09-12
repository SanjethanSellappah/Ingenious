import { useSyncExternalStore } from 'react'
import { formaterMontant, type Cents } from '../core/money'
import { montantsMasques, sabonnerDiscretion } from '../app/discretion'

/**
 * Affichage d'un montant.
 *
 * Le signe est **toujours** explicite et doublé d'une icône : la couleur seule
 * ne porte jamais l'information. Un daltonien, un écran en plein soleil ou un
 * mode contraste élevé ne doivent pas changer ce qu'on comprend.
 *
 * Le masquage passe par ici, et par ici seulement : un montant caché sur un
 * écran et lisible sur un autre ne masque rien du tout. Le signe et l'icône
 * disparaissent avec le chiffre — savoir qu'une ligne est une sortie, c'est déjà
 * en dire long sur ce qu'on voulait taire.
 */
export function Montant({
  valeur,
  principal = false,
  neutre = false,
  masque = false,
}: {
  valeur: Cents
  /** Grande taille, pour le chiffre d'accueil. */
  principal?: boolean
  /** Ni entrée ni sortie : un solde, un patrimoine. Pas de signe ajouté. */
  neutre?: boolean
  /** Masqué indépendamment du mode global — un compte qu'on ne veut pas voir. */
  masque?: boolean
}) {
  const discretion = useSyncExternalStore(sabonnerDiscretion, montantsMasques, () => false)

  if (discretion || masque) {
    // Sans les classes de sens : colorer les points en rouge ou en vert dirait
    // encore s'il s'agit d'une sortie ou d'une rentrée.
    return (
      <span
        className={
          principal ? 'montant montant-principal montant-masque' : 'montant montant-masque'
        }
      >
        <span aria-hidden="true">••••</span>
        <span className="hors-ecran">montant masqué</span>
      </span>
    )
  }

  const classes = ['montant']
  if (principal) classes.push('montant-principal')
  if (!neutre && valeur < 0) classes.push('montant-sortie')
  if (!neutre && valeur > 0) classes.push('montant-entree')

  const rendu = formaterMontant(valeur, { signeExplicite: !neutre })
  const icone = neutre || valeur === 0 ? null : valeur < 0 ? '↓' : '↑'

  return (
    <span className={classes.join(' ')}>
      {icone !== null && (
        <span aria-hidden="true" className="montant-icone">
          {icone}{' '}
        </span>
      )}
      {rendu}
    </span>
  )
}
