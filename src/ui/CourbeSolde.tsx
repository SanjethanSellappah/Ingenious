import { useId, useMemo, useState } from 'react'
import { type Cents } from '../core/money'
import { useFormatMontant } from '../app/discretion'
import type { PointDeSerie, Projection } from '../core/projection'
import { jourEtMois } from './dates'

/**
 * Courbe de solde projeté.
 *
 * **Écrite en SVG plutôt qu'avec Recharts**, contrairement à ce que prévoyait le
 * contexte. La raison tient à la forme même de la courbe : trait plein jusqu'à la
 * première occurrence estimée, pointillé au-delà, et une bande de fourchette qui
 * ne commence qu'à cet endroit. Découper une série en deux segments et y
 * superposer une aire partielle se fait, dans une bibliothèque de graphiques, à
 * coups de séries fantômes remplies de `null` — plus de code que le tracé direct,
 * et un résultat plus fragile. S'y ajoute le poids : sept mégaoctets décompressés
 * pour une courbe, sur une application qui doit démarrer hors ligne.
 *
 * Ce qui est respecté : un seul axe, une seule série donc pas de légende, un
 * trait de 2 px, une aire à faible opacité, une grille en retrait, et **aucune
 * information portée par la seule couleur** — le point bas porte sa date et son
 * montant en toutes lettres sous le graphique.
 */
export function CourbeSolde({
  projection,
  hauteur = 160,
}: {
  projection: Projection
  hauteur?: number
}) {
  const formater = useFormatMontant()
  const id = useId()
  const [rangSurvol, setRangSurvol] = useState<number | null>(null)

  const serie = projection.serie
  const geometrie = useMemo(() => calculer(serie, hauteur), [serie, hauteur])
  if (geometrie === null) return null

  const { x, y, largeur, min, max, zeroY } = geometrie

  // La coupure est le premier point incertain. Le segment qui **y mène** est
  // déjà incertain — c'est lui qui porte l'échéance estimée — donc le trait
  // plein s'arrête juste avant, et le pointillé reprend au point précédent pour
  // que la courbe reste continue. Tracer ce bond en trait plein reviendrait à
  // présenter l'estimation comme un fait.
  const premiereIncertaine = serie.findIndex((point) => point.incertain)
  const coupure = premiereIncertaine === -1 ? serie.length : premiereIncertaine
  const debutIncertain = Math.max(0, coupure - 1)
  const certain = serie.slice(0, coupure)
  const incertain = premiereIncertaine === -1 ? [] : serie.slice(debutIncertain)

  /** Chemin d'une tranche, `depart` étant son rang dans la série entière. */
  const chemin = (points: readonly PointDeSerie[], depart: number): string =>
    points
      .map((point, rang) => `${rang === 0 ? 'M' : 'L'}${x(depart + rang)},${y(point.solde_cents)}`)
      .join(' ')

  const bande =
    incertain.length > 1
      ? [
          ...incertain.map(
            (point, rang) =>
              `${rang === 0 ? 'M' : 'L'}${x(debutIncertain + rang)},${y(point.borne_haute_cents)}`,
          ),
          ...incertain
            .map((point, rang) => `L${x(debutIncertain + rang)},${y(point.borne_basse_cents)}`)
            .reverse(),
          'Z',
        ].join(' ')
      : ''

  const rangPointBas = serie.findIndex((point) => point.date === projection.pointBas.date)
  const survol = rangSurvol === null ? null : (serie[rangSurvol] ?? null)

  return (
    <figure className="courbe">
      <div className="courbe-trace">
        <svg
          viewBox={`0 0 ${largeur} ${hauteur}`}
          preserveAspectRatio="none"
          role="img"
          aria-labelledby={`${id}-titre`}
          onPointerMove={(evenement) => {
            const boite = evenement.currentTarget.getBoundingClientRect()
            const rang = Math.round(
              ((evenement.clientX - boite.left) / boite.width) * (serie.length - 1),
            )
            setRangSurvol(Math.min(Math.max(rang, 0), serie.length - 1))
          }}
          onPointerLeave={() => setRangSurvol(null)}
        >
          <title id={`${id}-titre`}>
            Solde projeté entre {formater(min)} et {formater(max)} sur {serie.length} jours. Point
            bas le {projection.pointBas.date} à {formater(projection.pointBas.solde_cents)}.
          </title>

          {/* Le zéro n'est tracé que s'il est dans le champ : une ligne hors sujet
            prend de la place et fait croire à une limite qui n'existe pas. */}
          {zeroY !== null && (
            <line x1={0} x2={largeur} y1={zeroY} y2={zeroY} className="courbe-zero" />
          )}

          {bande !== '' && <path d={bande} className="courbe-bande" />}
          <path d={chemin(certain, 0)} className="courbe-trait" />
          {incertain.length > 1 && (
            <path d={chemin(incertain, debutIncertain)} className="courbe-trait courbe-pointille" />
          )}

          {rangPointBas !== -1 && (
            <circle
              cx={x(rangPointBas)}
              cy={y(serie[rangPointBas]!.solde_cents)}
              r={4}
              className="courbe-point-bas"
            />
          )}
          {survol !== null && rangSurvol !== null && (
            <>
              <line
                x1={x(rangSurvol)}
                x2={x(rangSurvol)}
                y1={0}
                y2={hauteur}
                className="courbe-curseur"
              />
              <circle
                cx={x(rangSurvol)}
                cy={y(survol.solde_cents)}
                r={4}
                className="courbe-curseur-point"
              />
            </>
          )}
        </svg>
        <span className="courbe-axe courbe-axe-haut" aria-hidden="true">
          {formater(max)}
        </span>
        <span className="courbe-axe courbe-axe-bas" aria-hidden="true">
          {formater(min)}
        </span>
      </div>

      {/* Les dates sous l'axe horizontal, les montants sur l'axe vertical.
          Rendus côte à côte, le plus haut et le plus bas solde se lisaient comme
          un début et une fin de période : on croyait voir le solde d'aujourd'hui
          à droite et la prévision à gauche, soit exactement l'inverse du tracé. */}
      <p className="courbe-dates" aria-hidden="true">
        <span>{jourEtMois(serie[0]!.date)}</span>
        <span className="discret">aujourd’hui → dans {serie.length - 1} jours</span>
        <span>{jourEtMois(serie[serie.length - 1]!.date)}</span>
      </p>

      <figcaption>
        {survol !== null ? (
          <>
            <strong>{jourEtMois(survol.date)}</strong> · {formater(survol.solde_cents)}
            {survol.incertain && (
              <span className="discret">
                {' '}
                — entre {formater(survol.borne_basse_cents)} et {formater(survol.borne_haute_cents)}
              </span>
            )}
          </>
        ) : (
          <>
            Point bas le <strong>{jourEtMois(projection.pointBas.date)}</strong> à{' '}
            <strong>{formater(projection.pointBas.solde_cents)}</strong>
            {projection.premiereEstimation !== null && (
              <span className="discret">
                {' '}
                · estimé à partir du {jourEtMois(projection.premiereEstimation)}
              </span>
            )}
          </>
        )}
      </figcaption>
    </figure>
  )
}

