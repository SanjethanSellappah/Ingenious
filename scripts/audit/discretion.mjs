import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'

/**
 * Masquer les montants.
 *
 * Deux besoins distincts : le regard d'à côté, qui veut tout cacher d'un geste
 * et tout revoir aussitôt ; et le compte qu'on ne veut simplement pas voir en
 * ouvrant l'application. Le premier est un réglage d'appareil, le second décrit
 * le compte et doit suivre l'export.
 */
const PORT = process.argv[2] ?? '4192'
const base = `http://localhost:${PORT}/Ingenious/`
const nav = await chromium.launch(optionsNavigateur())
const ctx = await nav.newContext({ ...devices['Pixel 7'] })
const page = await ctx.newPage()
const erreurs = []
const problemes = []
const exiger = (condition, quoi) => {
  if (!condition) problemes.push(quoi)
}
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e).slice(0, 140)))
page.on('console', (m) => m.type() === 'error' && erreurs.push('CONSOLE ' + m.text().slice(0, 140)))
const dit = (n, v) => console.log(`${String(n).padEnd(6)} ${v}`)

await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', 'Courant')
await page.locator('input[inputmode="decimal"]').first().fill('1234,56')
await page.click('button:has-text("Continuer")')
await page.locator('input[inputmode="decimal"]').first().fill('2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

// Un second compte, pour vérifier que le masquage d'un seul n'emporte pas l'autre.
await page.goto(base + '#/comptes/nouveau', { waitUntil: 'networkidle' })
await page.fill('#nom-compte-form', 'Livret')
await page.locator('input[inputmode="decimal"]').first().fill('5000')
await page.check('#masquer-compte')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Patrimoine")')
await page.waitForTimeout(500)

const corps = () =>
  page
    .locator('body')
    .innerText()
    .then((t) => t.replace(/\s+/g, ' '))

let vu = await corps()
dit('1.', 'patrimoine : ' + vu.slice(0, 120))
exiger(/6\s*234,56/.test(vu), 'le compte masqué n’est plus compté dans le patrimoine')
exiger(/1\s*234,56/.test(vu), 'le compte non masqué devrait rester lisible')
exiger(!/5\s*000,00/.test(vu), 'le solde du compte masqué est visible')
exiger(/••••/.test(vu), 'aucun repère ne signale un montant masqué')

// Le masquage d'un compte suit l'export : il décrit le compte, pas l'appareil.
await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.click('button:has-text("Exporter")'),
])
const flux = await dl.createReadStream()
let contenu = ''
for await (const bloc of flux) contenu += bloc
const porteLeMasque = JSON.parse(contenu).events.some((e) => e.payload?.masque === true)
dit('2.', 'le masquage voyage avec l’export : ' + porteLeMasque)
exiger(porteLeMasque, 'le masquage d’un compte n’est pas dans le journal exporté')

// Le geste global : tout masquer, tout revoir.
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.click('.bouton-icone')
await page.waitForTimeout(400)
vu = await corps()
dit('3.', 'après bascule : ' + vu.slice(0, 110))
exiger(!/1\s*234,56/.test(vu) && !/6\s*234,56/.test(vu), 'des montants restent lisibles')

// Il doit tenir sur les autres écrans, sinon il ne masque rien.
for (const ou of ['#/', '#/depenses', '#/calendrier']) {
  await page.goto(base + ou, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const ecran = await corps()
  const chiffres = /\d[\d  ]*,\d\d\s*€/.exec(ecran)?.[0] ?? null
  dit(ou, 'montant lisible : ' + (chiffres ?? 'aucun'))
  exiger(chiffres === null, `un montant reste lisible sur ${ou} : ${chiffres}`)
}

// Et il survit au rechargement : sinon on se découvre en rouvrant.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(600)
dit('4.', 'après rechargement, encore masqué : ' + /••••/.test(await corps()))
exiger(/••••/.test(await corps()), 'le mode discrétion ne survit pas au rechargement')

await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.click('.bouton-icone')
await page.waitForTimeout(400)
vu = await corps()
dit('5.', 'après retour : ' + vu.slice(0, 110))
exiger(/1\s*234,56/.test(vu), 'les montants ne reviennent pas')
exiger(!/5\s*000,00/.test(vu), 'le compte masqué individuellement s’est découvert')

console.log('\nproblèmes :', problemes.length ? problemes.join('\n  ') : 'aucun')
console.log('erreurs :', erreurs.length ? [...new Set(erreurs)].slice(0, 4).join(' | ') : 'aucune')
await nav.close()

/*
 * Le code de sortie est le verdict.
 */
process.exit(problemes.length > 0 || erreurs.length > 0 ? 1 : 0)
