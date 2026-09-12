import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { aujourdhui } from '../core/clock'
import { formaterMontant, valeurAbsolue, type Cents } from '../core/money'
import { ecrire } from '../app/magasin'
import { useEtat } from '../app/useEtat'
import { occurrencesAConfirmer } from '../domain/vues'
import { Montant } from '../ui/Montant'
import { SaisieMontant } from '../ui/SaisieMontant'

/**
 * Confirmation des occurrences échues, et régularisation.
 *
 * Saisir le montant réel **remplace** celui de l'occurrence, il n'ajoute pas de
 * seconde ligne. C'est la différence avec la réconciliation : là-bas l'écart est
 * une dépense réellement non saisie, ici il n'existe qu'un seul salaire, donc une
 * seule ligne. L'écart avec l'estimation est affiché à titre d'information, sans
 * être matérialisé en écriture.
 *
 * La valeur confirmée entre ensuite dans la fenêtre glissante et affine les
 * estimations suivantes.
 */
export function Confirmer() {
  const { etat } = useEtat()
  const naviguer = useNavigate()
  const jour = aujourdhui()
  const aConfirmer = occurrencesAConfirmer(etat, jour)

  return (
    <main className="page">
      <header>
        <h1>À confirmer</h1>
        <p>
          Ces échéances sont passées sans que leur montant réel soit connu. Tant qu’elles ne le sont
          pas, elles n’entrent ni dans le solde ni dans la courbe.
        </p>
      </header>

      {aConfirmer.length === 0 ? (
        <div className="carte">
          <p>Rien à confirmer.</p>
          <p className="discret">Tout est à jour.</p>
        </div>
      ) : (
        aConfirmer.map((echeance) => (
          <LigneAConfirmer
            key={`${echeance.reference!.subscription_id}@${echeance.reference!.date_theorique}`}
            libelle={echeance.libelle ?? 'Échéance'}
            date={echeance.date}
            attendu={echeance.montant_cents}
            estime={echeance.estime}
            montantConnu={echeance.montantConnu}
            subscriptionId={echeance.reference!.subscription_id}
            dateTheorique={echeance.reference!.date_theorique}
          />
        ))
      )}

      <div className="actions">
        <button type="button" className="secondaire" onClick={() => void naviguer('/')}>
          Retour à l’accueil
        </button>
      </div>
    </main>
  )
}

function LigneAConfirmer({
  libelle,
  date,
  attendu,
  estime,
  montantConnu,
  subscriptionId,
  dateTheorique,
}: {
  libelle: string
  date: string
  attendu: Cents
  estime: boolean
  montantConnu: boolean
  subscriptionId: string
  dateTheorique: string
}) {
  // Sans montant attendu, il n'y a rien à valider : la saisie s'ouvre d'emblée.
  const [ouvert, setOuvert] = useState(!montantConnu)
  const [reel, setReel] = useState<Cents | null>(null)
  const [exclu, setExclu] = useState(false)
  const [occupe, setOccupe] = useState(false)

  const ecart = reel === null ? null : valeurAbsolue(reel) - valeurAbsolue(attendu)

  async function confirmer(montant: Cents) {
    setOccupe(true)
    try {
      await ecrire([
        {
          type: 'occurrence.overridden',
          payload: {
            subscription_id: subscriptionId,
            date_theorique: dateTheorique,
            // Le signe est porté par le sens de la récurrence : on n'enregistre
            // que la valeur absolue, et la résolution le resigne.
            montant_cents: Math.abs(montant),
            statut: 'realise',
            ...(exclu ? { exclu_de_estimation: true } : {}),
          },
        },
      ])
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div className="carte">
      <h2>{libelle}</h2>
      <p className="discret">
        Prévue le {date}
        {montantConnu ? (
          <>
            {' · '}
            <Montant valeur={attendu} />
            {estime && ' · estimée'}
          </>
        ) : (
          <> · montant inconnu, à renseigner</>
        )}
      </p>

      {!ouvert ? (
        <div className="actions">
          <button type="button" onClick={() => void confirmer(attendu)} disabled={occupe}>
            Confirmer ce montant
          </button>
          <button type="button" className="secondaire" onClick={() => setOuvert(true)}>
            Montant différent
          </button>
        </div>
      ) : (
        <>
          <SaisieMontant libelle="Montant réel" onChange={setReel} autoFocus />
          {ecart !== null && ecart !== 0 && (
            <p className="discret">
              Écart avec l’estimation : {formaterMontant(Math.abs(ecart) as Cents)}{' '}
              {ecart > 0 ? 'de plus' : 'de moins'} que prévu. L’occurrence est corrigée, aucune
              seconde ligne n’est créée.
            </p>
          )}
          <label className="case">
            <input type="checkbox" checked={exclu} onChange={(e) => setExclu(e.target.checked)} />
            Écarter de l’estimation (prime, régularisation, rappel)
          </label>
          <div className="actions">
            {montantConnu && (
              <button type="button" className="secondaire" onClick={() => setOuvert(false)}>
                Annuler
              </button>
            )}
            <button
              type="button"
              onClick={() => reel !== null && void confirmer(reel)}
              disabled={reel === null || occupe}
            >
              Enregistrer
            </button>
          </div>
        </>
      )}
    </div>
  )
}
