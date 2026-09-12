import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4218'
const nav = await chromium.launch(optionsNavigateur())
const ctx = await nav.newContext({ ...devices['Pixel 7'] })
const page = await ctx.newPage()
const erreurs = []
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e)))
page.on('console', (m) => m.type() === 'error' && erreurs.push('CONSOLE ' + m.text()))
const base = `http://localhost:${PORT}/Ingenious/`
const dit = (n, v) => console.log(`${String(n).padEnd(5)} ${v}`)

await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', 'Courant')
await page.fill('input[inputmode="decimal"]', '1200')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

const rappelPresent = async () =>
  (await page.locator('.carte:has(h2:text("Sauvegarde"))').count()) > 0
dit('1.', 'rappel sur l’accueil avant tout export : ' + (await rappelPresent()))

await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
const dl = page.waitForEvent('download', { timeout: 8000 })
await page.click('button:has-text("Exporter")')
await dl
await page.goto(base + '#/', { waitUntil: 'networkidle' })
dit('2.', 'rappel après export : ' + (await rappelPresent()))

await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '30')
await page.fill('#nouveau-label', 'courses')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Reste à vivre")')
await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.click('.carte:has(h2:text("Labels")) button:has-text("Modifier")')
await page.waitForSelector('input[id^="nom-label-"]')
dit('3.', 'nom actuel : ' + (await page.inputValue('input[id^="nom-label-"]')))
await page.fill('input[id^="nom-label-"]', 'Courses et maison')
await page.locator('.carte:has(h2:text("Labels")) h2').click()
await page.waitForTimeout(900)
dit(
  '4.',
  'après renommage : ' +
    (await page.locator('.carte:has(h2:text("Labels")) .liste li').first().textContent())
      ?.replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60),
)
await page.goto(base + '#/depenses', { waitUntil: 'networkidle' })
dit(
  '5.',
  'poste de dépense : ' + JSON.stringify(await page.locator('.ligne-label h2').allTextContents()),
)

console.log('\nerreurs :', erreurs.length ? erreurs : 'aucune')
await nav.close()

/*
 * Le code de sortie est le verdict.
 *
 * Afficher les problèmes ne suffit pas : le lanceur ne lit pas le français, et
 * un audit qui décrit vingt fautes en sortant sur zéro passe pour un succès.
 * C'est arrivé — vingt et un audits « passés » sur une version périmée du site.
 */
process.exit(erreurs.length > 0 ? 1 : 0)
