import { useId, useState } from 'react'
import { analyserMontant, formaterPourSaisie, type Cents } from '../core/money'

/**
 * Champ de saisie d'un montant.
 *
 * `inputmode="decimal"` ouvre le pavé numérique sur téléphone — sans lui, il
 * faut trois gestes pour taper une somme, et l'application est abandonnée au
 * bout de trois semaines.
 *
 * La virgule est acceptée comme le point : c'est ce que produit le clavier
 * français, refuser l'un des deux serait une brimade.
 */
export function SaisieMontant({
  libelle,
  valeurInitiale,
  onChange,
  autoFocus = false,
}: {
  libelle: string
  valeurInitiale?: Cents
  onChange: (valeur: Cents | null) => void
  autoFocus?: boolean
}) {
  const id = useId()
  const [texte, setTexte] = useState(
    valeurInitiale === undefined ? '' : formaterPourSaisie(valeurInitiale),
  )
  const [touche, setTouche] = useState(false)

  const valeur = analyserMontant(texte)
  const invalide = touche && texte.trim() !== '' && valeur === null

  return (
    <div className="champ saisie-montant">
      <label htmlFor={id}>{libelle}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        value={texte}
        aria-invalid={invalide}
        aria-describedby={invalide ? `${id}-erreur` : undefined}
        onChange={(evenement) => {
          const saisi = evenement.target.value
          setTexte(saisi)
          onChange(analyserMontant(saisi))
        }}
        onBlur={() => setTouche(true)}
      />
      {invalide && (
        <p className="erreur-champ" id={`${id}-erreur`} role="alert">
          Montant incompris. Deux décimales au maximum, virgule ou point.
        </p>
      )}
    </div>
  )
}
