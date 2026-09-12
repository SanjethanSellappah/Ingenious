import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'

/**
 * Installation sur l'écran d'accueil.
 *
 * L'écran réclamait l'installation sans offrir aucun moyen de la faire. On
 * vérifie les trois situations : le navigateur propose, le navigateur ne propose
 * rien, et l'application est déjà installée.
 */
const PORT = process.argv[2] ?? '4192'
const base = `http://localhost:${PORT}/Ingenious/`
const nav = await chromium.launch(optionsNavigateur())
const erreurs = []
const problemes = []
const exiger = (condition, quoi) => {
  if (!condition) problemes.push(quoi)
}
const dit = (n, v) => console.log(`${String(n).padEnd(6)} ${v}`)

async function session(prepare) {
  const ctx = await nav.newContext({ ...devices['Pixel 7'] })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e).slice(0, 140)))
  page.on(
    'console',
    (m) => m.type() === 'error' && erreurs.push('CONSOLE ' + m.text().slice(0, 140)),
  )
  if (prepare) await page.addInitScript(prepare)
  await page.goto(base + '#/', { waitUntil: 'networkidle' })
  await page.fill('#nom-compte', 'Courant')
  await page.fill('input[inputmode="decimal"]', '1000')
  await page.click('button:has-text("Continuer")')
  await page.fill('input[inputmode="decimal"]', '2000')
  await page.click('button:has-text("Continuer")')
  await page.waitForSelector('#abo-nom-0')
  await page.click('button:has-text("Terminer")')
  await page.waitForSelector('nav.onglets')
  await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  return { ctx, page }
}

const carte = (page) => page.locator('.carte:has(h2:text("Stockage"))')

// --- 1. Le navigateur propose l'installation ---
{
  // Émis très tôt, avant même que React ne monte : c'est le cas que le
  // navigateur produit réellement, et celui qu'un écouteur posé dans un effet
  // manquerait selon la vitesse de démarrage.
  const { ctx, page } = await session(() => {
    const emettre = () => {
      const e = new Event('beforeinstallprompt')
      e.prompt = () => {
        window.__invite = 'ouverte'
        return Promise.resolve()
      }
      e.userChoice = Promise.resolve({ outcome: 'accepted' })
      window.dispatchEvent(e)
    }
    document.addEventListener('DOMContentLoaded', emettre)
    window.addEventListener('load', emettre)
  })
  const bouton = carte(page).locator('button:has-text("Installer")')
  const present = await bouton.count()
  dit('1.', 'bouton d’installation proposé : ' + (present > 0))
  exiger(present > 0, 'le navigateur propose l’installation mais aucun bouton n’apparaît')
  if (present > 0) {
    await bouton.click()
    await page.waitForTimeout(600)
    const ouverte = await page.evaluate(() => window.__invite ?? null)
    dit('2.', 'fenêtre du navigateur ouverte : ' + ouverte)
    exiger(ouverte === 'ouverte', 'le bouton n’ouvre pas la fenêtre d’installation')
    const texte = (await carte(page).innerText()).replace(/\s+/g, ' ')
    dit('3.', 'confirmation : ' + (/Installée\. [^.]*\./.exec(texte)?.[0] ?? '(absente)'))
    exiger(/Installée\./.test(texte), 'aucune confirmation après acceptation')
    // L'invitation ne sert qu'une fois : le bouton ne doit pas rester.
    const reste = await carte(page).locator('button:has-text("Installer")').count()
    dit('4.', 'bouton encore présent après usage : ' + (reste > 0))
    exiger(reste === 0, 'le bouton subsiste alors que l’invitation est consommée')
  }
  await ctx.close()
}

// --- 2. Le navigateur ne propose rien : il faut dire où chercher ---
{
  const { ctx, page } = await session()
  const texte = (await carte(page).innerText()).replace(/\s+/g, ' ')
  dit(
    '5.',
    'sans invitation : ' +
      texte.slice(texte.indexOf('Par le menu'), texte.indexOf('Par le menu') + 110),
  )
  exiger(
    /menu du navigateur/i.test(texte),
    'aucune indication quand le navigateur ne propose pas l’installation',
  )
  exiger(
    (await carte(page).locator('button:has-text("Installer")').count()) === 0,
    'un bouton d’installation s’affiche alors qu’aucune invitation n’existe',
  )
  await ctx.close()
}

// --- 3. Déjà installée : ne rien réclamer ---
{
  const { ctx, page } = await session(() => {
    const vrai = window.matchMedia.bind(window)
    window.matchMedia = (q) =>
      q.includes('standalone')
        ? { matches: true, addEventListener() {}, removeEventListener() {} }
        : vrai(q)
  })
  const texte = (await carte(page).innerText()).replace(/\s+/g, ' ')
  dit('6.', 'déjà installée : ' + texte.slice(0, 110))
  exiger(/Installée sur l’écran d’accueil : oui/.test(texte), 'l’état installé n’est pas reconnu')
  exiger(
    !/À faire|menu du navigateur/i.test(texte),
    'l’application réclame encore son installation alors qu’elle est installée',
  )
  await ctx.close()
}

console.log('\nproblèmes :', problemes.length ? problemes.join('\n  ') : 'aucun')
console.log('erreurs :', erreurs.length ? [...new Set(erreurs)].slice(0, 4).join(' | ') : 'aucune')
await nav.close()

/*
 * Le code de sortie est le verdict.
 */
process.exit(problemes.length > 0 || erreurs.length > 0 ? 1 : 0)
