import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4193'
const nav = await chromium.launch(optionsNavigateur())
const ctx = await nav.newContext({ ...devices['Pixel 7'] })
const page = await ctx.newPage()
const erreurs = []
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e)))
page.on('console', (m) => m.type() === 'error' && erreurs.push('CONSOLE ' + m.text()))
const base = `http://localhost:${PORT}/Ingenious/`

// Données saisies AVANT toute configuration de code.
await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', 'Courant')
await page.fill('input[inputmode="decimal"]', '1234,56')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')
console.log(
  '1. avant le code   :',
  (await page.locator('.montant-principal').first().textContent())?.trim(),
)

// Configuration du code : c'est ici que tout se perdait.
await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.click('button:has-text("Configurer un code")')
await page.waitForSelector('#pin-nouveau')
await page.fill('#pin-nouveau', '246810')
await page.fill('#pin-confirmation', '246810')
await page.check('input[type=checkbox]')
await page.click('button:has-text("Activer le code")')
await page.waitForSelector('nav.onglets', { timeout: 40000 })
await page.goto(base + '#/', { waitUntil: 'networkidle' })
console.log(
  '2. après le code   :',
  (await page.locator('.montant-principal').first().textContent())?.trim(),
)

// La base ne doit plus rien contenir de lisible.
const enClair = await page.evaluate(async () => {
  const ouverture = indexedDB.open('ingenious')
  const bd = await new Promise((r) => {
    ouverture.onsuccess = () => r(ouverture.result)
  })
  const tx = bd.transaction('events', 'readonly')
  const tout = await new Promise((r) => {
    const q = tx.objectStore('events').getAll()
    q.onsuccess = () => r(q.result)
  })
  const texte = JSON.stringify(tout)
  return {
    enregistrements: tout.length,
    contientDuClair: texte.includes('account.created') || texte.includes('Courant'),
  }
})
console.log('3. base            :', JSON.stringify(enClair))

// Rechargement : le code est demandé, puis les données reviennent.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('#pin')
console.log('4. au rechargement : écran de code demandé')
await page.fill('#pin', '000000')
await page.click('button:has-text("Ouvrir")')
await page.waitForTimeout(1500)
console.log('5. mauvais code    :', (await page.locator('[role=alert]').textContent())?.trim())
await page.fill('#pin', '246810')
await page.click('button:has-text("Ouvrir")')
await page.waitForSelector('nav.onglets', { timeout: 40000 })
console.log(
  '6. bon code        :',
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
