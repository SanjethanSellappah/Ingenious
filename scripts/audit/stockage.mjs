import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4192'
const base = `http://localhost:${PORT}/Ingenious/`
const nav = await chromium.launch(optionsNavigateur())
const dit = (n, v) => console.log(`${String(n).padEnd(6)} ${v}`)
const problemes = []
const exiger = (condition, quoi) => {
  if (!condition) problemes.push(quoi)
}

/*
 * Les erreurs de page ne sont pas le verdict ici.
 *
 * Ces scénarios *provoquent* les pannes qu'ils observent : un quota dépassé
 * produit forcément des erreurs dans la console. Ce qu'on vérifie est ailleurs —
 * que l'application dise quelque chose d'utile plutôt que de montrer une page
 * blanche ou le message anglais d'une bibliothèque.
 */
async function essai(nom, prepare, apres) {
  const ctx = await nav.newContext({ ...devices['Pixel 7'] })
  const page = await ctx.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e).slice(0, 120)))
  page.on(
    'console',
    (m) => m.type() === 'error' && erreurs.push('CONSOLE ' + m.text().slice(0, 120)),
  )
  if (prepare) await page.addInitScript(prepare)
  await page.goto(base + '#/', { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(2500)
  const vue = await page
    .evaluate(() => ({
      h1: document.querySelector('h1')?.textContent?.trim() ?? null,
      texte: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 220),
      vide: document.body.innerText.trim().length === 0,
    }))
    .catch((e) => ({ erreur: String(e).slice(0, 100) }))
  console.log(`\n--- ${nom} ---`)
  dit('écran', vue.vide ? 'PAGE BLANCHE' : (vue.h1 ?? '(aucun h1)'))
  dit('texte', vue.texte ?? '')
  if (apres) await apres(page, dit)
  dit('erreurs', erreurs.length ? erreurs.slice(0, 3).join(' | ') : 'aucune')
  await ctx.close()
  return vue
}

// 1. IndexedDB absent — navigation privée sur certains navigateurs.
await essai('IndexedDB indisponible', () => {
  Object.defineProperty(window, 'indexedDB', {
    get() {
      return undefined
    },
  })
})

// 2. IndexedDB présent mais refuse d'ouvrir — profil corrompu, stockage bloqué.
await essai('ouverture de la base refusée', () => {
  const vrai = indexedDB.open.bind(indexedDB)
  indexedDB.open = function () {
    const req = vrai.call(indexedDB, '__inexistant__' + Math.random())
    setTimeout(() => {
      const e = new Event('error')
      Object.defineProperty(req, 'error', {
        value: new DOMException('accès refusé', 'SecurityError'),
      })
      req.onerror?.(e)
      req.dispatchEvent?.(e)
    }, 30)
    return req
  }
})

// 3. Quota dépassé à l'écriture — le disque est plein.
await essai(
  'quota dépassé à l’écriture',
  () => {
    window.__quota = true
  },
  async (page, dit) => {
    if (await page.locator('#nom-compte').count()) {
      await page.addInitScript(() => {})
      await page.evaluate(() => {
        const proto = IDBObjectStore.prototype
        const vraiPut = proto.put
        proto.put = function (...args) {
          const req = vraiPut.apply(this, args)
          setTimeout(() => {
            Object.defineProperty(req, 'error', {
              value: new DOMException('quota', 'QuotaExceededError'),
            })
            req.onerror?.(new Event('error'))
          }, 5)
          return req
        }
      })
      await page.fill('#nom-compte', 'Courant')
      await page.fill('input[inputmode="decimal"]', '1000')
      await page.click('button:has-text("Continuer")')
      await page.fill('input[inputmode="decimal"]', '2000')
      await page.click('button:has-text("Continuer")')
      await page.waitForSelector('#abo-nom-0')
      await page.click('button:has-text("Terminer")')
      await page.waitForTimeout(2500)
      const vue = await page.evaluate(() => ({
        h1: document.querySelector('h1')?.textContent?.trim() ?? null,
        texte: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 200),
        vide: document.body.innerText.trim().length === 0,
      }))
      dit('après', vue.vide ? 'PAGE BLANCHE' : `${vue.h1} — ${vue.texte}`)
      exiger(!vue.vide, 'page blanche quand le disque refuse d’écrire')
      exiger(
        /n’a pas pu être enregistrée|n'a pas pu être enregistrée/.test(vue.texte ?? ''),
        'une écriture refusée pendant le démarrage à froid ne dit rien à l’utilisateur',
      )
    }
  },
)

// 4. localStorage bloqué — le rappel de sauvegarde s'en sert.
await essai('localStorage bloqué', () => {
  Object.defineProperty(window, 'localStorage', {
    get() {
      throw new DOMException('bloqué', 'SecurityError')
    },
  })
})

await nav.close()

/*
 * Le code de sortie est le verdict.
 *
 * Afficher les problèmes ne suffit pas : le lanceur ne lit pas le français, et
 * un audit qui décrit vingt fautes en sortant sur zéro passe pour un succès.
 * C'est arrivé — vingt et un audits « passés » sur une version périmée du site.
 */
process.exit(problemes.length > 0 ? 1 : 0)
