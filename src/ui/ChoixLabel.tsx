import { labelsActifs, type ChoixLabel as Choix } from '../domain/labels'
import type { Etat } from '../domain/etat'

/**
 * Choisir un label, ou en nommer un nouveau.
 *
 * Le même bloc partout où un label se choisit. Un écran qui propose une liste
 * vide sans offrir d'y ajouter quoi que ce soit est une impasse : c'est ce que
 * voyait quiconque créait son premier abonnement, puisque les labels ne
 * naissaient que dans l'ajout rapide.
 *
 * Les labels existants sont des boutons plutôt qu'une liste déroulante : ils
 * sont peu nombreux, on les reconnaît d'un coup d'œil, et un seul appui suffit
 * là où une liste déroulante en demande trois.
 */
export function ChoixLabel({
  etat,
  valeur,
  onChange,
  libelle = 'Poste de dépense',
  // Identifiant explicite plutôt que dérivé du libellé : un identifiant qui
  // change quand on reformule un intitulé casse silencieusement ce qui le vise.
  id = 'nouveau-label',
}: {
  etat: Etat
  valeur: Choix
  onChange: (choix: Choix) => void
  libelle?: string
  id?: string
}) {
  const labels = labelsActifs(etat)

  return (
    <div className="champ">
      <span className="etiquette">{libelle}</span>
      {labels.length > 0 && (
        <div className="raccourcis" role="group" aria-label={`${libelle} : choix existants`}>
          {labels.map((label) => (
            <button
              key={label.id}
              type="button"
              aria-pressed={valeur.labelId === label.id && valeur.nouveauNom === ''}
              onClick={() =>
                onChange({
                  labelId: valeur.labelId === label.id ? '' : label.id,
                  nouveauNom: '',
                })
              }
            >
              {label.nom}
            </button>
          ))}
        </div>
      )}
      <label htmlFor={id} className="discret">
        {labels.length > 0 ? 'ou en créer un' : 'Aucun label pour l’instant — nommez le premier'}
      </label>
      <input
        id={id}
        value={valeur.nouveauNom}
        autoComplete="off"
        placeholder="Courses, Logement, Loisirs…"
        onChange={(e) => onChange({ labelId: '', nouveauNom: e.target.value })}
      />
    </div>
  )
}
