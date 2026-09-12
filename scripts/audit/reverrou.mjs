import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4192'
const base = `http://localhost:${PORT}/Ingenious/`
const nav = await chromium.launch(optionsNavigateur())
const ctx = await nav.newContext({ ...devices['Pixel 7'] })
const page = await ctx.newPage()
const erreurs = []
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e).slice(0, 120)))
page.on('console', (m) => m.type() === 'error' && erreurs.push('CONSOLE ' + m.text().slice(0, 120)))
const dit = (n, v) => console.log(`${String(n).padEnd(6)} ${v}`)

// L'horloge de la page est décalable, pour ne pas attendre deux minutes.
await page.addInitScript(() => {
  window.__decalage = 0
  const vraiNow = Date.now.bind(Date)
  Date.now = () => vraiNow() + window.__decalage
  const Vrai = Date
  window.Date = class extends Vrai {
    constructor(...a) {
      super(...(a.length ? a : [vraiNow() + window.__decalage]))
    }
    static now() {
      return vraiNow() + window.__decalage
    }
  }
})

await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', 'Courant')
await page.fill('input[inputmode="decimal"]', '1234,56')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.click('button:has-text("Configurer un code")')
await page.fill('#pin-nouveau', '123456')
await page.fill('#pin-confirmation', '123456')
await page.check('input[type=checkbox]')
await page.click('button:has-text("Activer le code")')
await page.waitForSelector('nav.onglets', { timeout: 60000 })
dit('1.', 'code configuré, application ouverte')

const masquer = async (secondes) => {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.evaluate((s) => {
    window.__decalage += s * 1000
  }, secondes)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(700)
}

// Un aller-retour court : l'application ne doit pas se reverrouiller.
await masquer(30)
dit('2.', '30 s en arrière-plan → verrouillé : ' + ((await page.locator('#pin').count()) > 0))

// Au-delà de deux minutes : elle doit se reverrouiller.
await masquer(150)
const verrouille = await page.locator('#pin').count()
dit('3.', '150 s en arrière-plan → verrouillé : ' + (verrouille > 0))

if (verrouille > 0) {
  await page.fill('#pin', '123456')
  await page.click('form button[type=submit]')
  await page.waitForSelector('nav.onglets', { timeout: 60000 })
  dit(
    '4.',
    'réouvert, écran retrouvé : ' + (await page.locator('h1').first().textContent())?.trim(),
  )
  await page.goto(base + '#/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  dit(
    '5.',
    'données intactes : ' +
      (await page.locator('.montant-principal').first().textContent())?.trim(),
  )
  // Et le compteur repart : un aller-retour court après déverrouillage ne reverrouille pas.
  await masquer(30)
  dit(
    '6.',
    '30 s après déverrouillage → verrouillé : ' + ((await page.locator('#pin').count()) > 0),
  )
}

console.log(
  '\nerreurs :',
  erreurs.length ? [...new Set(erreurs)].slice(0, 4).join(' | ') : 'aucune',
)
await nav.close()

/*
 * Le code de sortie est le verdict.
 *
 * Afficher les problèmes ne suffit pas : le lanceur ne lit pas le français, et
 * un audit qui décrit vingt fautes en sortant sur zéro passe pour un succès.
 * C'est arrivé — vingt et un audits « passés » sur une version périmée du site.
 */
process.exit(erreurs.length > 0 ? 1 : 0)
