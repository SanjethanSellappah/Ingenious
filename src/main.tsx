import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { ecouterInstallation } from './app/installation'
import './ui/styles.css'

// Avant React, et ce n'est pas un détail de style : le navigateur décide seul du
// moment où il propose l'installation, parfois avant que le premier composant
// n'existe. Poser l'écouteur dans un effet, c'est accepter de manquer
// l'invitation selon la vitesse de démarrage — et de n'avoir aucun bouton à
// offrir, sans jamais savoir pourquoi.
ecouterInstallation()

const racine = document.getElementById('root')
if (!racine) throw new Error('Élément #root introuvable')

createRoot(racine).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
