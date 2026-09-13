import { useState } from 'react'
import type { CivilDate } from '../core/civilDate'
import { formaterMontant, type Cents } from '../core/money'
import { MILLIEMES } from '../core/valorisation'
import { ecrire } from '../app/magasin'
import { useEtat } from '../app/useEtat'
import { identifiant } from '../domain/identifiant'
import { valorisationDuCompte } from '../domain/selecteurs'
import type { Compte, Etat, GenreInstrument, UniteInstrument } from '../domain/etat'
import { Montant } from '../ui/Montant'
import { SaisieMontant } from '../ui/SaisieMontant'

/**
 * Les lignes d'un compte calculé.
 *
 * Ce qu'on détient, et non ce qu'on vaut : le PEA n'a pas de solde qu'on
 * relèverait, il a douze parts d'un ETF dont le cours bouge sans nous. La valeur
 * s'en déduit, elle ne se saisit pas.
 *
 * Le cours est daté et sa date est montrée. Une valorisation dont on ignore
 * l'âge n'apprend rien : « 4 300 € » ne veut pas dire la même chose selon qu'il
 * vient d'hier ou de mars.
 */
const GENRES: { valeur: GenreInstrument; libelle: string; unite: UniteInstrument }[] = [
  { valeur: 'etf', libelle: 'ETF', unite: 'part' },
  { valeur: 'action', libelle: 'Action', unite: 'part' },
  { valeur: 'or', libelle: 'Or', unite: 'gramme' },
]

const UNITES: { valeur: UniteInstrument; court: string; longSingulier: string }[] = [
  { valeur: 'part', court: 'part', longSingulier: 'part' },
  { valeur: 'gramme', court: 'g', longSingulier: 'gramme' },
  { valeur: 'once', court: 'oz', longSingulier: 'once' },
]

const abrege = (unite: UniteInstrument) => UNITES.find((u) => u.valeur === unite)?.court ?? 'part'

/** Une quantité se lit avec ses décimales, jamais arrondie à l'entier. */
function formaterQuantite(millimes: number): string {
  return (millimes / MILLIEMES).toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  })
}

export function FraicheurValorisation({
  etat,
  compte,
  jour,
}: {
  etat: Etat
  compte: Compte
  jour: CivilDate
}) {
  const valorisation = valorisationDuCompte(etat, compte.id, jour)

  if (valorisation.lignes.length === 0) {
    return <p className="discret">Aucune ligne déclarée : ajoutez ce que vous détenez.</p>
  }
  return (
    <>
      <p className="discret">
        {valorisation.coursLePlusAncien === null
          ? 'Aucun cours connu pour l’instant.'
          : `Au dernier cours connu, le ${valorisation.coursLePlusAncien}.`}
      </p>
      {valorisation.sansCours > 0 && (
        <p className="avertissement">
          <strong>
            {valorisation.sansCours === 1
              ? '1 ligne sans cours'
              : `${valorisation.sansCours} lignes sans cours`}
          </strong>{' '}
          : elle ne compte pas dans le total. Une valeur inconnue n’est pas zéro — la compter pour
          rien ferait baisser votre patrimoine au moment même où vous déclarez en posséder plus.
        </p>
      )}
    </>
  )
}

