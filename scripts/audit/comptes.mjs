import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4205'
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
await page.fill('input[inputmode="decimal"]', '1200')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

// Créer un livret puis un PEA.
await page.goto(base + '#/comptes/nouveau', { waitUntil: 'networkidle' })
await page.fill('#nom-compte-form', 'Livret A')
await page.selectOption('#type-compte', 'livret')
await page.fill('input[inputmode="decimal"]', '8500')
dit('1.', 'groupe proposé pour un livret : ' + (await page.inputValue('#groupe-compte')))
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Patrimoine")')

await page.goto(base + '#/comptes/nouveau', { waitUntil: 'networkidle' })
await page.fill('#nom-compte-form', 'PEA')
await page.selectOption('#type-compte', 'pea')
dit('2.', 'groupe proposé pour un PEA : ' + (await page.inputValue('#groupe-compte')))
await page.fill('input[inputmode="decimal"]', '15000')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Patrimoine")')

dit(
  '3.',
  'patrimoine : ' + (await page.locator('.montant-principal').first().textContent())?.trim(),
)
dit(
  '4.',
  'répartition : ' +
    (await page.locator('.carte .discret').first().textContent())?.replace(/\s+/g, ' ').trim(),
)
const groupes = await page.locator('.titre-groupe').allTextContents()
dit(
  '5.',
  'groupes affichés : ' +
    JSON.stringify(groupes) +
    ' · ' +
    (await page.locator('.carte-lien').count()) +
    ' comptes',
)

// Virement entre les deux comptes.
await page.goto(base + '#/ajout?sens=virement', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '300')
await page.selectOption('#vers', { label: 'Livret A' })
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Reste à vivre")')
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
const soldes = await page.locator('.carte-lien .montant').allTextContents()
dit(
  '6.',
  'après virement de 300 € : ' + JSON.stringify(soldes.map((s) => s.replace(/\s+/g, ' ').trim())),
)
dit(
  '7.',
  'patrimoine inchangé : ' +
    (await page.locator('.montant-principal').first().textContent())?.trim(),
)

// Le virement ne doit pas figurer dans les dépenses.
await page.goto(base + '#/depenses', { waitUntil: 'networkidle' })
dit(
  '8.',
  'dépenses du mois : ' + (await page.locator('.montant-principal').first().textContent())?.trim(),
)

// Archiver le PEA.
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
await page.click('.carte-lien:has-text("PEA")')
await page.waitForSelector('h1:has-text("PEA")')
await page.click('a:has-text("Modifier")')
await page.waitForSelector('h1:has-text("Modifier le compte")')
await page.click('button:has-text("Archiver ce compte")')
await page.click('button:has-text("Oui, archiver")')
await page.waitForSelector('h1:has-text("Patrimoine")')
dit(
  '9.',
  'après archivage du PEA : ' +
    (await page.locator('.montant-principal').first().textContent())?.trim() +
    ' · ' +
    (await page.locator('.carte-lien').count()) +
    ' comptes',
)

// Le compte courant ne doit pas pouvoir être archivé tant qu'il sert au reste à vivre.
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
await page.click('.carte-lien:has-text("Courant")')
await page.click('a:has-text("Modifier")')
await page.waitForSelector('h1:has-text("Modifier le compte")')
const protege = await page
  .locator('.carte:has(h2:text("Clôturer")) .discret')
  .textContent()
  .catch(() => null)
dit('10.', 'compte du reste à vivre : ' + (protege?.trim().slice(0, 80) ?? 'ARCHIVABLE'))

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
