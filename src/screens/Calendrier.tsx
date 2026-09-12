import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ajouterJours,
  ajouterMois,
  composantes,
  dateCivile,
  depuisComposantes,
  jourDeLaSemaine,
  joursDansLeMois,
} from '../core/civilDate'
import { aujourdhui } from '../core/clock'
import { nomDuFerie } from '../core/holidaysFR'
import { cents, type Cents } from '../core/money'
import { useFormatMontant } from '../app/discretion'
import { useEtat } from '../app/useEtat'
import { compteCourantEffectif } from '../domain/selecteurs'
import { echeancesDuCompte, projectionDuCompte } from '../domain/vues'
import { CourbeSolde } from '../ui/CourbeSolde'
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
 * Calendrier mensuel.
 *
 * Une pastille par jour porteur d'échéance, et la courbe en dessous. La pastille
 * est un point **plus un montant au survol** : un code couleur seul ne dirait pas
 * si le 15 est un prélèvement de 12 € ou de 700 €.
 */
/** Ce qu'un jour porte : le cumul et le détail, montants non mis en forme. */
type LigneJour = { total: number; lignes: { nom: string; montant_cents: Cents }[] }

export function Calendrier() {
  const formater = useFormatMontant()
  const { etat } = useEtat()
  const jour = aujourdhui()
  const compteId = compteCourantEffectif(etat)
  const [decalage, setDecalage] = useState(0)

  const moisAffiche = useMemo(() => ajouterMois(dateCivile(jour), decalage), [jour, decalage])
  const { annee, mois } = composantes(moisAffiche)

  const parJour = useMemo(() => {
    if (compteId === undefined) return new Map<string, LigneJour>()
    const debut = depuisComposantes(annee, mois, 1)
    const fin = depuisComposantes(annee, mois, joursDansLeMois(annee, mois))
    // Les échéances déjà passées du mois courant comptent aussi : le calendrier
    // montre le mois, pas seulement l'avenir.
    // La borne de départ est exclue : on recule d'un jour pour inclure le 1er.
    const { echeances } = echeancesDuCompte(etat, compteId, ajouterJours(debut, -1), fin)
    const carte = new Map<string, LigneJour>()
    for (const echeance of echeances) {
      const courant = carte.get(echeance.date) ?? { total: 0, lignes: [] }
      courant.total += echeance.montant_cents
      // Le montant n'est pas mis en forme ici : la mise en forme dépend du mode
      // discrétion, qui peut changer sans que les échéances bougent. Un libellé
      // calculé dans le mémo resterait figé au moment de la bascule.
      courant.lignes.push({
        nom: echeance.libelle ?? 'Échéance',
        montant_cents: echeance.montant_cents,
      })
      carte.set(echeance.date, courant)
    }
    return carte
  }, [etat, compteId, annee, mois])

  const enTexte = (ligne: LigneJour): string[] =>
    ligne.lignes.map((l) => `${l.nom} ${formater(l.montant_cents)}`)

  const projection = useMemo(
    () => (compteId === undefined ? null : projectionDuCompte(etat, compteId, dateCivile(jour))),
    [etat, compteId, jour],
  )

  const premierJour = depuisComposantes(annee, mois, 1)
  // Grille française : la semaine commence le lundi, pas le dimanche.
  const decalageInitial = (jourDeLaSemaine(premierJour) + 6) % 7
  const nombreJours = joursDansLeMois(annee, mois)

  return (
    <main className="page">
      <header>
        <h1>Calendrier</h1>
      </header>

      <div className="navigation-mois">
        <button type="button" className="secondaire" onClick={() => setDecalage(decalage - 1)}>
          <span aria-hidden="true">←</span>
          <span className="invisible">Mois précédent</span>
        </button>
        <strong>
          {NOMS_MOIS[mois - 1]} {annee}
        </strong>
        <button type="button" className="secondaire" onClick={() => setDecalage(decalage + 1)}>
          <span aria-hidden="true">→</span>
          <span className="invisible">Mois suivant</span>
        </button>
      </div>

      <div className="grille-mois" role="grid" aria-label={`${NOMS_MOIS[mois - 1]} ${annee}`}>
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((lettre, rang) => (
          <div key={rang} className="entete-jour" aria-hidden="true">
            {lettre}
          </div>
        ))}
        {Array.from({ length: decalageInitial }, (_, rang) => (
          <div key={`vide-${rang}`} />
        ))}
        {Array.from({ length: nombreJours }, (_, rang) => {
          const date = depuisComposantes(annee, mois, rang + 1)
          const echeance = parJour.get(date)
          const ferie = nomDuFerie(date)
          return (
            <div
              key={date}
              className={`case-jour${date === jour ? ' aujourdhui' : ''}${ferie !== null ? ' ferie' : ''}`}
              title={echeance ? enTexte(echeance).join(' · ') : (ferie ?? undefined)}
            >
              <span className="numero">{rang + 1}</span>
              {echeance && (
                <span
                  className={`pastille ${echeance.total < 0 ? 'sortie' : 'entree'}`}
                  aria-label={enTexte(echeance).join(', ')}
                >
                  {echeance.total < 0 ? '−' : '+'}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {parJour.size > 0 && (
        <div className="carte">
          <h2>Échéances du mois</h2>
          <ul className="liste">
            {[...parJour.entries()]
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([date, ligne]) => (
                <li key={date}>
                  <span>
                    {date.slice(8)} · {enTexte(ligne).join(', ')}
                  </span>
                  <Montant valeur={cents(ligne.total)} />
                </li>
              ))}
          </ul>
        </div>
      )}

      {projection !== null && (
        <div className="carte">
          <h2>Solde projeté</h2>
          <CourbeSolde projection={projection} />
        </div>
      )}

      {compteId === undefined && (
        <div className="carte">
          <p>Aucun compte courant n’est désigné.</p>
          <p className="discret">
            Le calendrier suit les échéances d’un compte. Choisissez-le dans{' '}
            <Link to="/reglages">Réglages</Link>.
          </p>
        </div>
      )}
    </main>
  )
}
