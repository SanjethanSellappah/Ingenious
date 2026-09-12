import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { aujourdhui } from '../core/clock'
import { soustraire, type Cents } from '../core/money'
import { useFormatMontant } from '../app/discretion'
import { ecrire } from '../app/magasin'
import { useEtat } from '../app/useEtat'
import { soldeDuCompte } from '../domain/selecteurs'
import { Montant } from '../ui/Montant'
import { SaisieMontant } from '../ui/SaisieMontant'
import { identifiant } from '../domain/identifiant'

/**
 * Réconciliation hebdomadaire.
 *
 * C'est le mécanisme central : il remplace la saisie exhaustive, qui est la
 * raison pour laquelle ce type d'application est abandonné au bout de trois
 * semaines. L'utilisateur lit son solde réel, l'application écrit l'écart.
 *
 * Deux écritures, **dans cet ordre** : d'abord l'écart en transaction « Non
 * catégorisé », ensuite la nouvelle ancre de solde. L'ordre est ce qui empêche
 * l'écart d'être compté deux fois — l'ancre le contient déjà — tout en le
 * faisant apparaître dans les dépenses du mois.
 */
export function Reconciliation() {
  const formater = useFormatMontant()
  const { etat } = useEtat()
  const naviguer = useNavigate()
  const jour = aujourdhui()

  const comptes = [...etat.comptes.values()].filter((compte) => compte.archived_at === undefined)
  const [compteId, setCompteId] = useState(etat.reglages.compte_courant_id ?? comptes[0]?.id ?? '')
  const [reel, setReel] = useState<Cents | null>(null)
  const [occupe, setOccupe] = useState(false)

  const calcule = compteId === '' ? null : soldeDuCompte(etat, compteId, jour)
  const ecart = calcule !== null && reel !== null ? soustraire(reel, calcule) : null

  async function enregistrer() {
    if (compteId === '' || reel === null || ecart === null) return
    setOccupe(true)
    try {
      const entrees: Parameters<typeof ecrire>[0][number][] = []
      if (ecart !== 0) {
        entrees.push({
          type: 'transaction.created',
          payload: {
            id: identifiant('reconciliation'),
            account_id: compteId,
            date: jour,
            montant_cents: ecart,
            origine: 'reconciliation',
            note: 'Non catégorisé',
          },
        })
      }
      entrees.push({
        type: 'account.balance_set',
        payload: { account_id: compteId, date: jour, solde_cents: reel },
      })
      await ecrire(entrees)
      void naviguer('/comptes')
    } finally {
      setOccupe(false)
    }
  }

  return (
    <main className="page">
      <header>
        <h1>Réconciliation</h1>
        <p>Relevez le solde affiché par votre banque. L’écart fera le reste.</p>
      </header>

      <div className="champ">
        <label htmlFor="compte-reconcilie">Compte</label>
        <select
          id="compte-reconcilie"
          value={compteId}
          onChange={(e) => setCompteId(e.target.value)}
        >
          {comptes.map((compte) => (
            <option key={compte.id} value={compte.id}>
              {compte.nom}
            </option>
          ))}
        </select>
      </div>

      <div className="carte">
        <h2>Solde calculé par l’application</h2>
        {calcule !== null ? <Montant valeur={calcule} neutre /> : <p className="discret">—</p>}
      </div>

      <SaisieMontant libelle="Solde réel affiché par la banque" onChange={setReel} />

      {ecart !== null && (
        <div className="carte">
          <h2>Écart</h2>
          <Montant valeur={ecart} />
          <p className="discret">
            {ecart === 0 ? (
              <>Rien à corriger : le calcul et le relevé se rejoignent déjà.</>
            ) : (
              <>
                Une transaction de {formater(ecart)} sera enregistrée sous « Non catégorisé ». Elle
                représente ce qui a été dépensé sans être saisi — labelliser reste possible plus
                tard, ce n’est pas une condition.
              </>
            )}
          </p>
        </div>
      )}

      <div className="actions">
        <button type="button" className="secondaire" onClick={() => void naviguer(-1)}>
          Annuler
        </button>
        <button
          type="button"
          onClick={() => void enregistrer()}
          disabled={reel === null || occupe || compteId === ''}
        >
          {occupe ? 'Enregistrement…' : 'Recaler le solde'}
        </button>
      </div>
    </main>
  )
}
