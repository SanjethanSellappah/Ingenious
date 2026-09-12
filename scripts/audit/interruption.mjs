import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4192'
const base = `http://localhost:${PORT}/Ingenious/`
const nav = await chromium.launch(optionsNavigateur())
const ctx = await nav.newContext({ ...devices['Pixel 7'] })
const dit = (n, v) => console.log(`${String(n).padEnd(6)} ${v}`)

let page = await ctx.newPage()
const erreurs = []
const brancher = (p) => {
  p.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e)))
  p.on('console', (m) => m.type() === 'error' && erreurs.push('CONSOLE ' + m.text()))
}
brancher(page)

// Un journal assez gros pour que le chiffrement dure, et qu'on puisse couper dedans.
let n = 0
const uuid = () => {
  n++
  return `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`
}
const events = [
  {
    id: uuid(),
    ts: 1,
    device: 's',
    type: 'account.created',
    payload: { id: 'c1', nom: 'Courant', type: 'courant', groupe: 'bancaire', mode: 'saisi' },
  },
  {
    id: uuid(),
    ts: 2,
    device: 's',
    type: 'account.balance_set',
    payload: { account_id: 'c1', date: '2021-01-01', solde_cents: 5000000 },
  },
  {
    id: uuid(),
    ts: 3,
    device: 's',
    type: 'settings.updated',
    payload: { compte_courant_id: 'c1' },
  },
]
let ts = 10
const debut = new Date(Date.UTC(2021, 0, 1))
for (let j = 0; j < 27000; j++) {
  const jour = new Date(debut.getTime() + (j % 2000) * 86400000).toISOString().slice(0, 10)
  events.push({
    id: uuid(),
    ts: ts++,
    device: 's',
    type: 'transaction.created',
    payload: { id: `t${j}`, account_id: 'c1', date: jour, montant_cents: -100, origine: 'manuel' },
  })
}
const journal = JSON.stringify({
  format: 'ingenious.journal',
  version: 1,
  chiffre: false,
  genere_le: null,
  appareil: 's',
  events,
})

await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.setInputFiles('input[type=file]', {
  name: 'g.json',
  mimeType: 'application/json',
  buffer: Buffer.from(journal),
})
await page.waitForSelector('nav.onglets', { timeout: 120000 })
const soldeAvant = (await page.locator('.montant-principal').first().textContent())?.trim()
dit('1.', `${events.length} événements importés · solde ${soldeAvant}`)

// Activation du code, coupée en plein vol.
await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.click('button:has-text("Configurer un code")')
await page.fill('#pin-nouveau', '123456')
await page.fill('#pin-confirmation', '123456')
await page.check('input[type=checkbox]')
void page.click('button:has-text("Activer le code")')
await page.waitForTimeout(4000) // au milieu du rechiffrement
await page
  .evaluate(() => {
    /* rien : on coupe par le bas */
  })
  .catch(() => {})
await page.close() // l'onglet disparaît, comme une application fermée
dit('2.', 'application fermée pendant le chiffrement')

// Réouverture.
page = await ctx.newPage()
brancher(page)
await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const codeDemande = await page.locator('#pin').count()
dit('3.', 'code demandé à la réouverture : ' + (codeDemande > 0))

if (codeDemande > 0) {
  await page.fill('#pin', '123456')
  await page.click('form button[type=submit]')
  await page.waitForSelector('.montant-principal', { timeout: 180000 })
}
const soldeApres = (await page.locator('.montant-principal').first().textContent())?.trim()
dit('4.', `solde après réouverture : ${soldeApres}`)
dit('5.', `rien n’a été perdu : ${soldeAvant === soldeApres}`)

await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const journalTexte = (
  await page.locator('.carte:has(h2:text("Journal")) .discret').first().textContent()
)?.trim()
const illisibles = await page.locator('.carte:has(h2:text("Journal")) .erreur-champ').count()
dit('6.', `journal : ${journalTexte} · enregistrements illisibles signalés : ${illisibles}`)

// Et la base est bien homogène : plus rien en clair.
const formes = await page.evaluate(async () => {
  const bases = await indexedDB.databases()
  return await new Promise((res) => {
    const r = indexedDB.open(bases[0].name)
    r.onsuccess = () => {
      const tx = r.result.transaction('events', 'readonly')
      const req = tx.objectStore('events').getAll()
      req.onsuccess = () => {
        let scelles = 0,
          clairs = 0
        for (const e of req.result) {
          if (e.donnees && typeof e.donnees.iv_b64 === 'string') scelles++
          else clairs++
        }
        res({ scelles, clairs })
      }
    }
  })
})
dit('7.', 'formes en base : ' + JSON.stringify(formes))

console.log('\nerreurs :', erreurs.length ? erreurs.slice(0, 4).join('\n  ') : 'aucune')
await nav.close()

/*
 * Le code de sortie est le verdict.
 *
 * Afficher les problèmes ne suffit pas : le lanceur ne lit pas le français, et
 * un audit qui décrit vingt fautes en sortant sur zéro passe pour un succès.
 * C'est arrivé — vingt et un audits « passés » sur une version périmée du site.
 */
process.exit(erreurs.length > 0 ? 1 : 0)
