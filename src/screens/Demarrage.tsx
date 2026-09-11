import type { CSSProperties } from 'react'
import { aujourdhui } from '../core/clock'

/**
 * Écran d'attente du lot 0. Il ne sert qu'à constater que la chaîne complète
 * fonctionne : build, base de déploiement, routage, installation en PWA. Il est
 * remplacé par l'accueil au lot 5.
 */
export function Demarrage() {
  return (
    <main style={styles.page}>
      <h1 style={styles.titre}>Ingenious</h1>
      <p style={styles.sous}>Suivi de finances personnelles, hors ligne et sans serveur.</p>
      <div style={styles.carte}>
        <p style={styles.ligne}>
          Fondations en place. Le noyau de calcul arrive au lot&nbsp;1, la saisie au lot&nbsp;5.
        </p>
        <p style={styles.date}>
          <span aria-hidden="true">📅</span> Date de l’appareil : {aujourdhui()}
        </p>
      </div>
    </main>
  )
}

const styles = {
  page: {
    maxWidth: '32rem',
    margin: '0 auto',
    padding: '2rem 1.25rem',
  },
  titre: {
    margin: '0 0 0.25rem',
    fontSize: '1.75rem',
    letterSpacing: '-0.02em',
  },
  sous: {
    margin: '0 0 2rem',
    color: 'var(--encre-faible)',
  },
  carte: {
    background: 'var(--fond-carte)',
    border: '1px solid var(--trait)',
    borderRadius: '0.875rem',
    padding: '1rem 1.125rem',
  },
  ligne: {
    margin: '0 0 0.75rem',
  },
  date: {
    margin: 0,
    color: 'var(--encre-faible)',
    fontSize: '0.9375rem',
  },
} satisfies Record<string, CSSProperties>
