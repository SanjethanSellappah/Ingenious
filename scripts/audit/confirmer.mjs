import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4203'
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
await page.fill('input[inputmode="decimal"]', '1000')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

// Un abonnement dont l'échéance est déjà passée : on remonte sa date de début.
await page.goto(base + '#/abonnements/nouveau', { waitUntil: 'networkidle' })
await page.fill('#nom-abo', 'Électricité')
await page.click('button:has-text("Variable")')
await page.fill('#jour-mois', '5')
await page.fill('#debut', '2026-06-05')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Abonnements")')

await page.goto(base + '#/', { waitUntil: 'networkidle' })
const carte = await page.locator('.a-confirmer').count()
dit('1.', 'carte « à confirmer » sur l’accueil : ' + (carte > 0 ? 'présente' : 'ABSENTE'))
if (carte > 0)
  dit(
    '1b.',
    (await page.locator('.a-confirmer .discret').first().textContent())?.trim().slice(0, 100),
  )

// Une échéance sans montant : elle doit être signalée, pas comptée à zéro.
const sansMontant = await page
  .locator('.erreur-champ')
  .first()
  .textContent()
  .catch(() => null)
dit('2.', 'échéance sans montant : ' + (sansMontant?.trim().slice(0, 80) ?? 'aucune'))

await page.goto(base + '#/confirmer', { waitUntil: 'networkidle' })
const cartes = await page.locator('.carte:has(h2)').count()
dit('3.', 'occurrences à confirmer : ' + cartes)
if (cartes > 0) {
  dit(
    '3b.',
    'première carte : ' +
      (await page.locator('.carte:has(h2) .discret').first().textContent())?.trim(),
  )
  const saisieOuverte = await page.locator('input[inputmode="decimal"]').count()
  if (saisieOuverte === 0) await page.click('button:has-text("Montant différent")')
  await page.waitForSelector('input[inputmode="decimal"]')
  await page.locator('input[inputmode="decimal"]').first().fill('78,40')
  await page.locator('.carte button:has-text("Enregistrer")').first().click()
  await page.waitForTimeout(900)
  dit(
    '4.',
    'après confirmation : ' + (await page.locator('.carte:has(h2)').count()) + ' restante(s)',
  )
}

await page.goto(base + '#/', { waitUntil: 'networkidle' })
dit(
  '5.',
  'solde/reste à vivre : ' +
    (await page.locator('.montant-principal').first().textContent())?.trim(),
)
const echeances = await page
  .locator('.carte:has(h2:text("Prochaines")) .liste li')
  .allTextContents()
dit(
  '6.',
  'prochaines échéances : ' + JSON.stringify(echeances.map((t) => t.replace(/\s+/g, ' ').trim())),
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
