import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { aujourdhui } from '../core/clock'
import { dateCivile, estDateCivile } from '../core/civilDate'
import { negatif, type Cents } from '../core/money'
import { ecrire } from '../app/magasin'
import { useEtat } from '../app/useEtat'
import { normaliserNom } from '../domain/etat'
import { identifiant } from '../domain/identifiant'
import { labelParNom } from '../domain/selecteurs'
import { SaisieMontant } from '../ui/SaisieMontant'

type Sens = 'sortie' | 'entree' | 'virement'

/**
 * Ajout rapide.
 *
 * **Le montant d'abord.** C'est le seul champ obligatoire, et c'est celui qu'on
 * connaît en sortant du magasin. Tout le reste a un défaut raisonnable : la
 * date d'aujourd'hui, le compte courant, aucun label. Labelliser est un bonus,
 * pas une condition — c'est la réconciliation hebdomadaire qui garantit la
 * justesse du solde, pas l'exhaustivité de la saisie.
 */
export function Ajout() {
  const { etat } = useEtat()
  const naviguer = useNavigate()
  const jour = aujourdhui()

  const comptes = useMemo(
    () => [...etat.comptes.values()].filter((compte) => compte.archived_at === undefined),
    [etat.comptes],
  )
  const labels = useMemo(
    () => [...etat.labels.values()].filter((label) => label.archived_at === undefined),
    [etat.labels],
  )

  // Le sens peut être imposé par le lien d'arrivée : venir de « Virement »
  // depuis l'écran Comptes doit ouvrir directement le bon formulaire.
  const [parametres] = useSearchParams()
  const sensInitial = parametres.get('sens')
  const [sens, setSens] = useState<Sens>(
    sensInitial === 'virement' || sensInitial === 'entree' ? sensInitial : 'sortie',
  )
  const [montant, setMontant] = useState<Cents | null>(null)
  const [date, setDate] = useState(jour)
  const [compteId, setCompteId] = useState(etat.reglages.compte_courant_id ?? comptes[0]?.id ?? '')
  const [versCompteId, setVersCompteId] = useState(
    comptes.find((compte) => compte.id !== compteId)?.id ?? '',
  )
  const [labelId, setLabelId] = useState('')
  const [nouveauLabel, setNouveauLabel] = useState('')
  const [note, setNote] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const valide =
    montant !== null &&
    montant !== 0 &&
    compteId !== '' &&
    (sens !== 'virement' || (versCompteId !== '' && versCompteId !== compteId))

  async function enregistrer() {
    if (!valide || montant === null) return
    setOccupe(true)
    setErreur(null)
    try {
      const entrees: Parameters<typeof ecrire>[0][number][] = []
      let labelRetenu = labelId

      // Un label saisi à la volée est créé s'il n'existe pas déjà sous une autre
      // casse : « courses », « Courses » et « COURSES » sont le même label.
      const nom = nouveauLabel.trim()
      if (sens !== 'virement' && nom !== '') {
        const existant = labelParNom(etat, nom)
        if (existant) {
          labelRetenu = existant.id
        } else {
          labelRetenu = identifiant(`label-${normaliserNom(nom).replace(/[^a-z0-9]+/g, '-')}`)
          entrees.push({
            type: 'label.created',
            payload: { id: labelRetenu, nom, couleur: '#4ade80' },
          })
        }
      }

      if (sens === 'virement') {
        entrees.push({
          type: 'transfer.created',
          payload: {
            id: identifiant('virement'),
            date,
            from_account_id: compteId,
            to_account_id: versCompteId,
            montant_cents: Math.abs(montant),
            ...(note.trim() !== '' ? { note: note.trim() } : {}),
          },
        })
      } else {
        entrees.push({
          type: 'transaction.created',
          payload: {
            id: identifiant('transaction'),
            account_id: compteId,
            date,
            montant_cents: sens === 'sortie' ? negatif(absolu(montant)) : absolu(montant),
            origine: 'manuel',
            ...(labelRetenu !== '' ? { label_id: labelRetenu } : {}),
            ...(note.trim() !== '' ? { note: note.trim() } : {}),
          },
        })
      }

      await ecrire(entrees)
      void naviguer('/')
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setOccupe(false)
    }
  }

  return (
    <main className="page">
      <header>
        <h1>Ajout rapide</h1>
      </header>

      <SaisieMontant libelle="Montant" onChange={setMontant} autoFocus />

      <div className="segments" role="group" aria-label="Nature du mouvement">
        {(
          [
            ['sortie', 'Sortie'],
            ['entree', 'Entrée'],
            ['virement', 'Virement'],
          ] as const
        ).map(([valeur, libelle]) => (
          <button
            key={valeur}
            type="button"
            aria-pressed={sens === valeur}
            onClick={() => setSens(valeur)}
          >
            {libelle}
          </button>
        ))}
      </div>

      <div className="champ">
        <label htmlFor="compte">{sens === 'virement' ? 'Depuis le compte' : 'Compte'}</label>
        <select id="compte" value={compteId} onChange={(e) => setCompteId(e.target.value)}>
          {comptes.map((compte) => (
            <option key={compte.id} value={compte.id}>
              {compte.nom}
            </option>
          ))}
        </select>
      </div>

      {sens === 'virement' && (
        <div className="champ">
          <label htmlFor="vers">Vers le compte</label>
          <select id="vers" value={versCompteId} onChange={(e) => setVersCompteId(e.target.value)}>
            <option value="">—</option>
            {comptes
              .filter((compte) => compte.id !== compteId)
              .map((compte) => (
                <option key={compte.id} value={compte.id}>
                  {compte.nom}
                </option>
              ))}
          </select>
        </div>
      )}

      {sens !== 'virement' && (
        <>
          {labels.length > 0 && (
            <div className="raccourcis" role="group" aria-label="Labels fréquents">
              {labels.slice(0, 8).map((label) => (
                <button
                  key={label.id}
                  type="button"
                  aria-pressed={labelId === label.id}
                  onClick={() => {
                    setLabelId(labelId === label.id ? '' : label.id)
                    setNouveauLabel('')
                  }}
                >
                  {label.nom}
                </button>
              ))}
            </div>
          )}
          <div className="champ">
            <label htmlFor="nouveau-label">Nouveau label</label>
            <input
              id="nouveau-label"
              value={nouveauLabel}
              autoComplete="off"
              placeholder="laisser vide pour ne pas catégoriser"
              onChange={(e) => {
                setNouveauLabel(e.target.value)
                if (e.target.value !== '') setLabelId('')
              }}
            />
          </div>
        </>
      )}

      <div className="champ">
        <label htmlFor="date">Date</label>
        <input
          id="date"
          type="date"
          value={date}
          onChange={(e) => {
            // Un champ `date` vidé rend une chaîne vide : on ne la laisse pas
            // passer pour une date civile, le journal la refuserait à l'écriture.
            if (estDateCivile(e.target.value)) setDate(dateCivile(e.target.value))
          }}
        />
      </div>

      <div className="champ">
        <label htmlFor="note">Note</label>
        <input
          id="note"
          value={note}
          autoComplete="off"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {erreur !== null && (
        <p className="erreur-champ" role="alert">
          {erreur}
        </p>
      )}

      <div className="actions">
        <button type="button" className="secondaire" onClick={() => void naviguer('/')}>
          Annuler
        </button>
        <button type="button" onClick={() => void enregistrer()} disabled={!valide || occupe}>
          {occupe ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </main>
  )
}

function absolu(montant: Cents): Cents {
  return Math.abs(montant) as Cents
}
