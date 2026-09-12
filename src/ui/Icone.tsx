/**
 * Jeu d'icônes.
 *
 * Dessinées plutôt qu'empruntées aux emoji : un emoji change de style, de
 * couleur et parfois de sens d'un appareil à l'autre — le 🏦 est une colonnade
 * grise ici, un immeuble bleu ailleurs — et rien ne l'accorde au reste de
 * l'interface. Ces tracés suivent la couleur du texte, s'alignent sur la même
 * grille et ne dépendent d'aucun réseau, ce que la politique de sécurité du
 * contenu imposerait de toute façon.
 *
 * Un seul style : trait de 1,75, extrémités arrondies, aucune surface pleine.
 */
export type NomIcone =
  | 'accueil'
  | 'calendrier'
  | 'ajout'
  | 'comptes'
  | 'reglages'
  | 'sauvegarde'
  | 'attente'
  | 'oeil'
  | 'oeil-barre'

const TRACES: Record<NomIcone, React.ReactNode> = {
  accueil: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V21h13V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </>
  ),
  calendrier: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  ajout: <path d="M12 5v14M5 12h14" />,
  comptes: (
    <>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 9.5V19M10 9.5V19M14 9.5V19M19 9.5V19" />
      <path d="M3 21h18" />
    </>
  ),
  // Des curseurs plutôt qu'un engrenage : à 22 px, les dents d'un engrenage se
  // confondent en un soleil. Trois glissières restent lisibles à cette taille.
  reglages: (
    <>
      <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h9M17 17h3" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="15" cy="17" r="2" />
    </>
  ),
  sauvegarde: (
    <>
      <path d="M12 3v11" />
      <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
      <path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17" />
    </>
  ),
  attente: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  oeil: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'oeil-barre': (
    <>
      <path d="M4 4.5 20 19.5" />
      <path d="M9.9 6C10.6 5.7 11.3 5.5 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.3 3.9" />
      <path d="M6.3 8.2A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1.1 0 2.1-.2 3-.6" />
      <path d="M10.2 10.4a3 3 0 0 0 3.9 4.1" />
    </>
  ),
}

export function Icone({ nom, taille = 22 }: { nom: NomIcone; taille?: number }) {
  return (
    <svg
      className="icone"
      width={taille}
      height={taille}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {TRACES[nom]}
    </svg>
  )
}
