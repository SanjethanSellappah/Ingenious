import { Link } from 'react-router-dom'
import { aujourdhui } from '../core/clock'
import { formaterMontant } from '../core/money'
import { useEtat } from '../app/useEtat'
import {
  occurrencesAConfirmer,
  prochainesEcheances,
  projectionDuCompte,
  resteAVivreDe,
} from '../domain/vues'
import { CourbeSolde } from '../ui/CourbeSolde'
import { Montant } from '../ui/Montant'

/**
 * Accueil.
 *
 * Un seul chiffre en gros — le reste à vivre — et, juste dessous, **de quoi il
 * est fait**. Une projection reste une prédiction : un chiffre faussement précis
 * est pire qu'une fourchette honnête, et un chiffre sans composition ne se
 * conteste pas.
 */
export function Accueil() {
  const { etat } = useEtat()
  const jour = aujourdhui()
  const compteId = etat.reglages.compte_courant_id
  const rav = resteAVivreDe(etat, jour)

  if (compteId === undefined || !etat.comptes.has(compteId)) {
    return (
      <main className="page">
        <header>
          <h1>Accueil</h1>
        </header>
        <div className="carte">
          <p>Aucun compte courant n’est désigné.</p>
          <p className="discret">
            Choisissez-en un dans <Link to="/reglages">Réglages</Link> pour voir le reste à vivre.
          </p>
        </div>
      </main>
    )
  }

  const projection = projectionDuCompte(etat, compteId, jour)
  const echeances = prochainesEcheances(etat, jour, 5)
  const aConfirmer = occurrencesAConfirmer(etat, jour)
  const alerte = projection.pointBasPessimiste.solde_cents < 0

  return (
    <main className="page">
      <header>
        <h1>Reste à vivre</h1>
      </header>

      <div className="carte">
        {rav !== null ? (
          <>
            <Montant valeur={rav.montant_cents} principal neutre />
            <p className="discret">
              {rav.horizonParDefaut ? (
                <>Aucune rentrée connue d’ici le {jourCourt(rav.horizon)}</>
              ) : (
                <>Jusqu’à la prochaine rentrée, le {jourCourt(rav.horizon)}</>
              )}
              {' · '}
              {composition(rav.composition.echeances, rav.composition.echeancesEstimees)}
              {etat.reglages.reserve_cents > 0 && (
                <> · réserve de {formaterMontant(etat.reglages.reserve_cents)} mise de côté</>
              )}
            </p>
            {rav.composition.echeancesEstimees > 0 && (
              <p className="discret">
                Les montants estimés sont pris au plus défavorable :{' '}
                {formaterMontant(rav.montant_central_cents)} avec l’estimation centrale.
              </p>
            )}
          </>
        ) : (
          <p className="discret">Pas encore calculable.</p>
        )}
      </div>

      {aConfirmer.length > 0 && (
        <div className="carte a-confirmer">
          <h2>
            <span aria-hidden="true">⏳</span> À confirmer
          </h2>
          <p className="discret">
            {aConfirmer.length === 1
              ? 'Une échéance est passée'
              : `${aConfirmer.length} échéances sont passées`}{' '}
            sans que le montant réel soit connu. Tant qu’elles ne le sont pas, elles n’entrent ni
            dans le solde ni dans la courbe.
          </p>
          <ul className="liste">
            {aConfirmer.slice(0, 4).map((echeance) => (
              <li key={`${echeance.reference?.subscription_id}-${echeance.date}`}>
                <span>
                  {jourCourt(echeance.date)} · {echeance.libelle}
                </span>
                <Montant valeur={echeance.montant_cents} />
              </li>
            ))}
          </ul>
          <Link to="/confirmer" className="lien-action">
            Confirmer les montants
          </Link>
        </div>
      )}

      <div className="carte">
        <h2>Solde projeté du compte courant</h2>
        <CourbeSolde projection={projection} />
        {alerte && (
          <p className="avertissement">
            <strong>Attention :</strong> au pire des estimations, le solde passe sous zéro le{' '}
            {jourCourt(projection.pointBasPessimiste.date)} (
            {formaterMontant(projection.pointBasPessimiste.solde_cents)}).
          </p>
        )}
        <p className="discret">
          {composition(projection.composition.echeances, projection.composition.echeancesEstimees)}{' '}
          sur {projection.serie.length} jours.
        </p>
        {projection.nonResolues.length > 0 && (
          <p className="erreur-champ">
            {projection.nonResolues.length} échéance(s) sans montant connu :{' '}
            {projection.nonResolues[0]!.libelle}. Renseignez-le pour qu’elle compte.
          </p>
        )}
      </div>

      <div className="carte">
        <h2>Prochaines échéances</h2>
        {echeances.length === 0 ? (
          <p className="discret">Aucune échéance connue dans les deux mois.</p>
        ) : (
          <ul className="liste">
            {echeances.map((echeance, rang) => (
              <li key={`${echeance.date}-${echeance.libelle}-${rang}`}>
                <span>
                  {jourCourt(echeance.date)} · {echeance.libelle ?? 'Échéance'}
                  {echeance.estime && <span className="discret"> · estimé</span>}
                </span>
                <Montant valeur={echeance.montant_cents} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}

/** « 7 échéances connues, dont 2 estimées » — de quoi le chiffre est fait. */
function composition(total: number, estimees: number): string {
  if (total === 0) return 'aucune échéance connue'
  const base = total === 1 ? '1 échéance connue' : `${total} échéances connues`
  if (estimees === 0) return base
  return `${base}, dont ${estimees} estimée${estimees > 1 ? 's' : ''}`
}

function jourCourt(date: string): string {
  const [, mois, jour] = date.split('-')
  return `${jour}/${mois}`
}
