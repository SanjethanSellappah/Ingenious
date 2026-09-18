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
import { type Cents } from '../core/money'
import { useFormatMontant } from '../app/discretion'
import { useEtat } from '../app/useEtat'
import { compteCourantEffectif } from '../domain/selecteurs'
import type { EcheanceProjetee } from '../core/projection'
import { echeancesDuCompte, projectionDuCompte } from '../domain/vues'
import { CourbeSolde } from '../ui/CourbeSolde'
import { Montant } from '../ui/Montant'

/**
 * Où mène une échéance.
 *
 * Un mouvement déjà écrit s'ouvre pour être corrigé ou catégorisé ; une
 * occurrence encore à venir mène à l'abonnement qui la produit, puisque c'est
 * lui qu'il faudrait changer. Une échéance sans origine connue ne mène nulle
 * part — et sa ligne ne fait alors pas semblant d'être cliquable.
 */
function destination(echeance: EcheanceProjetee): string | null {
  if (echeance.mouvement) return `/mouvements/${echeance.mouvement.id}`
  if (echeance.reference) return `/abonnements/${echeance.reference.subscription_id}`
  return null
}

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
/**
 * Ce qu'un jour porte : le cumul et le détail, montants non mis en forme.
 *
 * Chaque ligne garde **où elle mène**. Une échéance qu'on voit sans pouvoir
 * l'ouvrir est une impasse : on vient justement au calendrier pour tomber sur
 * une dépense et lui donner un poste, et une liste qui ne répond pas au doigt
 * donne l'impression que l'application est cassée.
 */
type LigneJour = {
  total: number
  lignes: { nom: string; montant_cents: Cents; vers: string | null }[]
}

export function Calendrier() {
  const formater = useFormatMontant()
  const { etat } = useEtat()
  const jour = aujourdhui()
  const compteId = compteCourantEffectif(etat)
  const [decalage, setDecalage] = useState(0)
  /** Jour mis en avant, ou `null` pour tout le mois. */
  const [jourChoisi, setJourChoisi] = useState<string | null>(null)

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
        vers: destination(echeance),
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

  /**
   * Les jours à détailler : celui qu'on a choisi, ou tout le mois.
   *
   * Le détail est déplié ligne à ligne plutôt que résumé par jour : c'est
   * chaque opération qu'on vient ouvrir, et un cumul « 14 · trois échéances »
   * ne mène nulle part.
   */
  const jours = useMemo(() => {
    const tries = [...parJour.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
    return jourChoisi === null ? tries : tries.filter(([date]) => date === jourChoisi)
  }, [parJour, jourChoisi])

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
        <button
          type="button"
          className="secondaire"
          onClick={() => {
            setDecalage(decalage - 1)
            // Le jour choisi n'appartient plus au mois affiché : le garder
            // vaudrait une liste vide sans qu'on comprenne pourquoi.
            setJourChoisi(null)
          }}
        >
          <span aria-hidden="true">←</span>
          <span className="invisible">Mois précédent</span>
        </button>
        <strong>
          {NOMS_MOIS[mois - 1]} {annee}
        </strong>
        <button
          type="button"
          className="secondaire"
          onClick={() => {
            setDecalage(decalage + 1)
            setJourChoisi(null)
          }}
        >
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
          const classes = [
            'case-jour',
            date === jour ? 'aujourdhui' : '',
            ferie !== null ? 'ferie' : '',
            date === jourChoisi ? 'choisi' : '',
          ]
            .filter(Boolean)
            .join(' ')
          // Chaque jour est un bouton, y compris ceux qui ne portent rien : une
          // case qui répond « rien ce jour-là » renseigne, une case qui ne
          // répond pas laisse croire à une panne.
          return (
            <button
              key={date}
              type="button"
              className={classes}
              aria-pressed={date === jourChoisi}
              aria-label={`${rang + 1} ${NOMS_MOIS[mois - 1]}${ferie !== null ? `, ${ferie}` : ''}${
                echeance ? `, ${enTexte(echeance).join(', ')}` : ', aucune échéance'
              }`}
              onClick={() => setJourChoisi(date === jourChoisi ? null : date)}
            >
              <span className="numero">{rang + 1}</span>
              {echeance && (
                <span
                  aria-hidden="true"
                  className={`pastille ${echeance.total < 0 ? 'sortie' : 'entree'}`}
                >
                  {echeance.total < 0 ? '−' : '+'}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {(parJour.size > 0 || jourChoisi !== null) && (
        <div className="carte">
          <h2>
            {jourChoisi === null
              ? 'Échéances du mois'
              : `Échéances du ${Number(jourChoisi.slice(8))} ${NOMS_MOIS[mois - 1]}`}
          </h2>

          {jourChoisi !== null && (
            <div className="actions">
              <button type="button" className="secondaire" onClick={() => setJourChoisi(null)}>
                Voir tout le mois
              </button>
            </div>
          )}

          {jours.length === 0 ? (
            <p className="discret">Aucune échéance ce jour-là.</p>
          ) : (
            <ul className="liste">
              {jours.map(([date, ligne]) =>
                ligne.lignes.map((detail, rang) => (
                  <li key={`${date}-${String(rang)}`}>
                    {detail.vers === null ? (
                      <span>
                        {date.slice(8)} · {detail.nom}
                      </span>
                    ) : (
                      <Link to={detail.vers}>
                        {date.slice(8)} · {detail.nom}
                      </Link>
                    )}
                    <Montant valeur={detail.montant_cents} />
                  </li>
                )),
              )}
            </ul>
          )}
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
