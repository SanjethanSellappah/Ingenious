import { formaterMontant, type Cents } from '../core/money'

/**
 * Affichage d'un montant.
 *
 * Le signe est **toujours** explicite et doublé d'une icône : la couleur seule
 * ne porte jamais l'information. Un daltonien, un écran en plein soleil ou un
 * mode contraste élevé ne doivent pas changer ce qu'on comprend.
 */
export function Montant({
  valeur,
  principal = false,
  neutre = false,
}: {
  valeur: Cents
  /** Grande taille, pour le chiffre d'accueil. */
  principal?: boolean
  /** Ni entrée ni sortie : un solde, un patrimoine. Pas de signe ajouté. */
  neutre?: boolean
}) {
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