export function LignesDuCompte({ compte, jour }: { compte: Compte; jour: CivilDate }) {
  const { etat } = useEtat()
  const [ouvert, setOuvert] = useState(false)
  const [occupe, setOccupe] = useState(false)
  const valorisation = valorisationDuCompte(etat, compte.id, jour)

  return (
    <div className="carte">
      <h2>Ce que vous détenez</h2>

      {valorisation.lignes.length === 0 ? (
        <p className="discret">
          Déclarez une première ligne : un ETF et son nombre de parts, ou un poids d’or.
        </p>
      ) : (
        <ul className="liste">
          {valorisation.lignes.map((ligne) => {
            const instrument = etat.instruments.get(ligne.instrument_id)
            return (
              <li key={ligne.instrument_id + ligne.quantite_millimes}>
                <div className="ligne-label">
                  <span>
                    <strong>{instrument?.nom ?? 'Instrument inconnu'}</strong>
                    <span className="discret">
                      {' '}
                      · {formaterQuantite(ligne.quantite_millimes)}{' '}
                      {abrege(instrument?.unite ?? 'part')}
                      {ligne.cours !== null && <> × {formaterMontant(ligne.cours.cours_cents)}</>}
                    </span>
                  </span>
                  {ligne.valeur_cents === null ? (
                    <span className="discret">cours inconnu</span>
                  ) : (
                    <Montant valeur={ligne.valeur_cents} neutre masque={compte.masque === true} />
                  )}
                </div>
                <LigneModifiable
                  etat={etat}
                  jour={jour}
                  instrumentId={ligne.instrument_id}
                  quantiteMillimes={ligne.quantite_millimes}
                />
              </li>
            )
          })}
        </ul>
      )}

      {ouvert ? (
        <NouvelleLigne
          compte={compte}
          jour={jour}
          occupe={occupe}
          setOccupe={setOccupe}
          onFini={() => setOuvert(false)}
        />
      ) : (
        <div className="actions">
          <button type="button" className="secondaire" onClick={() => setOuvert(true)}>
            Ajouter une ligne
          </button>
        </div>
      )}
    </div>
  )
}

/** Corriger la quantité, ou relever le cours du jour. */
function LigneModifiable({
  etat,
  jour,
  instrumentId,
  quantiteMillimes,
}: {
  etat: Etat
  jour: CivilDate
  instrumentId: string
  quantiteMillimes: number
}) {
  const [ouvert, setOuvert] = useState(false)
  const [quantite, setQuantite] = useState(String(quantiteMillimes / MILLIEMES))
  const [cours, setCours] = useState<Cents | null>(null)
  const [occupe, setOccupe] = useState(false)
  const ligne = [...etat.lignes.values()].find(
    (l) => l.instrument_id === instrumentId && l.supprime !== true,
  )

  async function enregistrer() {
    if (!ligne) return
    setOccupe(true)
    try {
      const entrees: Parameters<typeof ecrire>[0][number][] = []
      const millimes = Math.round(Number(quantite.replace(',', '.')) * MILLIEMES)
      if (Number.isFinite(millimes) && millimes >= 0 && millimes !== quantiteMillimes) {
        entrees.push({
          type: 'holding.updated',
          payload: { id: ligne.id, quantite_millimes: millimes },
        })
      }
      if (cours !== null) {
        entrees.push({
          type: 'instrument.quoted',
          payload: {
            instrument_id: instrumentId,
            date: jour,
            cours_cents: Math.abs(cours),
            source: 'saisi',
          },
        })
      }
      if (entrees.length > 0) await ecrire(entrees)
      setOuvert(false)
      setCours(null)
    } finally {
      setOccupe(false)
    }
  }

  async function retirer() {
    if (!ligne) return
    setOccupe(true)
    try {
      await ecrire([{ type: 'holding.updated', payload: { id: ligne.id, supprime: true } }])
    } finally {
      setOccupe(false)
    }
  }

  if (!ouvert) {
    return (
      <div className="actions-ligne">
        <button type="button" className="secondaire" onClick={() => setOuvert(true)}>
          Modifier
        </button>
      </div>
    )
  }

  return (
    <div className="champ-imbrique">
      <div className="champ">
        <label htmlFor={`quantite-${instrumentId}`}>Quantité détenue</label>
        <input
          id={`quantite-${instrumentId}`}
          inputMode="decimal"
          value={quantite}
          autoComplete="off"
          onChange={(e) => setQuantite(e.target.value)}
        />
      </div>
      <SaisieMontant libelle="Cours du jour (facultatif)" onChange={setCours} />
      <div className="actions">
        <button
          type="button"
          className="secondaire"
          disabled={occupe}
          onClick={() => void retirer()}
        >
          Retirer
        </button>
        <button type="button" disabled={occupe} onClick={() => void enregistrer()}>
          Enregistrer
        </button>
      </div>
    </div>
  )
}

