import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4209'
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
await page.fill('input[inputmode="decimal"]', '1234,56')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

// Configurer un code.
await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.click('button:has-text("Configurer un code")')
await page.fill('#pin-nouveau', '111111')
await page.fill('#pin-confirmation', '111111')
await page.check('input[type=checkbox]')
await page.click('button:has-text("Activer le code")')
await page.waitForSelector('nav.onglets', { timeout: 40000 })
dit('1.', 'code configuré')

// Le changer.
await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.click('button:has-text("Changer le code")')
await page.waitForSelector('#code-ancien')
await page.fill('#code-ancien', '000000')
await page.fill('#code-nouveau', '222222')
await page.fill('#code-confirmation', '222222')
await page.click('button:has-text("Changer le code")')
await page.waitForTimeout(2500)
dit(
  '2.',
  'mauvais code actuel : ' + (await page.locator('[role=alert]').first().textContent())?.trim(),
)
await page.fill('#code-ancien', '111111')
await page.click('button:has-text("Changer le code")')
await page.waitForSelector('nav.onglets', { timeout: 40000 })
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
dit(
  '3.',
  'code changé, données : ' +
    (await page.locator('.montant-principal').first().textContent())?.trim(),
)

// Rechargement : l'ancien code ne marche plus, le nouveau si.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('#pin')
await page.fill('#pin', '111111')
await page.click('button:has-text("Ouvrir")')
await page.waitForTimeout(2000)
dit('4.', 'ancien code : ' + (await page.locator('[role=alert]').first().textContent())?.trim())
await page.fill('#pin', '222222')
await page.click('button:has-text("Ouvrir")')
await page.waitForSelector('nav.onglets', { timeout: 40000 })
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
dit(
  '5.',
  'nouveau code : ' + (await page.locator('.montant-principal').first().textContent())?.trim(),
)

// Export avant d'oublier le code.
await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
const dl = page.waitForEvent('download', { timeout: 8000 })
await page.click('button:has-text("Exporter")')
const chemin = await (await dl).path()
dit('6.', 'sauvegarde faite')

// Code oublié : l'issue de secours.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('#pin')
await page.click('button:has-text("Code oublié")')
await page.waitForSelector('#phrase-effacement')
dit('7.', 'écran de secours : ' + (await page.locator('h1').textContent()))
const boutonBloque = await page.locator('button:has-text("Effacer cet appareil")').isDisabled()
dit('8.', 'bouton bloqué sans la phrase : ' + boutonBloque)
await page.fill('#phrase-effacement', 'effacer')
await page.click('button:has-text("Effacer cet appareil")')
await page.waitForSelector('#nom-compte', { timeout: 20000 })
dit('9.', 'après effacement : ' + (await page.locator('h1').textContent()))

// Repartir de la sauvegarde.
await page.fill('#nom-compte', 'Temporaire')
await page.fill('input[inputmode="decimal"]', '0')
await page.click('button:has-text("Continuer")')
await page.click('button:has-text("Continuer")')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')
await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.setInputFiles('input[type=file]', chemin)
await page.waitForTimeout(1800)
dit(
  '10.',
  'import de la sauvegarde : ' +
    (await page.locator('[role=status]').first().textContent())?.trim(),
)
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
dit(
  '11.',
  'données retrouvées : ' +
    (await page.locator('.montant-principal').first().textContent())?.trim(),
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
