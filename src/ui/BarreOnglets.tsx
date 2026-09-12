import { NavLink } from 'react-router-dom'
import { Icone, type NomIcone } from './Icone'

/**
 * Navigation principale : cinq onglets, pas un de plus.
 *
 * L'onglet actif se signale par la couleur **et** par un trait et une graisse :
 * jamais par la couleur seule.
 */
const ONGLETS: { to: string; libelle: string; icone: NomIcone }[] = [
  { to: '/', libelle: 'Accueil', icone: 'accueil' },
  { to: '/calendrier', libelle: 'Calendrier', icone: 'calendrier' },
  { to: '/ajout', libelle: 'Ajout', icone: 'ajout' },
  { to: '/comptes', libelle: 'Comptes', icone: 'comptes' },
  { to: '/reglages', libelle: 'Réglages', icone: 'reglages' },
]

export function BarreOnglets() {
  return (
    <nav className="onglets" aria-label="Navigation principale">
      {ONGLETS.map(({ to, libelle, icone }) => (
        <NavLink key={to} to={to} end={to === '/'}>
          <Icone nom={icone} />
          {libelle}
        </NavLink>
      ))}
    </nav>
  )
}
