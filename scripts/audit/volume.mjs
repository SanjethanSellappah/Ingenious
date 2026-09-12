import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4192'
const N_ANS = Number(process.argv[3] ?? 5)
const base = `http://localhost:${PORT}/Ingenious/`
const nav = await chromium.launch(optionsNavigateur())
const ctx = await nav.newContext({ ...devices['Pixel 7'] })
const page = await ctx.newPage()
const erreurs = []
const problemes = []
const exiger = (condition, quoi) => {
  if (!condition) problemes.push(quoi)
}
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e)))
page.on('console', (m) => m.type() === 'error' && erreurs.push('CONSOLE ' + m.text()))
const dit = (n, v) => console.log(`${String(n).padEnd(6)} ${v}`)

// Un journal réaliste : 3 comptes, un instantané par compte et par jour ouvert,
// deux dépenses par jour, une échéance confirmée par mois.
let n = 0
const uuid = () => {
  n++
  return `${String(n).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`
}
const events = []
const COMPTES = ['c1', 'c2', 'c3']
let ts = Date.UTC(2021, 0, 1)
for (const [i, c] of COMPTES.entries()) {
  events.push({
    id: uuid(),
    ts: ts++,
    device: 'seed',
    type: 'account.created',
    payload: {
      id: c,
      nom: `Compte ${i + 1}`,
      type: i === 0 ? 'courant' : 'livret',
      groupe: 'bancaire',
      mode: 'saisi',
    },
  })
  events.push({
    id: uuid(),
    ts: ts++,
    device: 'seed',
    type: 'account.balance_set',
    payload: { account_id: c, date: '2021-01-01', solde_cents: 100000 * (i + 1) },
  })
}
events.push({
  id: uuid(),
  ts: ts++,
  device: 'seed',
  type: 'settings.updated',
  payload: { compte_courant_id: 'c1', reserve_cents: 20000 },
})
const jourDe = (d) => d.toISOString().slice(0, 10)
const debut = new Date(Date.UTC(2021, 0, 1))
const jours = 365 * N_ANS
for (let j = 0; j < jours; j++) {
  const d = new Date(debut.getTime() + j * 86400000)
  const jour = jourDe(d)
  for (const c of COMPTES) {
    events.push({
      id: uuid(),
      ts: ts++,
      device: 'seed',
      type: 'snapshot.recorded',
      payload: { account_id: c, date: jour, valeur_cents: 100000 },
    })
  }
  for (let k = 0; k < 2; k++) {
    events.push({
      id: uuid(),
      ts: ts++,
      device: 'seed',
      type: 'transaction.created',
      payload: {
        id: `t${j}-${k}`,
        account_id: 'c1',
        date: jour,
        montant_cents: -(1000 + k * 250),
        origine: 'manuel',
        note: 'Dépense courante',
      },
    })
  }
}
const journal = JSON.stringify({
  format: 'ingenious.journal',
  version: 1,
  chiffre: false,
  genere_le: null,
  appareil: 'seed',
  events,
})
dit(
  '0.',
  `journal de synthèse : ${events.length} événements (${N_ANS} ans, 3 comptes) · ${(journal.length / 1e6).toFixed(1)} Mo en clair`,
)

// Restauration depuis l'écran de bienvenue.
await page.goto(base + '#/', { waitUntil: 'networkidle' })
const t0 = Date.now()
await page.setInputFiles('input[type=file]', {
  name: 'gros.json',
  mimeType: 'application/json',
  buffer: Buffer.from(journal),
})
await page.waitForSelector('nav.onglets', { timeout: 180000 })
dit('1.', `import + ouverture : ${((Date.now() - t0) / 1000).toFixed(1)} s`)

async function chrono(nom, aller) {
  const t = Date.now()
  await aller()
  const ms = Date.now() - t
  dit(nom, `${ms} ms`)
  return ms
}

await chrono('2.', async () => {
  await page.goto(base + '#/', { waitUntil: 'networkidle' })
  await page.waitForSelector('h1')
})
await chrono('3.', async () => {
  await page.goto(base + '#/calendrier', { waitUntil: 'networkidle' })
  await page.waitForSelector('h1')
})
await chrono('4.', async () => {
  await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
  await page.waitForSelector('h1')
})
await chrono('5.', async () => {
  await page.goto(base + '#/depenses', { waitUntil: 'networkidle' })
  await page.waitForSelector('h1')
})

// Ouverture à froid, sans code.
const tFroid = Date.now()
await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.waitForSelector('.montant-principal', { timeout: 180000 })
dit('6.', `ouverture à froid, en clair : ${((Date.now() - tFroid) / 1000).toFixed(1)} s`)

// Puis avec un code : tout est chiffré, il faut tout déchiffrer à l'ouverture.
await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.click('button:has-text("Configurer un code")')
await page.fill('#pin-nouveau', '123456')
await page.fill('#pin-confirmation', '123456')
await page.check('input[type=checkbox]')
const tChiffre = Date.now()
await page.click('button:has-text("Activer le code")')
await page.waitForSelector('nav.onglets', { timeout: 300000 })
dit('7.', `chiffrement de tout le journal : ${((Date.now() - tChiffre) / 1000).toFixed(1)} s`)

// Retour sur l'accueil avant de recharger : c'est là que vit le chiffre
// attendu, et un rechargement conserve le hash de l'écran courant.
await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('#pin', { timeout: 60000 })
await page.fill('#pin', '123456')
const tDechiffre = Date.now()
await page.click('form button[type=submit]')
await page.waitForSelector('.montant-principal', { timeout: 300000 })
dit('8.', `ouverture à froid, chiffré : ${((Date.now() - tDechiffre) / 1000).toFixed(1)} s`)

const solde = (await page.locator('.montant-principal').first().textContent())?.trim()
dit('9.', `l’application reste juste : ${solde}`)
exiger(solde !== null && solde.trim() !== '', 'aucun montant affiché après ouverture à volume')
const taille = await page.evaluate(async () => {
  const e = await navigator.storage.estimate()
  return `${(e.usage / 1e6).toFixed(1)} Mo utilisés`
})
dit('10.', 'stockage : ' + taille)

console.log('\nerreurs :', erreurs.length ? erreurs.slice(0, 5).join('\n  ') : 'aucune')
await nav.close()

/*
 * Le code de sortie est le verdict.
 *
 * Afficher les problèmes ne suffit pas : le lanceur ne lit pas le français, et
 * un audit qui décrit vingt fautes en sortant sur zéro passe pour un succès.
 * C'est arrivé — vingt et un audits « passés » sur une version périmée du site.
 */
console.log('problèmes :', problemes.length ? problemes.join('\n  ') : 'aucun')
process.exit(problemes.length > 0 || erreurs.length > 0 ? 1 : 0)
