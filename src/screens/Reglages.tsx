import { useRef, useState } from 'react'
import { useEtat } from '../app/useEtat'
import { depotCourant, recharger } from '../app/magasin'
import type { EtatPersistance } from '../storage/persistance'

/**
 * Réglages.
 *
 * L'export est livré ici dès le lot 4, avant tout écran de saisie : la règle du
 * plan est qu'aucune donnée réelle ne doit être saisie avant que le filet
 * existe. L'ordre des lots s'y plie.
 */
export function Reglages({ persistance }: { persistance: EtatPersistance }) {
  const { journal, rejets } = useEtat()
  const [message, setMessage] = useState<string | null>(null)
  const [occupe, setOccupe] = useState(false)
  const champFichier = useRef<HTMLInputElement>(null)

  async function exporter() {
    const depot = depotCourant()
    if (!depot) return
    setOccupe(true)
    try {
      const texte = await depot.exporterTexte()
      const lien = document.createElement('a')
      lien.href = URL.createObjectURL(new Blob([texte], { type: 'application/json' }))
      lien.download = `ingenious-${new Date().toISOString().slice(0, 10)}.json`
      lien.click()
      URL.revokeObjectURL(lien.href)
      setMessage(`${journal.length} événements exportés.`)
    } finally {
      setOccupe(false)
    }
  }

  async function importer(fichier: File) {
    const depot = depotCourant()
    if (!depot) return
    setOccupe(true)
    try {
      const resultat = await depot.importer(await fichier.text())
      await recharger()
      setMessage(
        `${resultat.ajoutes} ajoutés, ${resultat.deja} déjà présents` +
          (resultat.rejets.length > 0 ? `, ${resultat.rejets.length} refusés.` : '.'),
      )
    } catch (erreur) {
      setMessage(erreur instanceof Error ? erreur.message : String(erreur))
    } finally {
      setOccupe(false)
    }
  }

  return (
    <main className="page">
      <header>
        <h1>Réglages</h1>
      </header>

      <div className="carte">
        <h2>Sauvegarde</h2>
        <p className="discret">
          Sans serveur, l’export est le seul filet. Le fichier produit est le journal lui-même, en
          clair : relisible dans dix ans avec n’importe quel outil.
        </p>
        <div className="actions">
          <button type="button" onClick={() => void exporter()} disabled={occupe}>
            Exporter
          </button>
          <input
            ref={champFichier}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const fichier = e.target.files?.[0]
              if (fichier) void importer(fichier)
              // Remis à zéro pour que réimporter le même fichier redéclenche l'événement.
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="secondaire"
            onClick={() => champFichier.current?.click()}
            disabled={occupe}
          >
            Importer
          </button>
        </div>
        {message !== null && (
          <p className="discret" role="status">
            {message}
          </p>
        )}
      </div>

      <div className="carte">
        <h2>Stockage</h2>
        <p className="discret">
          Persistance accordée par le navigateur :{' '}
          <strong>{persistance.accorde ? 'oui' : 'non'}</strong>. Installée sur l’écran d’accueil :{' '}
          <strong>{persistance.installee ? 'oui' : 'non'}</strong>.
        </p>
        {!persistance.installee && (
          <p className="avertissement">
            <strong>À faire :</strong> installer l’application sur l’écran d’accueil. Sur iPhone,
            c’est la seule protection contre l’effacement des données après quelques jours sans
            ouverture.
          </p>
        )}
      </div>

      <div className="carte">
        <h2>Journal</h2>
        <p className="discret">{journal.length} événements.</p>
        {rejets.length > 0 && (
          <p className="erreur-champ">
            {rejets.length} enregistrement(s) illisible(s) : {rejets[0]!.raison}
          </p>
        )}
      </div>
    </main>
  )
}
