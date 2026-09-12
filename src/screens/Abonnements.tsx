import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ajouterJours, dateCivile, estDateCivile, type CivilDate } from '../core/civilDate'
import { aujourdhui } from '../core/clock'
import { type Cents } from '../core/money'
import { useFormatMontant } from '../app/discretion'
import { montantValideA, dernierChangement } from '../core/prixAbonnement'
import { prochainesOccurrences, type RegleRecurrence } from '../core/recurrence'
import { ecrire } from '../app/magasin'
import { useEtat } from '../app/useEtat'
import type { Abonnement } from '../domain/etat'
import { Montant } from '../ui/Montant'
import { SaisieMontant } from '../ui/SaisieMontant'
import { identifiant } from '../domain/identifiant'
import { resoudreLabel, type ChoixLabel as Choix } from '../domain/labels'
import { ChoixLabel } from '../ui/ChoixLabel'

/**
 * Liste des abonnements.
 *
 * Le coût mensuel cumulé est le chiffre qui fait réagir : personne ne décide
 * d'arrêter un abonnement à 9,99 €, beaucoup décident en voyant 147 € par mois.
 * Le coût annuel est affiché à côté, parce que douze fois neuf euros ne se
 * calcule pas de tête au moment où on en aurait besoin.
 */
export function Abonnements() {
  const formater = useFormatMontant()
  const { etat } = useEtat()
  const jour = aujourdhui()
  const abonnements = useMemo(() => [...etat.abonnements.values()], [etat.abonnements])
  const { mensuel, annuel } = useMemo(() => coutCumule(abonnements, jour), [abonnements, jour])

  return (
    <main className="page">
      <header>
        <h1>Abonnements</h1>
      </header>

      <div className="carte">
        <h2>Coût récurrent</h2>
        <Montant valeur={mensuel} principal neutre />
        <p className="discret">par mois, soit {formater(annuel)} par an</p>
      </div>

      {abonnements.length === 0 && (
        <div className="carte">
          <p className="discret">Aucun abonnement enregistré.</p>
        </div>
      )}

      {abonnements.map((abonnement) => {
        const changement = dernierChangement(abonnement.prix)
        // Un tarif unique n'est pas un changement, c'est le tarif. Sans ce test,
        // tout abonnement fraîchement créé s'annonçait « tarif modifié » — un
        // avertissement pour une modification qui n'a jamais eu lieu.
        const recent =
          abonnement.prix.length > 1 &&
          changement !== null &&
          changement.valide_du > ajouterJours(dateCivile(jour), -62)
        return (
          <div className="carte" key={abonnement.id}>
            <h2>
              {abonnement.nom}
              {!abonnement.actif && <span className="discret"> · terminé</span>}
            </h2>
            <p className="discret">
              {resume(abonnement)} ·{' '}
              {abonnement.montant_mode === 'estime'
                ? 'montant estimé'
                : formater(montantValideA(abonnement.prix, dateCivile(jour)) ?? (0 as Cents))}
            </p>
            {recent && changement !== null && (
              <p className="avertissement">
                <strong>Tarif modifié</strong> le {changement.valide_du} :{' '}
                {formater(changement.montant_cents)}. Les échéances antérieures gardent l’ancien
                montant.
              </p>
            )}
            <Link to={`/abonnements/${abonnement.id}`} className="lien-action">
              Modifier
            </Link>
          </div>
        )
      })}

      <div className="actions">
        <Link to="/abonnements/nouveau" className="lien-bouton">
          Nouvel abonnement
        </Link>
      </div>
    </main>
  )
}

/**
 * Coût mensuel équivalent.
 *
 * Un abonnement trimestriel compte pour un tiers, un annuel pour un douzième.
 * Les montants estimés ne sont pas comptés : additionner des estimations
 * donnerait un total faussement précis. Ils sont signalés à part.
 */
