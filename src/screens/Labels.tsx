import { useMemo, useState } from 'react'
import { ajouterMois, dateCivile } from '../core/civilDate'
import { aujourdhui } from '../core/clock'
import { cents } from '../core/money'
import { useFormatMontant } from '../app/discretion'
import { useEtat } from '../app/useEtat'
import { depensesParLabel } from '../domain/selecteurs'
import { Montant } from '../ui/Montant'

const NOMS_MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]

/**
 * Dépenses par label.
 *
 * Les barres sont proportionnelles au plus gros poste, pas au total : on compare
 * des postes entre eux, pas chacun à une somme qui n'a pas de sens à l'œil.
 *
 * Un budget dépassé se signale par un mot et par une barre qui change de couleur
 * — jamais par la couleur seule.
 */
export function Labels() {
  const formater = useFormatMontant()
  const { etat } = useEtat()
  const jour = aujourdhui()
  const [decalage, setDecalage] = useState(0)

  const mois = useMemo(() => {
    const date = ajouterMois(dateCivile(jour), decalage)
    return date.slice(0, 7)
  }, [jour, decalage])

  const lignes = useMemo(() => depensesParLabel(etat, mois), [etat, mois])
  const total = lignes.reduce((somme, ligne) => somme + ligne.total_cents, 0)
  const plusGros = lignes[0]?.total_cents ?? 1

  const [annee, numeroMois] = mois.split('-')

  return (
    <main className="page">
      <header>
        <h1>Dépenses</h1>
      </header>

      <div className="navigation-mois">
        <button type="button" className="secondaire" onClick={() => setDecalage(decalage - 1)}>
          <span aria-hidden="true">←</span>
          <span className="invisible">Mois précédent</span>
        </button>
        <strong>
          {NOMS_MOIS[Number(numeroMois) - 1]} {annee}
        </strong>
        <button
          type="button"
          className="secondaire"
          onClick={() => setDecalage(decalage + 1)}
          disabled={decalage >= 0}
        >
          <span aria-hidden="true">→</span>
          <span className="invisible">Mois suivant</span>
        </button>
      </div>

      <div className="carte">
        <h2>Total du mois</h2>
        <Montant valeur={cents(total)} principal neutre />
        <p className="discret">
          Virements exclus : déplacer de l’argent vers un livret n’est pas une dépense.
        </p>
      </div>

      {lignes.length === 0 ? (
        <div className="carte">
          <p className="discret">Aucune dépense ce mois-ci.</p>
        </div>
      ) : (
        lignes.map((ligne) => {
          const depasse = ligne.partBudget !== null && ligne.partBudget > 1
          return (
            <div className="carte" key={ligne.label?.id ?? 'sans-label'}>
              <div className="ligne-label">
                <h2>{ligne.label?.nom ?? 'Non catégorisé'}</h2>
                <Montant valeur={ligne.total_cents} neutre />
              </div>
              <div className="barre-budget">
                <span
                  className={depasse ? 'depasse' : ''}
                  style={{ width: `${Math.min(100, (ligne.total_cents / plusGros) * 100)}%` }}
                />
              </div>
              <p className="discret">
                {ligne.nombre} mouvement{ligne.nombre > 1 ? 's' : ''}
                {ligne.budget_mensuel_cents !== undefined && (
                  <>
                    {' · '}
                    {depasse ? (
                      <strong>
                        budget dépassé de{' '}
                        {formater(cents(ligne.total_cents - ligne.budget_mensuel_cents))}
                      </strong>
                    ) : (
                      <>
                        {Math.round((ligne.partBudget ?? 0) * 100)} % du budget de{' '}
                        {formater(ligne.budget_mensuel_cents)}
                      </>
                    )}
                  </>
                )}
              </p>
            </div>
          )
        })
      )}
    </main>
  )
}
