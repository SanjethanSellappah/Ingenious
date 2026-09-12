import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4206'
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
await page.fill('#abo-nom-0', 'Loyer')
await page.locator('.carte:has(#abo-nom-0) input[inputmode="decimal"]').fill('700')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

// Un second compte, pour éprouver l'archivage avec abonnement rattaché.
await page.goto(base + '#/comptes/nouveau', { waitUntil: 'networkidle' })
await page.fill('#nom-compte-form', 'Livret A')
await page.fill('input[inputmode="decimal"]', '5000')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Patrimoine")')

// Un abonnement rattaché au livret.
await page.goto(base + '#/abonnements/nouveau', { waitUntil: 'networkidle' })
await page.fill('#nom-abo', 'Assurance')
await page.fill('input[inputmode="decimal"]', '25')
await page.selectOption('#compte-abo', { label: 'Livret A' })
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Abonnements")')
dit(
  '1.',
  'coût mensuel avant archivage : ' +
    (await page.locator('.montant-principal').first().textContent())?.trim(),
)

// On archive le livret.
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
await page.click('.carte-lien:has-text("Livret A")')
await page.click('a:has-text("Modifier")')
await page.waitForSelector('h1:has-text("Modifier le compte")')
await page.click('button:has-text("Archiver ce compte")')
const mention = await page
  .locator('.carte:has(h2:text("Clôturer")) .avertissement')
  .textContent()
  .catch(() => null)
dit('2.', 'avertissement : ' + (mention?.replace(/\s+/g, ' ').trim().slice(0, 90) ?? 'ABSENT'))
await page.click('button:has-text("Oui, archiver")')
await page.waitForSelector('h1:has-text("Patrimoine")')

await page.goto(base + '#/abonnements', { waitUntil: 'networkidle' })
dit(
  '3.',
  'coût mensuel après archivage : ' +
    (await page.locator('.montant-principal').first().textContent())?.trim(),
)
const etats = await page.locator('.carte:has(a:has-text("Modifier")) h2').allTextContents()
dit('4.', 'abonnements : ' + JSON.stringify(etats.map((t) => t.replace(/\s+/g, ' ').trim())))

// --- Hors ligne, application complète ---
await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await ctx.setOffline(true)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('nav.onglets', { timeout: 10000 })
dit('5.', 'hors ligne, accueil : ' + (await page.locator('h1').textContent()))

const routes = ['#/calendrier', '#/comptes', '#/depenses', '#/abonnements', '#/reglages']
for (const route of routes) {
  await page.goto(base + route, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(250)
  const titre = await page.locator('h1').textContent()
  dit('  ', `hors ligne ${route.padEnd(14)} → ${titre}`)
}

// Écriture hors ligne : une dépense doit s'enregistrer.
await page.goto(base + '#/ajout', { waitUntil: 'domcontentloaded' })
await page.fill('input[inputmode="decimal"]', '19,90')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Reste à vivre")')
dit(
  '6.',
  'écriture hors ligne : ' +
    (await page.locator('.montant-principal').first().textContent())?.trim(),
)
await ctx.setOffline(false)

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