function coutCumule(
  abonnements: readonly Abonnement[],
  jour: string,
): { mensuel: Cents; annuel: Cents } {
  let mensuel = 0
  for (const abonnement of abonnements) {
    if (!abonnement.actif || abonnement.sens !== 'depense') continue
    if (abonnement.montant_mode === 'estime') continue
    const montant = montantValideA(abonnement.prix, dateCivile(jour))
    if (montant === null) continue
    const intervalle = abonnement.regle.intervalle ?? 1
    const parAn =
      abonnement.regle.frequence === 'annuel'
        ? 1 / intervalle
        : abonnement.regle.frequence === 'trimestriel'
          ? 4 / intervalle
          : 12 / intervalle
    mensuel += (montant * parAn) / 12
  }
  return { mensuel: Math.round(mensuel) as Cents, annuel: Math.round(mensuel * 12) as Cents }
}

function resume(abonnement: Abonnement): string {
  const { frequence, intervalle = 1, jour_du_mois } = abonnement.regle
  const periode =
    frequence === 'mensuel'
      ? intervalle === 1
        ? 'tous les mois'
        : `tous les ${intervalle} mois`
      : frequence === 'trimestriel'
        ? 'tous les trimestres'
        : frequence === 'annuel'
          ? 'tous les ans'
          : `tous les ${intervalle} ${abonnement.regle.unite_intervalle ?? 'mois'}`
  return jour_du_mois !== undefined ? `${periode}, le ${jour_du_mois}` : periode
}

/**
 * Formulaire d'abonnement.
 *
 * L'aperçu des trois prochaines échéances est la partie qui compte : une règle
 * de récurrence est abstraite, trois dates ne le sont pas. C'est là qu'on voit
 * qu'un prélèvement « le 31 » tombera le 28 en février, ou qu'un « 1er » sera
 * avancé au vendredi précédent.
 */
