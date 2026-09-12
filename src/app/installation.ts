/**
 * Installation sur l'écran d'accueil.
 *
 * Une application installée n'est pas un confort : c'est ce qui la sort du
 * ménage que fait le navigateur dans les données des sites qu'on ne visite plus.
 * L'écran Réglages le demandait déjà — sans offrir le moindre moyen de le faire.
 * Un avertissement qu'aucun écran ne résout n'est pas un avertissement, c'est
 * une impasse.
 *
 * Chrome, sur Android et sur ordinateur, propose l'installation par un événement
 * qu'il faut **capter et retenir** : il n'est émis qu'une fois, au chargement,
 * bien avant que l'utilisateur n'ouvre Réglages. Safari sur iOS n'émet rien du
 * tout — là, l'installation passe par le menu de partage, et l'écran le dit.
 */

type EvenementInstallation = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let invite: EvenementInstallation | null = null
const abonnes = new Set<() => void>()

function prevenir(): void {
  for (const abonne of abonnes) abonne()
}

/** À appeler une fois, au démarrage, avant que l'événement ne passe. */
export function ecouterInstallation(): () => void {
  if (typeof window === 'undefined') return () => undefined

  const surInvite = (evenement: Event) => {
    // Sans cela, Chrome affiche sa propre barre : on préfère un bouton dans
    // l'écran qui explique pourquoi il est là.
    evenement.preventDefault()
    invite = evenement as EvenementInstallation
    prevenir()
  }
  const surInstallee = () => {
    invite = null
    prevenir()
  }

  window.addEventListener('beforeinstallprompt', surInvite)
  window.addEventListener('appinstalled', surInstallee)
  return () => {
    window.removeEventListener('beforeinstallprompt', surInvite)
    window.removeEventListener('appinstalled', surInstallee)
  }
}

export function sabonnerInstallation(abonne: () => void): () => void {
  abonnes.add(abonne)
  return () => abonnes.delete(abonne)
}

/** Vrai quand le navigateur nous a confié une invitation à installer. */
export function installationProposee(): boolean {
  return invite !== null
}

/**
 * Ouvre la fenêtre d'installation du navigateur.
 *
 * L'invitation ne sert qu'une fois : qu'elle soit acceptée ou refusée, elle est
 * consommée. On l'oublie donc dans les deux cas, plutôt que de laisser un bouton
 * qui ne ferait plus rien.
 */
export async function installer(): Promise<'acceptee' | 'refusee' | 'indisponible'> {
  if (invite === null) return 'indisponible'
  const courante = invite
  invite = null
  prevenir()
  try {
    await courante.prompt()
    const { outcome } = await courante.userChoice
    return outcome === 'accepted' ? 'acceptee' : 'refusee'
  } catch {
    return 'indisponible'
  }
}
