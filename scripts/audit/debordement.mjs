import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4195'
const nav = await chromium.launch(optionsNavigateur())
const ctx = await nav.newContext({ ...devices['Pixel 7'] })
const page = await ctx.newPage()
const base = `http://localhost:${PORT}/Ingenious/`

await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', 'Compte courant principal')
await page.fill('input[inputmode="decimal"]', '1234,56')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2500')
await page.click('button:has-text("Continuer")')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')
// Du contenu long, pour éprouver la mise en page.
await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '1234,56')
await page.selectOption('#nouveau-label-liste', '__nouveau__')
await page.fill('#nouveau-label', 'Alimentation et produits ménagers')
await page.fill(
  '#note',
  'Une note volontairement très longue pour éprouver la mise en page du téléphone',
)
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Reste à vivre")')

const routes = [
  '#/',
  '#/calendrier',
  '#/ajout',
  '#/comptes',
  '#/comptes/nouveau',
  '#/reglages',
  '#/abonnements',
  '#/abonnements/nouveau',
  '#/depenses',
  '#/confirmer',
  '#/reconciliation',
]
const problemes = []
for (const route of routes) {
  await page.goto(base + route, { waitUntil: 'networkidle' })
  await page.waitForTimeout(250)
  const r = await page.evaluate(() => {
    const largeur = document.documentElement.clientWidth
    const debordants = [...document.querySelectorAll('*')]
      .filter((el) => {
        const b = el.getBoundingClientRect()
        return b.width > 0 && (b.right > largeur + 1 || b.left < -1)
      })
      .map(
        (el) =>
          `${el.tagName}.${String(el.className).slice(0, 30)} → ${Math.round(el.getBoundingClientRect().right)}px`,
      )
    return {
      largeur,
      scrollHorizontal: document.documentElement.scrollWidth > largeur + 1,
      debordants: [...new Set(debordants)].slice(0, 4),
    }
  })
  if (r.scrollHorizontal || r.debordants.length)
    problemes.push(`${route} (largeur ${r.largeur}) : ${JSON.stringify(r.debordants)}`)
}

// Et avec le formulaire de budget ouvert, le cas qui a révélé le défaut.
await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.click('.carte:has(h2:text("Labels")) button:has-text("Modifier")')
await page.waitForTimeout(400)
const budget = await page.evaluate(() => {
  const largeur = document.documentElement.clientWidth
  const carte = [...document.querySelectorAll('.carte')].find(
    (c) => c.querySelector('h2')?.textContent === 'Labels',
  )
  const boutons = [...(carte?.querySelectorAll('button') ?? [])].map((b) => {
    const r = b.getBoundingClientRect()
    return {
      texte: b.textContent?.trim(),
      droite: Math.round(r.right),
      horsEcran: r.right > largeur + 1,
    }
  })
  return { largeur, boutons, scrollHorizontal: document.documentElement.scrollWidth > largeur + 1 }
})
console.log('formulaire de budget :', JSON.stringify(budget))
if (budget.boutons.some((b) => b.horsEcran)) problemes.push('budget : bouton hors écran')

console.log(problemes.length === 0 ? '\nAUCUN DÉBORDEMENT' : '\n' + problemes.join('\n'))
await nav.close()

/*
 * Le code de sortie est le verdict.
 *
 * Afficher les problèmes ne suffit pas : le lanceur ne lit pas le français, et
 * un audit qui décrit vingt fautes en sortant sur zéro passe pour un succès.
 * C'est arrivé — vingt et un audits « passés » sur une version périmée du site.
 */
process.exit(problemes.length > 0 ? 1 : 0)