export function FormulaireAbonnement() {
  const { etat } = useEtat()
  const { id } = useParams()
  const naviguer = useNavigate()
  const jour = aujourdhui()

  const existant = id !== undefined && id !== 'nouveau' ? etat.abonnements.get(id) : undefined
  const comptes = [...etat.comptes.values()].filter((compte) => compte.archived_at === undefined)

  const [nom, setNom] = useState(existant?.nom ?? '')
  const [compteId, setCompteId] = useState(
    existant?.account_id ?? etat.reglages.compte_courant_id ?? comptes[0]?.id ?? '',
  )
  const [sens, setSens] = useState<'depense' | 'rentree'>(existant?.sens ?? 'depense')
  const [mode, setMode] = useState<'fixe' | 'estime'>(existant?.montant_mode ?? 'fixe')
  const [montant, setMontant] = useState<Cents | null>(
    existant ? (montantValideA(existant.prix, dateCivile(jour)) ?? null) : null,
  )
  const [frequence, setFrequence] = useState<RegleRecurrence['frequence']>(
    existant?.regle.frequence ?? 'mensuel',
  )
  const [intervalle, setIntervalle] = useState(existant?.regle.intervalle ?? 1)
  const [jourDuMois, setJourDuMois] = useState(existant?.regle.jour_du_mois ?? 1)
  const [regleWeekend, setRegleWeekend] = useState<NonNullable<RegleRecurrence['regle_weekend']>>(
    existant?.regle.regle_weekend ?? 'exact',
  )
  const [regleMoisCourt, setRegleMoisCourt] = useState<
    NonNullable<RegleRecurrence['regle_mois_court']>
  >(existant?.regle.regle_mois_court ?? 'dernier_jour')
  const [label, setLabel] = useState<Choix>({
    labelId: existant?.label_id ?? '',
    nouveauNom: '',
  })
  const [dateDebut, setDateDebut] = useState<CivilDate>(existant?.regle.date_debut ?? jour)
  const [occupe, setOccupe] = useState(false)

  const regle: RegleRecurrence = {
    frequence,
    intervalle,
    jour_du_mois: jourDuMois,
    regle_weekend: regleWeekend,
    regle_mois_court: regleMoisCourt,
    date_debut: dateDebut,
  }

  const apercu = useMemo(() => {
    try {
      return prochainesOccurrences(regle, dateCivile(jour), 3)
    } catch {
      return []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequence, intervalle, jourDuMois, regleWeekend, regleMoisCourt, dateDebut, jour])

  const valide = nom.trim() !== '' && compteId !== '' && (mode === 'estime' || montant !== null)

  async function enregistrer() {
    if (!valide) return
    setOccupe(true)
    try {
      const abonnementId = existant?.id ?? identifiant('abonnement')
      // Le label est résolu d'abord : s'il faut le créer, son événement doit
      // précéder l'abonnement qui s'y rattache.
      const { labelId: labelRetenu, entrees: creationLabel } = resoudreLabel(etat, label)
      const entrees: Parameters<typeof ecrire>[0][number][] = [
        ...creationLabel,
        {
          type: existant ? 'subscription.updated' : 'subscription.created',
          payload: {
            id: abonnementId,
            nom: nom.trim(),
            account_id: compteId,
            sens,
            montant_mode: mode,
            frequence,
            intervalle,
            jour_du_mois: jourDuMois,
            regle_weekend: regleWeekend,
            regle_mois_court: regleMoisCourt,
            date_debut: dateDebut,
            actif: true,
            ...(labelRetenu !== '' ? { label_id: labelRetenu } : {}),
          },
        },
      ]
      // Un tarif n'est écrit que s'il change : réécrire le même montant créerait
      // une période inutile et brouillerait l'historique.
      const actuel = existant ? montantValideA(existant.prix, dateCivile(jour)) : null
      if (mode === 'fixe' && montant !== null && montant !== actuel) {
        entrees.push({
          type: 'subscription.price_changed',
          payload: {
            subscription_id: abonnementId,
            montant_cents: Math.abs(montant),
            // À la création, le tarif vaut depuis le début de l'abonnement — un
            // loyer saisi aujourd'hui coûtait déjà cela le mois dernier. Sinon
            // toutes les échéances antérieures resteraient sans montant, et
            // l'application les réclamerait sans raison. Un changement ultérieur,
            // lui, ne vaut qu'à partir d'aujourd'hui : c'est ce qui empêche une
            // hausse de réécrire le passé.
            valide_du: existant ? jour : dateDebut < jour ? dateDebut : jour,
          },
        })
      }
      await ecrire(entrees)
      void naviguer('/abonnements')
    } finally {
      setOccupe(false)
    }
  }

  async function terminer() {
    if (!existant) return
    setOccupe(true)
    try {
      await ecrire([
        {
          type: 'subscription.ended',
          payload: { subscription_id: existant.id, date_fin: jour },
        },
      ])
      void naviguer('/abonnements')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <main className="page">
      <header>
        <h1>{existant ? 'Modifier' : 'Nouvel abonnement'}</h1>
      </header>

      <div className="champ">
        <label htmlFor="nom-abo">Nom</label>
        <input
          id="nom-abo"
          value={nom}
          autoComplete="off"
          onChange={(e) => setNom(e.target.value)}
        />
      </div>

      <div className="segments" role="group" aria-label="Sens">
        <button type="button" aria-pressed={sens === 'depense'} onClick={() => setSens('depense')}>
          Dépense
        </button>
        <button type="button" aria-pressed={sens === 'rentree'} onClick={() => setSens('rentree')}>
          Rentrée
        </button>
      </div>

      <div className="segments" role="group" aria-label="Montant">
        <button type="button" aria-pressed={mode === 'fixe'} onClick={() => setMode('fixe')}>
          Montant fixe
        </button>
        <button type="button" aria-pressed={mode === 'estime'} onClick={() => setMode('estime')}>
          Variable
        </button>
      </div>

      {mode === 'fixe' ? (
        <SaisieMontant
          libelle="Montant"
          onChange={setMontant}
          {...(montant !== null ? { valeurInitiale: montant } : {})}
        />
      ) : (
        <p className="discret">
          Le montant sera la médiane des dernières occurrences confirmées. Tant qu’aucune ne l’est,
          l’échéance est réclamée à l’accueil plutôt que devinée.
        </p>
      )}

      <div className="champ">
        <label htmlFor="compte-abo">Compte</label>
        <select id="compte-abo" value={compteId} onChange={(e) => setCompteId(e.target.value)}>
          {comptes.map((compte) => (
            <option key={compte.id} value={compte.id}>
              {compte.nom}
            </option>
          ))}
        </select>
      </div>

      {sens === 'depense' && (
        <>
          <ChoixLabel etat={etat} valeur={label} onChange={setLabel} id="label-abo" />
          <p className="discret">
            Une fois l’échéance confirmée, son montant compte dans ce poste de dépense — sans avoir
            à la saisir une seconde fois.
          </p>
        </>
      )}

      <div className="champ">
        <label htmlFor="frequence">Fréquence</label>
        <select
          id="frequence"
          value={frequence}
          onChange={(e) => setFrequence(e.target.value as RegleRecurrence['frequence'])}
        >
          <option value="mensuel">Mensuelle</option>
          <option value="trimestriel">Trimestrielle</option>
          <option value="annuel">Annuelle</option>
          <option value="personnalise">Personnalisée</option>
        </select>
      </div>

      {frequence === 'personnalise' && (
        <div className="champ">
          <label htmlFor="intervalle">Tous les combien de mois</label>
          <input
            id="intervalle"
            type="number"
            inputMode="numeric"
            min={1}
            max={120}
            value={intervalle}
            onChange={(e) => setIntervalle(Math.max(1, Number(e.target.value)))}
          />
        </div>
      )}

      <div className="champ">
        <label htmlFor="jour-mois">Jour du mois</label>
        <input
          id="jour-mois"
          type="number"
          inputMode="numeric"
          min={1}
          max={31}
          value={jourDuMois}
          onChange={(e) => setJourDuMois(Math.min(31, Math.max(1, Number(e.target.value))))}
        />
      </div>

      <div className="champ">
        <label htmlFor="weekend">Si le jour tombe un week-end ou un férié</label>
        <select
          id="weekend"
          value={regleWeekend}
          onChange={(e) =>
            setRegleWeekend(e.target.value as NonNullable<RegleRecurrence['regle_weekend']>)
          }
        >
          <option value="exact">Garder la date exacte</option>
          <option value="jour_ouvre_precedent">Avancer au jour ouvré précédent</option>
          <option value="jour_ouvre_suivant">Reporter au jour ouvré suivant</option>
        </select>
      </div>

      <div className="champ">
        <label htmlFor="mois-court">Si le mois est trop court</label>
        <select
          id="mois-court"
          value={regleMoisCourt}
          onChange={(e) =>
            setRegleMoisCourt(e.target.value as NonNullable<RegleRecurrence['regle_mois_court']>)
          }
        >
          <option value="dernier_jour">Prendre le dernier jour du mois</option>
          <option value="ignorer">Passer ce mois</option>
        </select>
      </div>

      <div className="champ">
        <label htmlFor="debut">Première échéance à partir du</label>
        <input
          id="debut"
          type="date"
          value={dateDebut}
          onChange={(e) => {
            if (estDateCivile(e.target.value)) setDateDebut(dateCivile(e.target.value))
          }}
        />
      </div>

      <div className="carte">
        <h2>Trois prochaines échéances</h2>
        {apercu.length === 0 ? (
          <p className="discret">Aucune échéance à venir avec cette règle.</p>
        ) : (
          <ul className="liste">
            {apercu.map((occurrence) => (
              <li key={occurrence.date_theorique}>
                <span>{occurrence.date_affichee}</span>
                {occurrence.date_affichee !== occurrence.date_theorique && (
                  <span className="discret">décalée depuis le {occurrence.date_theorique}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="actions">
        <button type="button" className="secondaire" onClick={() => void naviguer('/abonnements')}>
          Annuler
        </button>
        <button type="button" onClick={() => void enregistrer()} disabled={!valide || occupe}>
          Enregistrer
        </button>
      </div>

      {existant?.actif === true && (
        <div className="actions">
          <button
            type="button"
            className="secondaire"
            onClick={() => void terminer()}
            disabled={occupe}
          >
            Cet abonnement est terminé
          </button>
        </div>
      )}
    </main>
  )
}
