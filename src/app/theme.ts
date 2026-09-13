/**
 * Thème clair ou sombre.
 *
 * Trois états, pas deux : clair, sombre, et **comme le téléphone** — qui est le
 * défaut et qui suit le réglage système, y compris quand celui-ci bascule tout
 * seul à la tombée du jour. Forcer un thème est un choix, ne pas en forcer en
 * est un autre, et les confondre oblige à venir rebasculer l'application deux
 * fois par jour.
 *
 * C'est un réglage d'appareil : il vit en mémoire locale et n'entre pas dans le
 * journal. L'écran d'un téléphone n'est pas une donnée financière, et le même
 * journal lu sur une tablette n'a aucune raison d'imposer le thème du téléphone.
 */
export type Theme = 'systeme' | 'clair' | 'sombre'

const CLE = 'ingenious.theme'

let courant: Theme = lireAuDemarrage()
const abonnes = new Set<() => void>()

function estTheme(valeur: unknown): valeur is Theme {
  return valeur === 'clair' || valeur === 'sombre' || valeur === 'systeme'
}

function lireAuDemarrage(): Theme {
  try {
    const brut = localStorage.getItem(CLE)
    return estTheme(brut) ? brut : 'systeme'
  } catch {
    // Mémoire locale refusée : on suit le téléphone, ce qui est le défaut.
    return 'systeme'
  }
}

/**
 * Pose le thème sur la racine du document.
 *
 * « Comme le téléphone » retire l'attribut plutôt que d'y écrire quoi que ce
 * soit : c'est l'absence de choix explicite qui laisse `prefers-color-scheme`
 * décider, et un attribut `systeme` obligerait la feuille de style à connaître
 * un troisième cas.
 */
export function appliquerTheme(theme: Theme = courant): void {
  if (typeof document === 'undefined') return
  if (theme === 'systeme') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', theme)
}

export function themeChoisi(): Theme {
  return courant
}

export function choisirTheme(theme: Theme): void {
  courant = theme
  try {
    localStorage.setItem(CLE, theme)
  } catch {
    // Sans mémoire locale, le choix ne survit pas au rechargement : dégradé,
    // jamais bloquant.
  }
  appliquerTheme(theme)
  for (const abonne of abonnes) abonne()
}

export function sabonnerTheme(abonne: () => void): () => void {
  abonnes.add(abonne)
  return () => abonnes.delete(abonne)
}
