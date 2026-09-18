import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { dateCivile, estDateCivile, type CivilDate } from '../core/civilDate'
import { negatif, type Cents } from '../core/money'
import { ecrire } from '../app/magasin'
import { useEtat } from '../app/useEtat'
import { libelleRaccourci, resumerLibelleBancaire } from '../domain/libelleBancaire'
import type { Exception, Transaction, Virement } from '../domain/etat'
import { Montant } from '../ui/Montant'
import { SaisieMontant } from '../ui/SaisieMontant'

/**
 * Correction d'un mouvement.
 *
 * Sans cet écran, une erreur de saisie serait définitive — et la seule façon de
 * la rattraper serait la réconciliation, qui la rangerait en « Non catégorisé »
 * sans jamais dire qu'il s'agissait d'une faute de frappe.
 *
 * Corriger n'efface rien : c'est un `transaction.updated` de plus dans le
 * journal. Supprimer non plus : c'est un `transaction.deleted`, qui retire la
 * ligne de l'état sans retirer sa trace de l'histoire.
 */
export function Mouvement() {
  const { etat } = useEtat()
  const { id } = useParams()
  const naviguer = useNavigate()

  const transaction = id !== undefined ? etat.transactions.get(id) : undefined
  const virement = id !== undefined ? etat.virements.get(id) : undefined
  // Une occurrence confirmée porte comme identifiant le couple (abonnement,
  // date théorique) : c'est sa clé, et elle n'existe nulle part ailleurs.
  const exception = id !== undefined ? etat.exceptions.get(id) : undefined

  if (exception !== undefined) {
    return <CorrigerOccurrence exception={exception} />
  }

  if (!transaction && !virement) {
    return (
      <main className="page">
        <header>
          <h1>Mouvement introuvable</h1>
          <p>Il a peut-être été supprimé.</p>
        </header>
        <div className="actions">
          <button type="button" className="secondaire" onClick={() => void naviguer(-1)}>
            Retour
          </button>
        </div>
      </main>
    )
  }

  return transaction ? (
    <CorrigerTransaction transaction={transaction} />
  ) : (
    <CorrigerVirement virement={virement!} />
  )
}

