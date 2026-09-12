import { useState } from 'react'
import { configurerPin, PIN_LONGUEUR_MIN, PIN_LONGUEUR_RECOMMANDEE, type Verrou } from './verrou'

/**
 * Configuration du code.
 *
 * L'écran dit trois choses avant de laisser choisir, parce qu'aucune ne se
 * découvre après coup sans dégât :
 *
 * - le code est **irrécupérable** ;
 * - quatre chiffres protègent d'un curieux, pas d'un adversaire outillé ;
 * - la sauvegarde exportée reste en clair, elle ne dépend pas du code.
 */
export function ConfigurationPin({
  onConfigure,
  onAnnuler,
}: {
  onConfigure: (verrou: Verrou) => void
  onAnnuler: () => void
}) {
  const [pin, setPin] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [compris, setCompris] = useState(false)
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const correspond = pin !== '' && pin === confirmation
  const valide = correspond && pin.length >= PIN_LONGUEUR_MIN && compris

  async function valider() {
    if (!valide) return
    setOccupe(true)
    setErreur(null)
    try {
      onConfigure(await configurerPin(pin))
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause))
      setOccupe(false)
    }
  }

  return (
    <main className="page">
      <header>
        <h1>Choisir un code</h1>
        <p>Il chiffre les données de cet appareil.</p>
      </header>

      <div className="carte">
        <p className="avertissement">
          <strong>Ce code n’est récupérable par aucun moyen.</strong> Si vous l’oubliez, les données
          de cet appareil sont définitivement illisibles. Seule une sauvegarde exportée — qui, elle,
          est en clair — permettrait de repartir.
        </p>
        <p className="discret">
          Un code à {PIN_LONGUEUR_MIN} chiffres, c’est dix mille possibilités : il protège de
          quelqu’un qui emprunte le téléphone, pas d’un adversaire outillé qui le garde.{' '}
          {PIN_LONGUEUR_RECOMMANDEE} chiffres sont recommandés.
        </p>
      </div>

      <div className="champ">
        <label htmlFor="pin-nouveau">Code</label>
        <input
          id="pin-nouveau"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
      </div>

      <div className="champ">
        <label htmlFor="pin-confirmation">Répéter le code</label>
        <input
          id="pin-confirmation"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value.replace(/\D/g, ''))}
          aria-invalid={confirmation !== '' && !correspond}
        />
        {confirmation !== '' && !correspond && (
          <p className="erreur-champ" role="alert">
            Les deux saisies diffèrent.
          </p>
        )}
      </div>

      <label className="case">
        <input type="checkbox" checked={compris} onChange={(e) => setCompris(e.target.checked)} />
        J’ai compris qu’un code perdu signifie des données perdues.
      </label>

      {erreur !== null && (
        <p className="erreur-champ" role="alert">
          {erreur}
        </p>
      )}

      <div className="actions">
        <button type="button" className="secondaire" onClick={onAnnuler} disabled={occupe}>
          Plus tard
        </button>
        <button type="button" onClick={() => void valider()} disabled={!valide || occupe}>
          {occupe ? 'Chiffrement…' : 'Activer le code'}
        </button>
      </div>
    </main>
  )
}
