import { Link } from 'react-router-dom'
import { aujourdhui } from '../core/clock'
import { useFormatMontant } from '../app/discretion'
import { rappelSauvegarde } from '../app/automatismes'
import { useEtat } from '../app/useEtat'
import { compteCourantEffectif } from '../domain/selecteurs'
import {
  destinationEcheance,
  occurrencesAConfirmer,
  prochainesEcheances,
  projectionDuCompte,
  resteAVivreDe,
} from '../domain/vues'
import { CourbeSolde } from '../ui/CourbeSolde'
import { jourEtMois } from '../ui/dates'
import { Icone } from '../ui/Icone'
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
  const formater = useFormatMontant()
  const { etat } = useEtat()
  const jour = aujourdhui()
  const compteId = compteCourantEffectif(etat)
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
  // Le rappel vit ici et pas seulement dans Réglages : un rappel rangé dans
  // l'écran qu'on n'ouvre jamais n'est pas un rappel.
  const rappel = rappelSauvegarde(jour)

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
                <>Aucune rentrée connue d’ici le {jourEtMois(rav.horizon)}</>
              ) : (
                <>Jusqu’à la prochaine rentrée, le {jourEtMois(rav.horizon)}</>
              )}
              {' · '}
              {composition(rav.composition.echeances, rav.composition.echeancesEstimees)}
              {etat.reglages.reserve_cents > 0 && (
                <> · réserve de {formater(etat.reglages.reserve_cents)} mise de côté</>
              )}
            </p>
            {rav.composition.echeancesEstimees > 0 && (
              <p className="discret">
                Les montants estimés sont pris au plus défavorable :{' '}
                {formater(rav.montant_central_cents)} avec l’estimation centrale.
              </p>
            )}
          </>
        ) : (
          <p className="discret">Pas encore calculable.</p>
        )}
      </div>

      {/* Un rappel permanent, pas une urgence : il ne doit pas disputer l'œil à
          l'échéance qu'on peut confirmer tout de suite. */}
      {rappel.du && (
        <div className="carte carte-rappel">
          <h2>
            <Icone nom="sauvegarde" taille={18} /> Sauvegarde
          </h2>
          <p className="discret">
            {rappel.dernier === null
              ? 'Aucun export depuis cet appareil.'
              : `Dernier export il y a ${rappel.jours} jours.`}{' '}
            Sans serveur, un téléphone cassé sans export, c’est tout perdu.
          </p>
          <Link to="/reglages" className="lien-action">
            Exporter maintenant
          </Link>
        </div>
      )}

      {aConfirmer.length > 0 && (
        <div className="carte a-confirmer">
          <h2>
            <Icone nom="attente" taille={18} /> À confirmer
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
                {/* La ligne mène là où on peut agir. Une échéance qu'on voit
                    sans pouvoir l'ouvrir est une impasse : c'est précisément
                    pour la confirmer qu'on la regarde. */}
                <Link to="/confirmer">
                  {jourEtMois(echeance.date)} · {echeance.libelle}
                </Link>
                {echeance.montantConnu ? (
                  <Montant valeur={echeance.montant_cents} />
                ) : (
                  <span className="discret">montant à renseigner</span>
                )}
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
            {jourEtMois(projection.pointBasPessimiste.date)} (
            {formater(projection.pointBasPessimiste.solde_cents)}).
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
                {(() => {
                  const vers = destinationEcheance(echeance)
                  const contenu = (
                    <>
                      {jourEtMois(echeance.date)} · {echeance.libelle ?? 'Échéance'}
                      {echeance.estime && <span className="discret"> · estimé</span>}
                    </>
                  )
                  // Une échéance sans origine connue ne mène nulle part, et sa
                  // ligne ne fait alors pas semblant d'être cliquable.
                  return vers === null ? <span>{contenu}</span> : <Link to={vers}>{contenu}</Link>
                })()}
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