function CorrigerTransaction({ transaction }: { transaction: Transaction }) {
  const { etat } = useEtat()
  const naviguer = useNavigate()
  const [montant, setMontant] = useState<Cents | null>(transaction.montant_cents)
  const [date, setDate] = useState<CivilDate>(transaction.date)
  const [labelId, setLabelId] = useState(transaction.label_id ?? '')
  /**
   * Le libellé d'origine est-il montré en entier juste au-dessus ?
   *
   * Dans ce cas le champ part **vide** : le recopier n'apporterait rien et
   * obligerait à tout effacer avant d'écrire un nom à soi. Vide, il veut dire
   * « garder le libellé de la banque », et l'invite le dit.
   */
  const brutAffiche =
    transaction.origine === 'csv' &&
    transaction.note !== undefined &&
    libelleRaccourci(transaction.note)
  const [note, setNote] = useState(brutAffiche ? '' : (transaction.note ?? ''))
  const [occupe, setOccupe] = useState(false)
  const [confirmeSuppression, setConfirmeSuppression] = useState(false)

  const sortie = transaction.montant_cents < 0
  const labels = [...etat.labels.values()].filter((label) => label.archived_at === undefined)

  async function enregistrer() {
    if (montant === null) return
    setOccupe(true)
    try {
      await ecrire([
        {
          type: 'transaction.updated',
          payload: {
            id: transaction.id,
            date,
            // Le sens d'origine est conservé : corriger un montant ne doit pas
            // transformer une dépense en rentrée par inadvertance.
            montant_cents: sortie ? negatif(absolu(montant)) : absolu(montant),
            ...(labelId !== '' ? { label_id: labelId } : {}),
            // Un champ laissé vide alors que le libellé de la banque est
            // affiché au-dessus veut dire « n'y touche pas », pas « efface-le ».
            ...(brutAffiche && note.trim() === '' ? {} : { note: note.trim() }),
          },
        },
      ])
      void naviguer(-1)
    } finally {
      setOccupe(false)
    }
  }

  async function supprimer() {
    setOccupe(true)
    try {
      await ecrire([{ type: 'transaction.deleted', payload: { id: transaction.id } }])
      void naviguer(-1)
    } finally {
      setOccupe(false)
    }
  }

  return (
    <main className="page">
      <header>
        <h1>Corriger</h1>
        <p>
          <Montant valeur={transaction.montant_cents} /> le {transaction.date}
        </p>
      </header>

      {brutAffiche && transaction.note !== undefined && (
        <div className="carte">
          <h2>Libellé de la banque</h2>
          {/* Le texte **stocké**, jamais le champ de saisie : celui-ci part vide
              pour laisser écrire un nom à soi, et s'y fier ferait disparaître la
              carte au moment précis où l'on vient y lire une référence.
              Les listes montrent une version courte, sinon une seule opération
              occupe tout l'écran ; le texte de la banque reste ici, entier,
              parce que c'est la pièce justificative et qu'un résumé n'en est
              pas une. */}
          <p className="discret">
            Affiché en liste : <strong>{resumerLibelleBancaire(transaction.note)}</strong>
          </p>
          <p className="libelle-brut">{transaction.note}</p>
        </div>
      )}

      {transaction.origine === 'reconciliation' && (
        <p className="avertissement">
          <strong>Écart de réconciliation.</strong> Le corriger désalignera le solde calculé du
          relevé que vous aviez saisi. Mieux vaut refaire une réconciliation.
        </p>
      )}

      <SaisieMontant
        libelle={sortie ? 'Montant de la sortie' : 'Montant de l’entrée'}
        valeurInitiale={absolu(transaction.montant_cents)}
        onChange={setMontant}
      />

      <div className="champ">
        <label htmlFor="date-mouvement">Date</label>
        <input
          id="date-mouvement"
          type="date"
          value={date}
          onChange={(e) => {
            if (estDateCivile(e.target.value)) setDate(dateCivile(e.target.value))
          }}
        />
      </div>

      <div className="champ">
        <label htmlFor="label-mouvement">Label</label>
        <select id="label-mouvement" value={labelId} onChange={(e) => setLabelId(e.target.value)}>
          <option value="">Non catégorisé</option>
          {labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.nom}
            </option>
          ))}
        </select>
      </div>

      <div className="champ">
        <label htmlFor="note-mouvement">Note</label>
        <input
          id="note-mouvement"
          value={note}
          autoComplete="off"
          placeholder={brutAffiche ? 'Garder le libellé de la banque' : ''}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="actions">
        <button type="button" className="secondaire" onClick={() => void naviguer(-1)}>
          Annuler
        </button>
        <button
          type="button"
          onClick={() => void enregistrer()}
          disabled={montant === null || occupe}
        >
          Enregistrer
        </button>
      </div>

      <div className="carte">
        <h2>Supprimer</h2>
        {confirmeSuppression ? (
          <>
            <p className="discret">
              La ligne disparaîtra de vos comptes. L’événement d’origine reste dans le journal :
              rien n’est réécrit, le passé reste consultable.
            </p>
            <div className="actions">
              <button
                type="button"
                className="secondaire"
                onClick={() => setConfirmeSuppression(false)}
              >
                Non, garder
              </button>
              <button type="button" onClick={() => void supprimer()} disabled={occupe}>
                Oui, supprimer
              </button>
            </div>
          </>
        ) : (
          <div className="actions">
            <button
              type="button"
              className="secondaire"
              onClick={() => setConfirmeSuppression(true)}
            >
              Supprimer ce mouvement
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

function CorrigerVirement({ virement }: { virement: Virement }) {
  const { etat } = useEtat()
  const naviguer = useNavigate()
  const [montant, setMontant] = useState<Cents | null>(virement.montant_cents)
  const [date, setDate] = useState<CivilDate>(virement.date)
  const [occupe, setOccupe] = useState(false)

  const depuis = etat.comptes.get(virement.from_account_id)?.nom ?? virement.from_account_id
  const vers = etat.comptes.get(virement.to_account_id)?.nom ?? virement.to_account_id

  async function enregistrer() {
    if (montant === null || montant === 0) return
    setOccupe(true)
    try {
      await ecrire([
        {
          type: 'transfer.updated',
          payload: { id: virement.id, date, montant_cents: absolu(montant) },
        },
      ])
      void naviguer(-1)
    } finally {
      setOccupe(false)
    }
  }

  async function supprimer() {
    setOccupe(true)
    try {
      await ecrire([{ type: 'transfer.deleted', payload: { id: virement.id } }])
      void naviguer(-1)
    } finally {
      setOccupe(false)
    }
  }

  return (
    <main className="page">
      <header>
        <h1>Corriger un virement</h1>
        <p>
          De {depuis} vers {vers}
        </p>
      </header>

      <SaisieMontant
        libelle="Montant"
        valeurInitiale={virement.montant_cents}
        onChange={setMontant}
      />

      <div className="champ">
        <label htmlFor="date-virement">Date</label>
        <input
          id="date-virement"
          type="date"
          value={date}
          onChange={(e) => {
            if (estDateCivile(e.target.value)) setDate(dateCivile(e.target.value))
          }}
        />
      </div>

      <div className="actions">
        <button type="button" className="secondaire" onClick={() => void naviguer(-1)}>
          Annuler
        </button>
        <button
          type="button"
          onClick={() => void enregistrer()}
          disabled={montant === null || montant === 0 || occupe}
        >
          Enregistrer
        </button>
      </div>

      <div className="actions">
        <button
          type="button"
          className="secondaire"
          onClick={() => void supprimer()}
          disabled={occupe}
        >
          Supprimer ce virement
        </button>
      </div>
    </main>
  )
}

/**
 * Correction d'une occurrence confirmée.
 *
 * Une confirmation saisie de travers devait pouvoir se reprendre : l'écran « à
 * confirmer » ne montre que ce qui reste à faire, donc une fois validée, une
 * occurrence n'y réapparaît jamais.
 *
 * Corriger réécrit l'exception — un seul montant, jamais une seconde ligne.
 * Annuler la confirmation efface l'exception : l'occurrence redevient une
 * prévision, et l'application la réclame de nouveau.
 */
function CorrigerOccurrence({ exception }: { exception: Exception }) {
  const { etat } = useEtat()
  const naviguer = useNavigate()
  const abonnement = etat.abonnements.get(exception.subscription_id)
  const [montant, setMontant] = useState<Cents | null>(exception.montant_cents)
  const [exclu, setExclu] = useState(exception.exclu_de_estimation === true)
  const [occupe, setOccupe] = useState(false)

  async function enregistrer() {
    if (montant === null) return
    setOccupe(true)
    try {
      await ecrire([
        {
          type: 'occurrence.overridden',
          payload: {
            subscription_id: exception.subscription_id,
            date_theorique: exception.date_theorique,
            montant_cents: Math.abs(montant),
            statut: 'realise',
            ...(exclu ? { exclu_de_estimation: true } : {}),
          },
        },
      ])
      void naviguer(-1)
    } finally {
      setOccupe(false)
    }
  }

  async function annuler() {
    setOccupe(true)
    try {
      await ecrire([
        {
          type: 'occurrence.override_cleared',
          payload: {
            subscription_id: exception.subscription_id,
            date_theorique: exception.date_theorique,
          },
        },
      ])
      void naviguer(-1)
    } finally {
      setOccupe(false)
    }
  }

  return (
    <main className="page">
      <header>
        <h1>Corriger une échéance</h1>
        <p>
          {abonnement?.nom ?? 'Abonnement'} · échéance du {exception.date_theorique}
        </p>
      </header>

      <SaisieMontant
        libelle="Montant réel"
        valeurInitiale={absolu(exception.montant_cents)}
        onChange={setMontant}
      />

      <label className="case">
        <input type="checkbox" checked={exclu} onChange={(e) => setExclu(e.target.checked)} />
        Écarter de l’estimation (prime, régularisation, rappel)
      </label>

      <div className="actions">
        <button type="button" className="secondaire" onClick={() => void naviguer(-1)}>
          Annuler
        </button>
        <button
          type="button"
          onClick={() => void enregistrer()}
          disabled={montant === null || occupe}
        >
          Enregistrer
        </button>
      </div>

      <div className="carte">
        <h2>Annuler la confirmation</h2>
        <p className="discret">
          L’échéance redeviendra une prévision, et l’application la réclamera de nouveau. Utile si
          vous aviez confirmé un prélèvement qui n’est finalement pas passé.
        </p>
        <div className="actions">
          <button
            type="button"
            className="secondaire"
            onClick={() => void annuler()}
            disabled={occupe}
          >
            Annuler la confirmation
          </button>
        </div>
      </div>
    </main>
  )
}

function absolu(montant: Cents): Cents {
  return Math.abs(montant) as Cents
}
