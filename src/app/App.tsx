import { HashRouter, Route, Routes } from 'react-router-dom'
import { Demarrage } from '../screens/Demarrage'

/**
 * Routage par hash : GitHub Pages ne réécrit pas les URL vers `index.html`, et le
 * contournement par `404.html` casse le partage de lien et l'historique. Le hash
 * est servi par la même page quelle que soit la route.
 */
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Demarrage />} />
        <Route path="*" element={<Demarrage />} />
      </Routes>
    </HashRouter>
  )
}
