import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4202'
const nav = await chromium.launch(optionsNavigateur())
const ctx = await nav.newContext({ ...devices['Pixel 7'] })
const page = await ctx.newPage()
const erreurs = []
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e)))
page.on('console', (m) => m.type() === 'error' && erreurs.push('CONSOLE ' + m.text()))
const base = `http://localhost:${PORT}/Ingenious/`
const dit = (n, v) => console.log(`${String(n).padEnd(5)} ${v}`)

// Onboarding avec les trois abonnements de l'étape 3.
await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', 'Courant')
await page.fill('input[inputmode="decimal"]', '1500')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
dit('1.', 'étape 3 : ' + (await page.locator('h1').textContent()))
await page.fill('#abo-nom-0', 'Loyer')
await page.locator('.carte:has(#abo-nom-0) input[inputmode="decimal"]').fill('700')
await page.fill('#abo-jour-0', '1')
await page.fill('#abo-nom-1', 'Téléphone')
await page.locator('.carte:has(#abo-nom-1) input[inputmode="decimal"]').fill('19,99')
await page.fill('#abo-jour-1', '15')
// Le troisième est laissé vide : il ne doit rien créer.
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')
await page.goto(base + '#/abonnements', { waitUntil: 'networkidle' })
const abos = await page.locator('.carte:has(a:has-text("Modifier")) h2').allTextContents()
dit(
  '2.',
  'abonnements créés : ' +
    JSON.stringify(abos) +
    ' — coût ' +
    (await page.locator('.montant-principal').first().textContent())?.trim(),
)

// Saisie d'une dépense avec une faute de frappe, puis correction.
await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '4200')
await page.fill('#note', 'Courses')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Reste à vivre")')
dit(
  '3.',
  'après faute de frappe : ' +
    (await page.locator('.montant-principal').first().textContent())?.trim(),
)

await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
await page.click('.carte-lien')
await page.waitForSelector('h2:has-text("Mouvements")')
await page.click('.carte:has(h2:text("Mouvements")) .liste li a')
await page.waitForSelector('h1:has-text("Corriger")')
dit('4.', 'écran de correction : ' + (await page.locator('header p').textContent())?.trim())
await page.fill('input[inputmode="decimal"]', '42')
await page.click('.actions button:has-text("Enregistrer")')
await page.waitForSelector('h2:has-text("Mouvements")')
dit(
  '5.',
  'après correction : ' + (await page.locator('.montant-principal').first().textContent())?.trim(),
)

// Suppression
await page.click('.carte:has(h2:text("Mouvements")) .liste li a')
await page.waitForSelector('h1:has-text("Corriger")')
await page.click('button:has-text("Supprimer ce mouvement")')
await page.click('button:has-text("Oui, supprimer")')
await page.waitForSelector('h2:has-text("Mouvements")')
dit(
  '6.',
  'après suppression : ' +
    (await page.locator('.montant-principal').first().textContent())?.trim() +
    ' · ' +
    (await page.locator('.carte:has(h2:text("Mouvements")) .liste li').count()) +
    ' mouvement(s)',
)

// Virement depuis Comptes
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
await page.click('a:has-text("Virement")')
await page.waitForSelector('h1:has-text("Ajout rapide")')
const sensActif = await page.locator('.segments button[aria-pressed=true]').textContent()
dit('7.', 'lien virement : formulaire ouvert sur « ' + sensActif?.trim() + ' »')

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
