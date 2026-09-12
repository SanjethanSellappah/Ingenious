import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'

/**
 * La réconciliation hebdomadaire, conduite depuis l'écran.
 *
 * C'est le mécanisme qui remplace la saisie exhaustive, donc celui dont une
 * erreur se paie le plus cher : un écart compté deux fois, ou pas du tout, fait
 * dériver le solde sans que rien ne le signale.
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
await page.fill('input[inputmode="decimal"]', '1000')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

const solde = async () => {
  await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
  await page.waitForTimeout(350)
  return (await page.locator('.montant-principal').first().textContent())?.trim()
}
const enEuros = (t) => Number((t ?? '').replace(/[^\d,-]/g, '').replace(',', '.'))

dit('1.', 'solde de départ : ' + (await solde()))

// Une dépense saisie, puis la banque annonce moins que prévu : l'écart doit
// apparaître, une seule fois, et recaler le solde exactement.
await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '50')
await page.click('button:has-text("Enregistrer")')
await page.waitForTimeout(800)
const avant = await solde()
dit('2.', 'après une dépense de 50 € : ' + avant)
exiger(enEuros(avant) === 950, `solde attendu 950, obtenu ${enEuros(avant)}`)

await page.goto(base + '#/reconciliation', { waitUntil: 'networkidle' })
const calcule = (await page.locator('.carte').first().innerText()).replace(/\s+/g, ' ')
dit('3.', 'ce que l’écran annonce : ' + calcule.slice(0, 110))
await page.fill('input[inputmode="decimal"]', '912,40')
await page.waitForTimeout(400)
const ecartAffiche = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
dit(
  '4.',
  'écart affiché : ' +
    (/[-−]?\d[\d  ]*,\d\d\s*€/.exec(ecartAffiche.split('Écart')[1] ?? '')?.[0] ?? '(non trouvé)'),
)
await page.click('button:has-text("Recaler le solde")')
await page.waitForTimeout(900)

const apres = await solde()
dit('5.', 'solde après réconciliation : ' + apres)
exiger(enEuros(apres) === 912.4, `le solde doit valoir exactement le relevé : ${enEuros(apres)}`)

// L'écart doit compter dans les dépenses du mois, sous « Non catégorisé ».
await page.goto(base + '#/depenses', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const depenses = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
dit(
  '6.',
  'dépenses du mois : ' +
    depenses.slice(depenses.indexOf('Dépenses'), depenses.indexOf('Dépenses') + 130),
)
exiger(
  /Non catégorisé|Sans label|Aucun label/i.test(depenses),
  'l’écart n’apparaît dans aucun poste de dépense',
)

// Réconcilier une seconde fois sans rien changer : l'écart doit être nul et le
// solde ne doit pas bouger. C'est le test du double comptage.
await page.goto(base + '#/reconciliation', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '912,40')
await page.waitForTimeout(400)
await page.click('button:has-text("Recaler le solde")')
await page.waitForTimeout(900)
const apres2 = await solde()
dit('7.', 'après une seconde réconciliation identique : ' + apres2)
exiger(enEuros(apres2) === 912.4, `l’écart a été compté deux fois : ${enEuros(apres2)}`)

// Une dépense saisie après la réconciliation du même jour doit compter.
await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '12,40')
await page.click('button:has-text("Enregistrer")')
await page.waitForTimeout(900)
const apres3 = await solde()
dit('8.', 'dépense saisie après la réconciliation du même jour : ' + apres3)
exiger(
  enEuros(apres3) === 900,
  `une dépense postérieure à l’ancre a été perdue : ${enEuros(apres3)}`,
)

// Réconcilier vers le haut : la banque annonce plus que prévu.
await page.goto(base + '#/reconciliation', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '1500')
await page.waitForTimeout(400)
await page.click('button:has-text("Recaler le solde")')
await page.waitForTimeout(900)
const apres4 = await solde()
dit('9.', 'réconciliation vers le haut : ' + apres4)
exiger(enEuros(apres4) === 1500, `écart positif mal appliqué : ${enEuros(apres4)}`)

// Un écart positif est une rentrée : il ne doit pas gonfler les dépenses.
await page.goto(base + '#/depenses', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const totalDepenses = (await page.locator('.montant-principal').first().textContent())?.trim()
dit('10.', 'total des dépenses du mois : ' + totalDepenses)
exiger(
  enEuros(totalDepenses) < 600,
  `un écart positif a été compté comme dépense : ${enEuros(totalDepenses)}`,
)

console.log('\nproblèmes :', problemes.length ? problemes.join('\n  ') : 'aucun')
console.log('erreurs :', erreurs.length ? [...new Set(erreurs)].slice(0, 4).join(' | ') : 'aucune')
await nav.close()

/*
 * Le code de sortie est le verdict.
 */
process.exit(problemes.length > 0 || erreurs.length > 0 ? 1 : 0)
