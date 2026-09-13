import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'

/**
 * Un compte d'investissement suivi par ses lignes.
 *
 * Ce qu'on vérifie n'est pas que le calcul tombe juste — des tests unitaires
 * s'en chargent — mais qu'on puisse déclarer ce qu'on détient, que le patrimoine
 * en tienne compte, et qu'une ligne sans cours ne soit jamais comptée pour zéro.
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
const enEuros = (t) => Number((t ?? '').replace(/[^\d,-]/g, '').replace(',', '.'))
const corps = () =>
  page
    .locator('body')
    .innerText()
    .then((t) => t.replace(/\s+/g, ' '))

await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', 'Courant')
await page.locator('input[inputmode="decimal"]').first().fill('1000')
await page.click('button:has-text("Continuer")')
await page.locator('input[inputmode="decimal"]').first().fill('2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

// Un PEA suivi par ses lignes, sans solde de départ.
await page.goto(base + '#/comptes/nouveau', { waitUntil: 'networkidle' })
await page.fill('#nom-compte-form', 'PEA')
await page.selectOption('#type-compte', 'pea')
await page.waitForTimeout(300)
const modeOffert = await page.locator('button:has-text("Je saisis mes lignes")').count()
dit('1.', 'mode « lignes » proposé pour un compte d’investissement : ' + (modeOffert > 0))
exiger(modeOffert > 0, 'aucun mode par lignes offert sur un compte d’investissement')
await page.click('button:has-text("Je saisis mes lignes")')
await page.waitForTimeout(300)
const soldeDemande = await page.locator('input[inputmode="decimal"]').count()
dit('2.', 'champ de solde encore demandé : ' + (soldeDemande > 0))
exiger(soldeDemande === 0, 'un compte suivi par lignes réclame quand même un solde')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Patrimoine")')

// Déclarer 12 parts à 38,42 €.
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
const lien = await page
  .locator('a[href*="#/comptes/"]:has-text("PEA")')
  .first()
  .getAttribute('href')
await page.goto(base + lien.slice(lien.indexOf('#/')), { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.click('button:has-text("Ajouter une ligne")')
await page.fill('#nom-instrument', 'MSCI World')
await page.fill('#symbole-instrument', 'CW8')
await page.fill('#quantite-nouvelle', '12')
await page.locator('input[inputmode="decimal"]').last().fill('38,42')
await page.click('button:has-text("Ajouter")')
await page.waitForTimeout(900)

let vu = await corps()
dit('3.', 'détail : ' + vu.slice(vu.indexOf('Solde'), vu.indexOf('Solde') + 150))
exiger(/461,04/.test(vu), '12 × 38,42 devrait valoir 461,04 €')
exiger(/12 part/.test(vu), 'la quantité détenue n’est pas affichée')

// Une ligne sans cours : elle ne doit pas être comptée pour zéro, et se dire.
await page.click('button:has-text("Ajouter une ligne")')
await page.click('button:has-text("Or")')
await page.fill('#nom-instrument', 'Or physique')
await page.fill('#quantite-nouvelle', '3,5')
await page.click('button:has-text("Ajouter")')
await page.waitForTimeout(900)
vu = await corps()
dit('4.', 'ligne sans cours : ' + (/cours inconnu/.test(vu) ? 'signalée' : 'ABSENTE'))
exiger(/cours inconnu/.test(vu), 'une ligne sans cours n’est pas signalée')
exiger(/ligne sans cours/.test(vu), 'rien n’explique qu’une ligne ne compte pas dans le total')
exiger(/461,04/.test(vu), 'le total a bougé alors qu’aucun cours n’a été ajouté')

// Le patrimoine additionne le compte courant et le portefeuille.
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const patrimoine = enEuros(await page.locator('.montant-principal').first().textContent())
dit('5.', 'patrimoine : ' + patrimoine + ' €')
exiger(Math.abs(patrimoine - 1461.04) < 0.01, `patrimoine attendu 1 461,04, obtenu ${patrimoine}`)

// Relever le cours de l'or : la ligne rejoint le total.
await page.goto(base + lien.slice(lien.indexOf('#/')), { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
await page.locator('li:has-text("Or physique") button:has-text("Modifier")').click()
await page.locator('li:has-text("Or physique") input[inputmode="decimal"]').last().fill('72,40')
await page.locator('li:has-text("Or physique") button:has-text("Enregistrer")').click()
await page.waitForTimeout(900)
vu = await corps()
dit(
  '6.',
  'après relevé du cours de l’or : ' + vu.slice(vu.indexOf('Solde'), vu.indexOf('Solde') + 90),
)
exiger(/714,44/.test(vu), '461,04 + 3,5 × 72,40 = 714,44 € attendu')
exiger(!/cours inconnu/.test(vu), 'la ligne reste signalée sans cours après relevé')

// L'export emporte lignes et cours.
await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.click('button:has-text("Exporter")'),
])
const flux = await dl.createReadStream()
let contenu = ''
for await (const bloc of flux) contenu += bloc
const types = new Set(JSON.parse(contenu).events.map((e) => e.type))
dit('7.', 'dans l’export : ' + [...types].filter((t) => /instrument|holding/.test(t)).join(', '))
exiger(types.has('instrument.created'), 'les instruments ne sont pas dans le journal exporté')
exiger(types.has('holding.created'), 'les lignes ne sont pas dans le journal exporté')
exiger(types.has('instrument.quoted'), 'les cours ne sont pas dans le journal exporté')

console.log('\nproblèmes :', problemes.length ? problemes.join('\n  ') : 'aucun')
console.log('erreurs :', erreurs.length ? [...new Set(erreurs)].slice(0, 4).join(' | ') : 'aucune')
await nav.close()

/*
 * Le code de sortie est le verdict.
 */
process.exit(problemes.length > 0 || erreurs.length > 0 ? 1 : 0)
