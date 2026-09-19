import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'

/**
 * Les impasses : ce qui s'affiche en liste sans mener nulle part.
 *
 * Le calendrier a longtemps montré des échéances sur lesquelles appuyer ne
 * faisait rien. Rien ne plantait, rien ne s'affichait de travers, cinq cents
 * tests passaient — et l'application donnait l'impression d'être cassée. Le
 * même oubli traînait sur l'accueil, l'écran le plus visité.
 *
 * Cet audit le cherche partout, à chaque construction. La règle est simple et
 * ne souffre qu'une exception, déclarée dans le code :
 *
 *   **Toute ligne de liste mène quelque part, sauf celles d'une liste marquée
 *   `liste-informative`.**
 *
 * Ce marqueur oblige à prendre le parti à l'endroit où la liste s'écrit — un
 * relevé déjà posé, une date que la règle produira — plutôt que dans une liste
 * d'exceptions enfouie ici, que personne ne rouvrirait.
 */
const PORT = process.argv[2] ?? '4192'
const base = `http://localhost:${PORT}/Ingenious/`
const nav = await chromium.launch(optionsNavigateur())
const ctx = await nav.newContext({ ...devices['Pixel 7'] })
const page = await ctx.newPage()
const erreurs = []
const problemes = []
const exiger = (condition, quoi) => {
  if (!condition) problemes.push(quoi)
}
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e).slice(0, 140)))
page.on('console', (m) => m.type() === 'error' && erreurs.push('CONSOLE ' + m.text().slice(0, 140)))
const dit = (n, v) => console.log(`${String(n).padEnd(6)} ${v}`)

const jour = (recul) =>
  new Date(Date.now() - recul * 86400000).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

const RELEVE = [
  'Date;Libelle;Montant',
  `${jour(5)};PRELEVEMENT ORANGE SA DU ${jour(5)} - REF : 4409123;-13,99`,
  `${jour(4)};VIREMENT SALAIRE;1623,00`,
  `${jour(2)};CB LECLERC ROUEN;-45,20`,
  `${jour(0)};PRELEVEMENT EDF;-78,40`,
].join('\r\n')

// --- Une application remplie : des listes vides ne prouveraient rien -------------

await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', 'Courant')
await page.fill('input[inputmode="decimal"]', '1200')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.fill('#abo-nom-0', 'Loyer')
await page.fill('input[inputmode="decimal"] >> nth=0', '780')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

await page.goto(base + '#/comptes/nouveau', { waitUntil: 'networkidle' })
await page.fill('#nom-compte-form', 'Livret')
await page.fill('input[inputmode="decimal"]', '5000')
await page.click('button:has-text("Enregistrer")')
await page.waitForTimeout(800)

await page.goto(base + '#/ajout?sens=virement', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '100')
await page.click('button:has-text("Enregistrer")')
await page.waitForTimeout(800)

await page.goto(base + '#/import-releve', { waitUntil: 'networkidle' })
await page.setInputFiles('input[type=file]', {
  name: 'releve.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(RELEVE, 'utf8'),
})
await page.waitForTimeout(1000)
await page.click('button:has-text("Importer")')
await page.waitForTimeout(1400)

/**
 * Relève les lignes de liste d'une page, et dit lesquelles ne mènent nulle part.
 *
 * Une ligne « mène quelque part » dès qu'elle contient de quoi agir : un lien,
 * un bouton, un champ. C'est volontairement large — le but n'est pas d'imposer
 * une forme, mais d'attraper les lignes qui n'offrent rien du tout.
 */
async function impasses(p) {
  return await p.evaluate(() =>
    [...document.querySelectorAll('li')]
      .filter((li) => !li.closest('.liste-informative'))
      .filter((li) => !li.querySelector('a, button, input, select, textarea'))
      .filter((li) => (li.textContent ?? '').trim() !== '')
      .map(
        (li) =>
          `[${(li.closest('.carte')?.querySelector('h2')?.textContent ?? '?').trim()}] ` +
          (li.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 56),
      ),
  )
}

async function compterLignes(p) {
  return await p.evaluate(() => document.querySelectorAll('li').length)
}

// --- Chaque écran ----------------------------------------------------------------

const identifiant = async (motif) =>
  await page.evaluate(
    (m) =>
      [...document.querySelectorAll('a')]
        .map((a) => a.getAttribute('href') ?? '')
        .find((h) => new RegExp(m).test(h)) ?? null,
    motif,
  )

await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const versCompte = await identifiant('/comptes/[^/]+$')
await page.goto(base + '#/abonnements', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const versAbonnement = await identifiant('/abonnements/[^/]+$')

const ECRANS = [
  ['accueil', '/'],
  ['calendrier', '/calendrier'],
  ['ajout', '/ajout'],
  ['comptes', '/comptes'],
  ['abonnements', '/abonnements'],
  ['dépenses', '/depenses'],
  ['confirmer', '/confirmer'],
  ['réglages', '/reglages'],
  ['réconciliation', '/reconciliation'],
  ['import', '/import-releve'],
  ['compte', versCompte?.replace('#', '') ?? null],
  ['abonnement', versAbonnement?.replace('#', '') ?? null],
]

let totalLignes = 0
let rang = 0
for (const [nom, route] of ECRANS) {
  rang += 1
  if (route === null) {
    dit(`${rang}.`, `${nom} : non atteint`)
    exiger(false, `l’écran « ${nom} » n’a pas pu être ouvert : l’audit ne le couvre pas`)
    continue
  }
  await page.goto(base + '#' + route, { waitUntil: 'networkidle' })
  await page.waitForTimeout(450)
  const lignes = await compterLignes(page)
  totalLignes += lignes
  const mortes = await impasses(page)
  dit(`${rang}.`, `${nom} : ${lignes} ligne(s), ${mortes.length} sans issue`)
  for (const morte of mortes) console.log(`         ✗ ${morte}`)
  exiger(
    mortes.length === 0,
    `${nom} : ${mortes.length} ligne(s) de liste ne mènent nulle part — ${mortes.join(' | ')}`,
  )
}

// Un audit qui ne regarde rien ne prouve rien : il faut que des listes existent.
dit(`${rang + 1}.`, 'lignes de liste examinées : ' + totalLignes)
exiger(
  totalLignes >= 15,
  `seulement ${totalLignes} lignes examinées : l’application n’a pas été assez remplie`,
)

// Et la déclaration d'exception doit rester rare, sans quoi la règle ne dit plus rien.
await page.goto(base + (versCompte ?? '#/comptes'), { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const informatives = await page.evaluate(
  () => document.querySelectorAll('.liste-informative').length,
)
dit(`${rang + 2}.`, 'listes déclarées informatives sur cet écran : ' + informatives)
exiger(
  informatives <= 1,
  `${informatives} listes informatives sur un même écran : l’exception devient la règle`,
)

console.log('\nproblèmes :', problemes.length ? problemes.join('\n  ') : 'aucun')
console.log('erreurs :', erreurs.length ? [...new Set(erreurs)].slice(0, 4).join(' | ') : 'aucune')
await nav.close()

process.exit(problemes.length > 0 || erreurs.length > 0 ? 1 : 0)
