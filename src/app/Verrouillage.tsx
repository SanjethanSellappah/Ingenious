import { useEffect, useState } from 'react'
import { maintenant } from '../core/clock'
import { deverrouiller, PIN_LONGUEUR_MIN, type Verrou } from './verrou'

/**
 * Écran de verrouillage.
 *
 * Il ne raconte rien d'autre que ce qu'il sait : « code incorrect », et le temps
 * restant avant un nouvel essai. Pas de compteur d'essais restants — il n'y a
 * aucune sanction au bout, et l'afficher ferait croire le contraire.
 */
export function Verrouillage({
  verrou,
  onVerrou,
  onOuvert,
  onOublie,
}: {
  verrou: Verrou
  onVerrou: (verrou: Verrou) => void
  onOuvert: (verrou: Verrou) => void
  onOublie: () => void
}) {
  const [pin, setPin] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [occupe, setOccupe] = useState(false)
  // Le compte à rebours ne se stocke pas : il se calcule au rendu, et un tic
  // périodique se contente de redemander un rendu. Stocker la valeur obligerait
  // à la poser depuis l'effet, ce qui déclenche des rendus en cascade.
  const [, setTic] = useState(0)

  const attenteJusqua = verrou.etat.statut === 'verrouille' ? verrou.etat.attenteJusqua : 0
  const reste = Math.max(0, attenteJusqua - maintenant())

  useEffect(() => {
    if (attenteJusqua <= maintenant()) return
    const intervalle = setInterval(() => {
      if (maintenant() >= attenteJusqua) clearInterval(intervalle)
      setTic((n) => n + 1)
    }, 250)
    return () => clearInterval(intervalle)
  }, [attenteJusqua])

  async function essayer(evenement: React.FormEvent) {
    evenement.preventDefault()
    setOccupe(true)
    setMessage(null)
    try {
      const resultat = await deverrouiller(verrou, pin, maintenant())
      if (resultat.ok) {
        onOuvert(resultat.verrou)
        return
      }
      setPin('')
      onVerrou(resultat.verrou)
      setMessage(
        resultat.raison === 'trop_tot'
          ? `Encore ${Math.ceil(resultat.resteMs / 1000)} s avant un nouvel essai.`
          : 'Code incorrect.',
      )
    } finally {
      setOccupe(false)
    }
  }

  const bloque = reste > 0
  return (
    // Un `main` autour du formulaire : c'est le premier écran de quiconque a un
    // code, et sans repère de page un lecteur d'écran n'a nulle part où sauter.
    <main className="verrou">
      <form onSubmit={(evenement) => void essayer(evenement)}>
        <h1>Ingenious</h1>
        <p className="discret">Entrez votre code pour ouvrir l’application.</p>
        <div>
          <label htmlFor="pin">Code</label>
          <input
            id="pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            aria-describedby={message ? 'verrou-message' : undefined}
          />
        </div>
        {message !== null && (
          <p className="erreur-champ" id="verrou-message" role="alert">
            {message}
          </p>
        )}
        <button type="submit" disabled={occupe || bloque || pin.length < PIN_LONGUEUR_MIN}>
          {bloque ? `Patientez ${Math.ceil(reste / 1000)} s` : occupe ? 'Vérification…' : 'Ouvrir'}
        </button>
        <p className="discret">
          Le code chiffre les données de cet appareil. Il n’est récupérable par aucun moyen.
        </p>
        <button type="button" className="secondaire" onClick={onOublie}>
          Code oublié
        </button>
      </form>
    </main>
  )
}
