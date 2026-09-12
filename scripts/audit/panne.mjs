import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4192'
const base = `http://localhost:${PORT}/Ingenious/`
const nav = await chromium.launch(optionsNavigateur())
const ctx = await nav.newContext({ ...devices['Pixel 7'] })
const page = await ctx.newPage()
const dit = (n, v) => console.log(`${String(n).padEnd(6)} ${v}`)
const problemes = []
const exiger = (condition, quoi) => {
  if (!condition) problemes.push(quoi)
}

await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', 'Courant')
await page.fill('input[inputmode="decimal"]', '1000')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')
dit('1.', 'application installée, disque sain')
const bandeauInitial = await page.locator('.panne').count()
dit('1b.', 'bandeau de panne : ' + bandeauInitial)
exiger(bandeauInitial === 0, 'un bandeau de panne s’affiche alors que le disque va bien')

// Le disque refuse désormais toute écriture dans la table des événements.
await page.evaluate(() => {
  const proto = IDBObjectStore.prototype
  const vraiAdd = proto.add
  proto.add = function (...args) {
    if (this.name !== 'events') return vraiAdd.apply(this, args)
    const req = vraiAdd.apply(this, args)
    Object.defineProperty(req, 'error', {
      value: new DOMException('quota', 'QuotaExceededError'),
      configurable: true,
    })
    setTimeout(() => {
      req.onerror?.({ type: 'error', target: req, preventDefault() {}, stopPropagation() {} })
    }, 0)
    return req
  }
  const vraiPut = proto.put
  proto.put = function (...args) {
    if (this.name !== 'events') return vraiPut.apply(this, args)
    const req = vraiPut.apply(this, args)
    Object.defineProperty(req, 'error', {
      value: new DOMException('quota', 'QuotaExceededError'),
      configurable: true,
    })
    setTimeout(() => {
      req.onerror?.({ type: 'error', target: req, preventDefault() {}, stopPropagation() {} })
    }, 0)
    return req
  }
})

await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '42,50')
await page.click('button:has-text("Enregistrer")')
await page.waitForTimeout(2000)
const bandeau = await page.locator('.panne').count()
dit('2.', 'après une écriture refusée, bandeau : ' + (bandeau > 0))
exiger(bandeau > 0, 'une écriture refusée ne déclenche aucun bandeau')
if (bandeau > 0)
  dit('2b.', (await page.locator('.panne').first().innerText()).replace(/\s+/g, ' ').slice(0, 200))

// Il suit l'utilisateur d'écran en écran : une panne de disque n'est pas locale.
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const suit = (await page.locator('.panne').count()) > 0
dit('3.', 'toujours visible sur Comptes : ' + suit)
exiger(suit, 'le bandeau ne suit pas l’utilisateur d’un écran à l’autre')

// Le lien mène à l'export, qui est la seule chose utile à faire.
await page.click('.panne a')
await page.waitForTimeout(500)
const destination = (await page.locator('h1').first().textContent())?.trim()
dit('4.', 'le lien mène à : ' + destination)
exiger(destination === 'Réglages', 'le lien du bandeau ne mène pas à l’export')

// Contraste du bandeau.
const contraste = await page.evaluate(() => {
  const el = document.querySelector('.panne')
  const s = getComputedStyle(el)
  const lum = (c) => {
    const [r, g, b] = c
      .match(/\d+/g)
      .slice(0, 3)
      .map(Number)
      .map((v) => {
        const x = v / 255
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
      })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [l1, l2] = [lum(s.color), lum(s.backgroundColor)].sort((a, b) => b - a)
  return { ratio: ((l1 + 0.05) / (l2 + 0.05)).toFixed(2), texte: s.color, fond: s.backgroundColor }
})
dit('5.', 'contraste du bandeau : ' + JSON.stringify(contraste))
exiger(Number(contraste.ratio) >= 4.5, `contraste du bandeau ${contraste.ratio} < 4,5`)

// Le disque redevient sain : le bandeau doit disparaître à la première réussite.
await page.evaluate(() => {
  location.reload()
})
await page.waitForTimeout(1500)
await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '10')
await page.click('button:has-text("Enregistrer")')
await page.waitForTimeout(1200)
const reste = (await page.locator('.panne').count()) > 0
dit('6.', 'après une écriture réussie, bandeau : ' + reste)
exiger(!reste, 'le bandeau reste affiché alors que l’écriture a repris')
console.log('\nproblèmes :', problemes.length ? problemes.join('\n  ') : 'aucun')

await page.screenshot({ path: 'panne.png' })
await nav.close()

/*
 * Le code de sortie est le verdict.
 *
 * Afficher les problèmes ne suffit pas : le lanceur ne lit pas le français, et
 * un audit qui décrit vingt fautes en sortant sur zéro passe pour un succès.
 * C'est arrivé — vingt et un audits « passés » sur une version périmée du site.
 */
process.exit(problemes.length > 0 ? 1 : 0)
