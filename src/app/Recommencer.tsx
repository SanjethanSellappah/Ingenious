import { useState } from 'react'
import type { BaseIngenious } from '../storage/db'

/**
 * Repartir de zéro après un code oublié.
 *
 * Le code est irrécupérable, c'est une décision assumée. Mais sans cette issue,
 * l'appareil resterait verrouillé **pour toujours** — y compris pour quelqu'un
 * qui tient sa sauvegarde en main. L'export est présenté comme le filet ; il
 * faut donc qu'il existe un endroit où le lancer.
 *
 * Ce que l'écran ne fait pas : proposer de « récupérer » quoi que ce soit. Il
 * efface, il le dit trois fois, et il exige de le recopier à la main — pas une
 * case à cocher, qu'on coche sans lire.
 */
const PHRASE = 'EFFACER'

export function Recommencer({
  base,
  onEfface,
  onAnnuler,
}: {
  base: BaseIngenious
  onEfface: () => void
  onAnnuler: () => void
}) {
  const [saisie, setSaisie] = useState('')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function effacer() {
    if (saisie.trim().toUpperCase() !== PHRASE) return
    setOccupe(true)
    setErreur(null)
    try {
      // Les deux tables, pas seulement le journal : laisser le coffre en place
      // rendrait l'application inutilisable une fois les données parties.
      await base.events.clear()
      await base.meta.clear()
      onEfface()
    } catch (cause) {
      setErreur(cause instanceof Error ? cause.message : String(cause))
      setOccupe(false)
    }
  }

  return (
    <main className="page">
      <header>
        <h1>Code oublié</h1>
      </header>

      <div className="carte">
        <p className="avertissement">
          <strong>Il n’existe aucune récupération.</strong> Le code chiffre les données de cet
          appareil ; sans lui, elles sont définitivement illisibles, y compris pour cette
          application.
        </p>
        <p>
          La seule chose à faire est d’effacer cet appareil et de repartir d’un export. Si vous n’en
          avez aucun, tout sera perdu.
        </p>
        <p className="discret">
          Après effacement, l’application redémarrera comme au premier jour. Vous pourrez alors
          importer un fichier de sauvegarde depuis Réglages.
        </p>
      </div>

      <div className="champ">
        <label htmlFor="phrase-effacement">
          Pour confirmer, recopiez <strong>{PHRASE}</strong>
        </label>
        <input
          id="phrase-effacement"
          value={saisie}
          autoComplete="off"
          autoCapitalize="characters"
          onChange={(e) => setSaisie(e.target.value)}
        />
      </div>

      {erreur !== null && (
        <p className="erreur-champ" role="alert">
          {erreur}
        </p>
      )}

      <div className="actions">
        <button type="button" className="secondaire" onClick={onAnnuler} disabled={occupe}>
          Revenir au code
        </button>
        <button
          type="button"
          onClick={() => void effacer()}
          disabled={occupe || saisie.trim().toUpperCase() !== PHRASE}
        >
          {occupe ? 'Effacement…' : 'Effacer cet appareil'}
        </button>
      </div>
    </main>
  )
}
