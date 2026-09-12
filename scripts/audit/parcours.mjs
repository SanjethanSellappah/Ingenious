import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4194'
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
await page.fill('input[inputmode="decimal"]', '800')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

// A. Créer un second compte via un virement ? Impossible sans second compte :
//    on vérifie que l'écran le dit au lieu de planter.
await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '100')
await page.click('button:has-text("Virement")')
await page.waitForTimeout(200)
const virementImpossible = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) =>
    x.textContent?.includes('Enregistrer'),
  )
  return {
    boutonDesactive: b?.disabled,
    optionsVers: document.querySelector('#vers')?.options.length,
  }
})
dit('A.', 'virement sans second compte : ' + JSON.stringify(virementImpossible))

// B. Abonnement : créer, modifier, terminer
await page.goto(base + '#/abonnements/nouveau', { waitUntil: 'networkidle' })
await page.fill('#nom-abo', 'Électricité')
await page.click('button:has-text("Variable")')
await page.fill('#jour-mois', '20')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Abonnements")')
dit(
  'B.',
  'abonnement variable créé, coût affiché : ' +
    (await page.locator('.montant-principal').first().textContent())?.trim(),
)

await page.click('.carte:has(h2:text("Électricité")) a:has-text("Modifier")')
await page.waitForSelector('#nom-abo')
const nomCharge = await page.inputValue('#nom-abo')
await page.fill('#nom-abo', 'Électricité EDF')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Abonnements")')
const apresModif = await page.locator('.carte:has(a:has-text("Modifier")) h2').last().textContent()
dit('B2.', `modification : « ${nomCharge} » → « ${apresModif?.trim()} »`)

await page.click('.carte:has(h2:text("Électricité EDF")) a:has-text("Modifier")')
await page.waitForSelector('#nom-abo')
await page.click('button:has-text("Cet abonnement est terminé")')
await page.waitForSelector('h1:has-text("Abonnements")')
dit(
  'B3.',
  'terminé : ' +
    (await page.locator('.carte:has(h2:text("Électricité EDF")) h2').first().textContent())?.trim(),
)

// C. Occurrence à confirmer, avec un montant différent
await page.goto(base + '#/confirmer', { waitUntil: 'networkidle' })
const nbAConfirmer = await page.locator('.carte:has(h2)').count()
dit(
  'C.',
  'à confirmer : ' + (await page.locator('h1').textContent()) + ' — ' + nbAConfirmer + ' carte(s)',
)

// D. Calendrier : navigation entre mois
await page.goto(base + '#/calendrier', { waitUntil: 'networkidle' })
const moisInitial = await page.locator('.navigation-mois strong').textContent()
await page.click('.navigation-mois button >> nth=1')
await page.waitForTimeout(250)
const moisSuivant = await page.locator('.navigation-mois strong').textContent()
await page.click('.navigation-mois button >> nth=0')
await page.click('.navigation-mois button >> nth=0')
await page.waitForTimeout(250)
const moisPrecedent = await page.locator('.navigation-mois strong').textContent()
dit('D.', `calendrier : ${moisInitial} → ${moisSuivant} → ${moisPrecedent}`)

// E. Dépenses : mois sans dépense
await page.goto(base + '#/depenses', { waitUntil: 'networkidle' })
await page.click('.navigation-mois button >> nth=0')
await page.waitForTimeout(250)
dit('E.', 'mois vide : ' + (await page.locator('.carte .discret').last().textContent())?.trim())

// F. Réglages : budget d'un label, puis archivage
await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '60')
await page.fill('#nouveau-label', 'Courses')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Reste à vivre")')
await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.click('.carte:has(h2:text("Labels")) button:has-text("Modifier")')
await page.waitForSelector('.carte:has(h2:text("Labels")) input[inputmode="decimal"]')
await page.fill('.carte:has(h2:text("Labels")) input[inputmode="decimal"]', '300')
await page.locator('.carte:has(h2:text("Labels")) .actions button:has-text("Enregistrer")').click()
await page.waitForTimeout(400)
dit(
  'F.',
  'budget posé : ' +
    (await page.locator('.carte:has(h2:text("Labels")) .liste li').first().textContent())?.trim(),
)

await page.goto(base + '#/depenses', { waitUntil: 'networkidle' })
dit(
  'F2.',
  'suivi budget : ' + (await page.locator('.carte .discret').first().textContent())?.trim(),
)

await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.click('.carte:has(h2:text("Labels")) button:has-text("Archiver")')
await page.waitForTimeout(400)
dit(
  'F3.',
  'après archivage : ' +
    (await page.locator('.carte:has(h2:text("Labels")) .discret').first().textContent())?.trim(),
)

// G. Solde négatif : l'alerte apparaît-elle ?
await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '3000')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Reste à vivre")')
const alerte = await page
  .locator('.avertissement')
  .first()
  .textContent()
  .catch(() => null)
dit('G.', 'alerte point bas : ' + (alerte?.trim().slice(0, 90) ?? 'ABSENTE'))
dit(
  'G2.',
  'reste à vivre : ' + (await page.locator('.montant-principal').first().textContent())?.trim(),
)

// H. Import du fichier exporté dans un contexte neuf
await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
const dl = page.waitForEvent('download', { timeout: 8000 })
await page.click('button:has-text("Exporter")')
const chemin = await (await dl).path()

const ctx2 = await nav.newContext({ ...devices['Pixel 7'] })
const page2 = await ctx2.newPage()
page2.on('pageerror', (e) => erreurs.push('PAGE2 ' + String(e)))
await page2.goto(base + '#/', { waitUntil: 'networkidle' })
await page2.waitForSelector('#nom-compte')
dit('H.', 'appareil neuf : onboarding affiché')
// L'import se fait depuis les réglages, inaccessibles avant l'onboarding :
// on passe l'onboarding au minimum puis on importe.
await page2.fill('#nom-compte', 'Temporaire')
await page2.fill('input[inputmode="decimal"]', '0')
await page2.click('button:has-text("Continuer")')
await page2.click('button:has-text("Continuer")')
await page2.click('button:has-text("Terminer")')
await page2.waitForSelector('nav.onglets')
await page2.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page2.setInputFiles('input[type=file]', chemin)
await page2.waitForTimeout(1200)
dit('H2.', 'import : ' + (await page2.locator('[role=status]').textContent())?.trim())
await page2.goto(base + '#/comptes', { waitUntil: 'networkidle' })
dit('H3.', 'comptes après import : ' + (await page2.locator('.carte-lien').count()) + ' compte(s)')

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