function NouvelleLigne({
  compte,
  jour,
  occupe,
  setOccupe,
  onFini,
}: {
  compte: Compte
  jour: CivilDate
  occupe: boolean
  setOccupe: (v: boolean) => void
  onFini: () => void
}) {
  const [genre, setGenre] = useState<GenreInstrument>('etf')
  const [symbole, setSymbole] = useState('')
  const [nom, setNom] = useState('')
  const [quantite, setQuantite] = useState('')
  const [cours, setCours] = useState<Cents | null>(null)

  const unite = GENRES.find((g) => g.valeur === genre)?.unite ?? 'part'
  const millimes = Math.round(Number(quantite.replace(',', '.')) * MILLIEMES)
  const valide = nom.trim() !== '' && Number.isFinite(millimes) && millimes > 0

  async function ajouter() {
    if (!valide) return
    setOccupe(true)
    try {
      const instrumentId = identifiant('instrument')
      const entrees: Parameters<typeof ecrire>[0][number][] = [
        {
          type: 'instrument.created',
          payload: {
            id: instrumentId,
            symbole: symbole.trim() === '' ? nom.trim().slice(0, 32) : symbole.trim(),
            nom: nom.trim(),
            genre,
            unite,
          },
        },
        {
          type: 'holding.created',
          payload: {
            id: identifiant('ligne'),
            account_id: compte.id,
            instrument_id: instrumentId,
            quantite_millimes: millimes,
          },
        },
      ]
      if (cours !== null) {
        entrees.push({
          type: 'instrument.quoted',
          payload: {
            instrument_id: instrumentId,
            date: jour,
            cours_cents: Math.abs(cours),
            source: 'saisi',
          },
        })
      }
      await ecrire(entrees)
      onFini()
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div className="champ-imbrique">
      <div className="champ">
        <span className="etiquette">Nature</span>
        <div className="segments" role="group" aria-label="Nature de la ligne">
          {GENRES.map((g) => (
            <button
              key={g.valeur}
              type="button"
              aria-pressed={genre === g.valeur}
              onClick={() => setGenre(g.valeur)}
            >
              {g.libelle}
            </button>
          ))}
        </div>
      </div>

      <div className="champ">
        <label htmlFor="nom-instrument">Nom</label>
        <input
          id="nom-instrument"
          value={nom}
          autoComplete="off"
          placeholder={genre === 'or' ? 'Or physique' : 'MSCI World'}
          onChange={(e) => setNom(e.target.value)}
        />
      </div>

      {genre !== 'or' && (
        <div className="champ">
          <label htmlFor="symbole-instrument">Symbole</label>
          <input
            id="symbole-instrument"
            value={symbole}
            autoComplete="off"
            placeholder="CW8"
            onChange={(e) => setSymbole(e.target.value)}
          />
          <p className="discret">
            Le code sous lequel votre courtier le désigne. Il servira à retrouver le cours.
          </p>
        </div>
      )}

      <div className="champ">
        <label htmlFor="quantite-nouvelle">
          Quantité détenue {genre === 'or' ? '(en grammes)' : '(nombre de parts)'}
        </label>
        <input
          id="quantite-nouvelle"
          inputMode="decimal"
          value={quantite}
          autoComplete="off"
          placeholder={genre === 'or' ? '31,1' : '12'}
          onChange={(e) => setQuantite(e.target.value)}
        />
      </div>

      <SaisieMontant
        libelle={genre === 'or' ? 'Cours du gramme (facultatif)' : 'Cours d’une part (facultatif)'}
        onChange={setCours}
      />

      <div className="actions">
        <button type="button" className="secondaire" onClick={onFini} disabled={occupe}>
          Annuler
        </button>
        <button type="button" onClick={() => void ajouter()} disabled={!valide || occupe}>
          Ajouter
        </button>
      </div>
    </div>
  )
}
