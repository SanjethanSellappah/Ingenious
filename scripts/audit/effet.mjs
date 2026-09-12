import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4211'
const nav = await chromium.launch(optionsNavigateur())
const ctx = await nav.newContext({ ...devices['Pixel 7'] })
const page = await ctx.newPage()
const erreurs = []
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e)))
page.on('console', (m) => m.type() === 'error' && erreurs.push('CONSOLE ' + m.text()))
const base = `http://localhost:${PORT}/Ingenious/`
const dit = (n, v) => console.log(`${String(n).padEnd(5)} ${v}`)
const solde = async () => {
  await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
  return (await page.locator('.montant-principal').first().textContent())?.trim()
}

await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', 'Courant')
await page.fill('input[inputmode="decimal"]', '1200')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

// Un label, puis un loyer rattaché à ce label, dont l'échéance est déjà passée.
await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '10')
await page.fill('#nouveau-label', 'Logement')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Reste à vivre")')

await page.goto(base + '#/abonnements/nouveau', { waitUntil: 'networkidle' })
await page.fill('#nom-abo', 'Loyer')
await page.fill('input[inputmode="decimal"]', '700')
await page.fill('#jour-mois', '5')
await page.fill('#debut', '2026-08-05')
// Le label existant se choisit d'un appui ; c'est le geste réel.
await page.click('.champ:has(#label-abo) button:has-text("Logement")')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Abonnements")')

dit('1.', 'solde avant confirmation : ' + (await solde()))
await page.goto(base + '#/depenses', { waitUntil: 'networkidle' })
dit(
  '2.',
  'dépenses avant : ' + (await page.locator('.montant-principal').first().textContent())?.trim(),
)

await page.goto(base + '#/confirmer', { waitUntil: 'networkidle' })
const combien = await page.locator('.carte:has(h2)').count()
dit('3.', combien + ' occurrence(s) réclamée(s)')
// On confirme celle de septembre (la dernière de la liste).
await page.locator('button:has-text("Confirmer ce montant")').last().click()
await page.waitForTimeout(900)

dit('4.', 'solde après confirmation : ' + (await solde()))
await page.goto(base + '#/depenses', { waitUntil: 'networkidle' })
dit(
  '5.',
  'dépenses après : ' +
    (await page.locator('.montant-principal').first().textContent())?.trim() +
    ' · postes ' +
    JSON.stringify(await page.locator('.ligne-label h2').allTextContents()),
)
const logement = await page
  .locator('.carte:has(h2:text("Logement")) .montant')
  .first()
  .textContent()
dit('6.', 'poste Logement : ' + logement?.trim())

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
