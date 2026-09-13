/**
 * Lanceur des audits de navigateur.
 *
 * Ces audits ne remplacent pas les tests unitaires, ils trouvent autre chose.
 * Presque tous les défauts sérieux de ce projet — perte de données à
 * l'activation du code, import qui ne finissait jamais, identifiants qui
 * entraient en collision entre deux appareils, écriture refusée en silence — ont
 * été trouvés en conduisant l'application dans un vrai navigateur, pas en
 * lisant ses tests. C'est pourquoi ils sont versionnés ici plutôt que jetés
 * après usage.
 *
 * Le site est **reconstruit** à chaque lancement, et un échec de compilation
 * arrête tout : `vite preview` sert `dist/`, pas les sources.
 *
 *   npm run audit          les audits rapides
 *   npm run audit -- --tous   tout, y compris les longs
 *   npm run audit -- a11y fusion   ceux qu'on nomme
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ICI = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT_AUDIT ?? '4192'

/** Les longs sont écartés par défaut : ils se comptent en minutes. */
const LONGS = new Set(['volume', 'interruption'])

const TOUS = [
  'a11y',
  'a11y-clair',
  'a11y-verrou',
  'a11y-onboarding',
  'debordement',
  'hostile',
  'export',
  'restauration',
  'fusion',
  'panne',
  'stockage',
  'reverrou',
  'reconciliation',
  'releve',
  'extremes',
  'installation',
  'signales',
  'discretion',
  'investissement',
  'parcours',
  'code',
  'pin',
  'comptes',
  'confirmer',
  'correction',
  'effet',
  'occurrence',
  'horsligne',
  'rappel',
  'volume',
  'interruption',
]

const args = process.argv.slice(2)
const tout = args.includes('--tous')
const nommes = args.filter((a) => !a.startsWith('--'))
const choisis = nommes.length > 0 ? nommes : TOUS.filter((n) => tout || !LONGS.has(n))

function lancer(commande, arguments_, options = {}) {
  return new Promise((resoudre) => {
    const processus = spawn(commande, arguments_, { ...options, shell: false })
    let sortie = ''
    processus.stdout?.on('data', (bloc) => (sortie += bloc))
    processus.stderr?.on('data', (bloc) => (sortie += bloc))
    processus.on('close', (code) => resoudre({ code, sortie }))
  })
}

/**
 * Un audit a échoué s'il est sorti en erreur, ou s'il a nommé un problème.
 *
 * Le test porte sur ce que les scripts affichent : « erreurs : aucune » est leur
 * façon de dire qu'ils n'ont rien vu. Sans cette lecture, un script qui déroule
 * tout son scénario en signalant vingt erreurs passerait pour un succès.
 */
function aEchoue({ code, sortie }) {
  if (code !== 0) return true
  if (/PROBLEMES/.test(sortie)) return true
  if (/DÉBORDEMENT :/.test(sortie)) return true
  for (const ligne of sortie.split('\n')) {
    const m = /erreurs\s*:\s*(.+)$/.exec(ligne)
    if (m && m[1].trim() !== 'aucune') return true
  }
  return false
}

const adresse = `http://localhost:${PORT}/Ingenious/`

async function repond() {
  try {
    return (await fetch(adresse)).ok
  } catch {
    return false
  }
}

/*
 * Un serveur déjà là sur ce port est refusé, et ce n'est pas de la pudeur.
 * Vite, s'il ne peut pas prendre le port, en choisit un autre en silence —
 * pendant que les audits, eux, continuent d'interroger celui-ci. Ils passent
 * alors sur une version périmée du site : vingt et un succès qui ne veulent
 * rien dire. Le cas s'est produit.
 */
if (await repond()) {
  console.error(
    `Un serveur répond déjà sur le port ${PORT}. Arrêtez-le : les audits
` + `interrogeraient l'ancienne version du site et passeraient à tort.`,
  )
  process.exit(1)
}

const RACINE = join(ICI, '..', '..')

/*
 * Le site est reconstruit avant d'être audité, et un échec arrête tout.
 *
 * `vite preview` sert `dist/`, pas les sources : sans cette reconstruction, une
 * modification qui ne compile pas laisse le dossier intact, et les audits
 * examinent tranquillement la version d'avant. Ils passent — et ils ne
 * prouvent rien. Le cas s'est produit ici même : une faute délibérée, posée
 * pour vérifier qu'un audit savait la voir, a fait échouer `tsc` sans que rien
 * ne le dise, et l'audit l'a « réussie ».
 */
const compilation = await lancer(
  process.execPath,
  [join(RACINE, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'],
  { cwd: RACINE },
)
if (compilation.code !== 0) {
  console.error('La compilation échoue : les audits porteraient sur la version précédente.\n')
  console.error(compilation.sortie.trim().split('\n').slice(0, 12).join('\n'))
  process.exit(1)
}
const construction = await lancer(
  process.execPath,
  [join(RACINE, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
  { cwd: RACINE },
)
if (construction.code !== 0) {
  console.error('La construction échoue : les audits porteraient sur la version précédente.\n')
  console.error(construction.sortie.trim().split('\n').slice(-12).join('\n'))
  process.exit(1)
}

/*
 * Vite est lancé directement, pas par `npx`.
 *
 * `npx` engendre un enfant : le tuer laisse le serveur derrière lui, qui occupe
 * le port et fait échouer la fois suivante — ou pire, sert une version périmée
 * du site à des audits qui croient tester la nouvelle.
 */
const serveur = spawn(
  process.execPath,
  [
    join(RACINE, 'node_modules', 'vite', 'bin', 'vite.js'),
    'preview',
    '--port',
    PORT,
    '--strictPort',
  ],
  { cwd: RACINE, stdio: 'ignore' },
)
const arreter = () => {
  try {
    serveur.kill('SIGTERM')
  } catch {
    /* déjà parti */
  }
}
process.on('exit', arreter)
process.on('SIGINT', () => {
  arreter()
  process.exit(130)
})

let pret = false
for (let essai = 0; essai < 40 && !pret; essai++) {
  await new Promise((r) => setTimeout(r, 250))
  pret = await repond()
}
if (!pret) {
  console.error(`Le serveur de prévisualisation n'a pas démarré sur le port ${PORT}.`)
  arreter()
  process.exit(1)
}

let echecs = 0
for (const nom of choisis) {
  const debut = Date.now()
  // `a11y-clair` n'est pas un script : c'est le même audit dans l'autre thème.
  // Les deux palettes doivent tenir le même contraste, et rien ne le garantit
  // si l'on n'en mesure qu'une.
  const clair = nom === 'a11y-clair'
  const resultat = await lancer('node', [join(ICI, `${clair ? 'a11y' : nom}.mjs`), PORT], {
    env: { ...process.env, THEME_AUDIT: clair ? 'clair' : 'sombre' },
  })
  const secondes = ((Date.now() - debut) / 1000).toFixed(0)
  if (aEchoue(resultat)) {
    echecs += 1
    console.log(`✗ ${nom} (${secondes} s)`)
    console.log(
      resultat.sortie
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n'),
    )
  } else {
    console.log(`✓ ${nom} (${secondes} s)`)
  }
}

arreter()
console.log(echecs === 0 ? `\n${choisis.length} audits passés.` : `\n${echecs} audit(s) en échec.`)
process.exit(echecs === 0 ? 0 : 1)