/** Échelles et bornes du tracé. `null` quand il n'y a rien à tracer. */
function calculer(serie: readonly PointDeSerie[], hauteur: number) {
  if (serie.length < 2) return null
  const largeur = 320
  const marge = 6
  // Une gouttière horizontale : sans elle le trait est coupé net par le bord du
  // cadre, et le dernier point paraît sortir du graphique.
  const gouttiere = 4

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const point of serie) {
    min = Math.min(min, point.borne_basse_cents, point.solde_cents)
    max = Math.max(max, point.borne_haute_cents, point.solde_cents)
  }
  // Une série plate ne doit produire ni division par zéro, ni courbe collée au
  // bord : on lui donne un peu d'air.
  if (max - min < 100) {
    const centre = (max + min) / 2
    min = centre - 50
    max = centre + 50
  }

  return {
    // L'abscisse se déduit du rang, jamais d'une recherche dans la série : un
    // `indexOf` par point rendrait le tracé quadratique.
    x: (rang: number) => gouttiere + (rang / (serie.length - 1)) * (largeur - gouttiere * 2),
    y: (valeur: number) => hauteur - marge - ((valeur - min) / (max - min)) * (hauteur - marge * 2),
    largeur,
    min: min as Cents,
    max: max as Cents,
    zeroY:
      min <= 0 && max >= 0
        ? hauteur - marge - ((0 - min) / (max - min)) * (hauteur - marge * 2)
        : null,
  }
}
