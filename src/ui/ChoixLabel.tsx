import { suggestionsLabels, type ChoixLabel as Choix } from '../domain/labels'
import type { Etat } from '../domain/etat'

/** Valeur réservée de la liste : elle ouvre le champ de saisie. */
const NOUVEAU = '__nouveau__'

/**
 * Choisir un poste de dépense, ou en nommer un nouveau.
 *
 * Une liste déroulante plutôt qu'une rangée de pastilles : les postes se
 * comptent en dizaines au bout de quelques mois, et une rangée qui passe à la
 * ligne trois fois n'est plus un choix, c'est un mur. La liste garde une hauteur
 * constante quel que soit leur nombre.
 *
 * « Nouveau label » est **en tête**, pas en queue : c'est l'entrée qu'on cherche
 * quand on ne trouve pas son poste, et la chercher au bout d'une liste de trente
 * entrées est une petite punition.
 *
 * Les postes courants sont proposés avant d'exister. Ils ne sont écrits dans le
 * journal que si on les choisit — une application neuve n'arrive pas avec six
 * événements dont on n'a peut-être jamais l'usage.
 */
export function ChoixLabel({
  etat,
  valeur,
  onChange,
  libelle = 'Poste de dépense',
  id = 'nouveau-label',
}: {
  etat: Etat
  valeur: Choix
  onChange: (choix: Choix) => void
  libelle?: string
  id?: string
}) {
  const suggestions = suggestionsLabels(etat)
  const enCreation = valeur.creation === true

  // Ce que la liste montre comme sélectionné : un label existant par son
  // identifiant, un poste courant pas encore créé par son nom.
  const selection = enCreation
    ? NOUVEAU
    : valeur.labelId !== ''
      ? valeur.labelId
      : valeur.nouveauNom !== ''
        ? `nom:${valeur.nouveauNom}`
        : ''

  function choisir(brut: string) {
    if (brut === NOUVEAU) return onChange({ labelId: '', nouveauNom: '', creation: true })
    if (brut === '') return onChange({ labelId: '', nouveauNom: '' })
    if (brut.startsWith('nom:')) return onChange({ labelId: '', nouveauNom: brut.slice(4) })
    onChange({ labelId: brut, nouveauNom: '' })
  }

  const existants = suggestions.filter((s) => s.existe)
  const courants = suggestions.filter((s) => !s.existe)

  return (
    <div className="champ">
      <label htmlFor={`${id}-liste`}>{libelle}</label>
      <select id={`${id}-liste`} value={selection} onChange={(e) => choisir(e.target.value)}>
        <option value={NOUVEAU}>+ Nouveau label…</option>
        <option value="">Sans poste</option>
        {existants.length > 0 && (
          <optgroup label="Vos postes">
            {existants.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nom}
              </option>
            ))}
          </optgroup>
        )}
        {courants.length > 0 && (
          <optgroup label="Courants">
            {courants.map((s) => (
              <option key={s.nom} value={`nom:${s.nom}`}>
                {s.nom}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {enCreation && (
        <div className="champ-imbrique">
          <label htmlFor={id} className="discret">
            Nom du nouveau label
          </label>
          <input
            id={id}
            value={valeur.nouveauNom}
            autoComplete="off"
            autoFocus
            placeholder="Restaurant, Ménage, Cadeaux…"
            onChange={(e) => onChange({ labelId: '', nouveauNom: e.target.value, creation: true })}
          />
        </div>
      )}
    </div>
  )
}
