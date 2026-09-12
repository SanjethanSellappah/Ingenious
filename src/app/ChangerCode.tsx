import { useState } from 'react'
import { changerPin, ouvrirCoffre, PinIncorrect, type MetaCoffre } from '../storage/crypto'
import { PIN_LONGUEUR_MIN, type Verrou } from './verrou'

/**
 * Changement de code.
 *
 * Aucune donnée n'est re-chiffrée : seule l'enveloppe de la clé est refaite.
 * C'est tout l'intérêt du chiffrement à enveloppe — sans lui, changer de code
 * imposerait de réécrire la base entière, opération longue pendant laquelle une
 * interruption laisserait la moitié des enregistrements illisibles.
 */
export function ChangerCode({
  verrou,
  onChange,
  onAnnuler,
}: {
  verrou: Verrou
  onChange: (meta: MetaCoffre) => void
  onAnnuler: () => void
}) {
  const [ancien, setAncien] = useState('')
  const [nouveau, setNouveau] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  const correspond = nouveau !== '' && nouveau === confirmation
  const valide = ancien !== '' && correspond && nouveau.length >= PIN_LONGUEUR_MIN

  async function valider() {
    if (!valide || verrou.meta === null) return
    setOccupe(true)
    setErreur(null)
    try {
      // Le coffre est rouvert avec l'ancien code : c'est la vérification, et
      // elle échoue avant que quoi que ce soit ne soit modifié.
      const coffre = await ouvrirCoffre(ancien, verrou.meta)
      onChange(await changerPin(coffre, ancien, nouveau))
    } catch (cause) {
      setErreur(
        cause instanceof PinIncorrect
          ? 'Code actuel incorrect.'
          : cause instanceof Error
            ? cause.message
            : String(cause),
      )
    } finally {
      setOccupe(false)
    }
  }

  return (
    <main className="page">
      <header>
        <h1>Changer le code</h1>
        <p>Aucune donnée n’est re-chiffrée : seule la clé change d’enveloppe.</p>
      </header>

      <div className="champ">
        <label htmlFor="code-ancien">Code actuel</label>
        <input
          id="code-ancien"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          value={ancien}
          onChange={(e) => setAncien(e.target.value.replace(/\D/g, ''))}
        />
      </div>

      <div className="champ">
        <label htmlFor="code-nouveau">Nouveau code</label>
        <input
          id="code-nouveau"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          value={nouveau}
          onChange={(e) => setNouveau(e.target.value.replace(/\D/g, ''))}
        />
      </div>

      <div className="champ">
        <label htmlFor="code-confirmation">Répéter le nouveau code</label>
        <input
          id="code-confirmation"
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

      {erreur !== null && (
        <p className="erreur-champ" role="alert">
          {erreur}
        </p>
      )}

      <div className="actions">
        <button type="button" className="secondaire" onClick={onAnnuler} disabled={occupe}>
          Annuler
        </button>
        <button type="button" onClick={() => void valider()} disabled={!valide || occupe}>
          {occupe ? 'Changement…' : 'Changer le code'}
        </button>
      </div>
    </main>
  )
}
