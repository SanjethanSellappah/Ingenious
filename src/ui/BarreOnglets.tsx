import { NavLink } from 'react-router-dom'

/**
 * Navigation principale : cinq onglets, pas un de plus.
 *
 * L'onglet actif se signale par la couleur **et** par un trait et une graisse :
 * jamais par la couleur seule.
 */
const ONGLETS = [
  { to: '/', libelle: 'Accueil', pictogramme: '🏠' },
  { to: '/calendrier', libelle: 'Calendrier', pictogramme: '📅' },
  { to: '/ajout', libelle: 'Ajout', pictogramme: '➕' },
  { to: '/comptes', libelle: 'Comptes', pictogramme: '🏦' },
  { to: '/reglages', libelle: 'Réglages', pictogramme: '⚙️' },
] as const

export function BarreOnglets() {
  return (
    <nav className="onglets" aria-label="Navigation principale">
      {ONGLETS.map(({ to, libelle, pictogramme }) => (
        <NavLink key={to} to={to} end={to === '/'}>
          <span className="pictogramme" aria-hidden="true">
            {pictogramme}
          </span>
          {libelle}
        </NavLink>
      ))}
    </nav>
  )
}
