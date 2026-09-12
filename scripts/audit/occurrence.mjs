import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4216'
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

await page.goto(base + '#/abonnements/nouveau', { waitUntil: 'networkidle' })
await page.fill('#nom-abo', 'Loyer')
await page.fill('input[inputmode="decimal"]', '700')
await page.fill('#jour-mois', '5')
await page.fill('#debut', '2026-08-05')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Abonnements")')

await page.goto(base + '#/confirmer', { waitUntil: 'networkidle' })
await page.locator('button:has-text("Confirmer ce montant")').last().click()
await page.waitForTimeout(900)
dit('1.', 'confirmée · reste ' + (await page.locator('.carte:has(h2)').count()) + ' à confirmer')

await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
await page.click('.carte-lien')
await page.waitForSelector('h2:has-text("Mouvements")')
await page.locator('.carte:has(h2:text("Mouvements")) .liste li a').first().click()
await page.waitForSelector('h1')
dit('2.', 'écran atteint : ' + (await page.locator('h1').first().textContent()))
dit('3.', 'sous-titre : ' + (await page.locator('header p').first().textContent())?.trim())

await page.locator('input[inputmode="decimal"]').first().fill('712,35')
await page.locator('.actions button:has-text("Enregistrer")').first().click()
await page.waitForSelector('h2:has-text("Mouvements")')
const lignes = await page.locator('.carte:has(h2:text("Mouvements")) .liste li').allTextContents()
dit('4.', 'après correction : ' + JSON.stringify(lignes.map((t) => t.replace(/\s+/g, ' ').trim())))

await page.locator('.carte:has(h2:text("Mouvements")) .liste li a').first().click()
await page.waitForSelector('h1:has-text("Corriger une échéance")')
await page.click('button:has-text("Annuler la confirmation")')
await page.waitForTimeout(900)
await page.goto(base + '#/confirmer', { waitUntil: 'networkidle' })
dit(
  '5.',
  'réclamée à nouveau : ' + (await page.locator('.carte:has(h2)').count()) + ' occurrence(s)',
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
