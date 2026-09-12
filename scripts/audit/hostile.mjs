import { chromium } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4192'
const base = `http://localhost:${PORT}/Ingenious/`
const b = await chromium.launch(optionsNavigateur())
const ctx = await b.newContext()
const page = await ctx.newPage()
const erreurs = []
page.on('pageerror', (e) => erreurs.push('pageerror: ' + e.message))
page.on('console', (m) => {
  if (m.type() === 'error') erreurs.push('console: ' + m.text())
})
await page.goto(base + '#/', { waitUntil: 'networkidle' })

await page.fill('#nom-compte', 'Courant')
await page.fill('input[inputmode="decimal"]', '1000')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const env = (events) =>
  JSON.stringify({
    format: 'ingenious.journal',
    version: 1,
    chiffre: false,
    genere_le: '2026-01-01T00:00:00.000Z',
    appareil: 'hostile',
    events,
  })

const cas = {
  'proto dans payload': env([
    {
      id: uuid(1),
      ts: 1,
      device: 'x',
      type: 'label.created',
      payload: JSON.parse(
        '{"id":"lab-proto","nom":"Hostile","couleur":"#fff","__proto__":{"pollue":true}}',
      ),
    },
  ]),
  'constructor.prototype': env([
    {
      id: uuid(2),
      ts: 1,
      device: 'x',
      type: 'label.created',
      payload: JSON.parse(
        '{"id":"lab-ctor","nom":"Hostile2","couleur":"#fff","constructor":{"prototype":{"pollue2":true}}}',
      ),
    },
  ]),
  'entier non sûr': env([
    {
      id: uuid(3),
      ts: 1,
      device: 'x',
      type: 'transaction.created',
      payload: { id: 't1', account_id: 'a', date: '2026-01-01', montant_cents: 9e18 },
    },
  ]),
  'ts négatif': env([
    {
      id: uuid(4),
      ts: -1,
      device: 'x',
      type: 'label.created',
      payload: { id: 'l3', nom: 'Z', nom_normalise: 'z' },
    },
  ]),
  'id non-uuid': env([
    {
      id: 'pas-un-uuid',
      ts: 1,
      device: 'x',
      type: 'label.created',
      payload: { id: 'l4', nom: 'W', nom_normalise: 'w' },
    },
  ]),
  'type inconnu': env([
    { id: uuid(5), ts: 1, device: 'x', type: 'account.destroyed', payload: {} },
  ]),
  'payload tableau': env([{ id: uuid(6), ts: 1, device: 'x', type: 'label.created', payload: [] }]),
  'nom géant': env([
    {
      id: uuid(7),
      ts: 1,
      device: 'x',
      type: 'label.created',
      payload: { id: 'l5', nom: 'A'.repeat(100000), nom_normalise: 'a' },
    },
  ]),
  'json tronqué': '{"format":"ingenious.journal","version":1,"events":[',
  'mauvais format': JSON.stringify({ format: 'autre.chose', version: 1, events: [] }),
  'version future': JSON.stringify({
    format: 'ingenious.journal',
    version: 99,
    chiffre: false,
    genere_le: null,
    appareil: null,
    events: [],
  }),
  'date invalide': env([
    {
      id: uuid(8),
      ts: 1,
      device: 'x',
      type: 'transaction.created',
      payload: { id: 't2', account_id: 'a', date: '2026-02-30', montant_cents: -100 },
    },
  ]),
  doublons: env([
    {
      id: uuid(9),
      ts: 1,
      device: 'x',
      type: 'label.created',
      payload: { id: 'lab-d', nom: 'Doublon', couleur: '#fff' },
    },
    {
      id: uuid(9),
      ts: 2,
      device: 'y',
      type: 'label.created',
      payload: { id: 'lab-e', nom: 'Autre', couleur: '#fff' },
    },
  ]),
  'refus multiples': env(
    Array.from({ length: 12 }, (_, i) => ({
      id: uuid(100 + i),
      ts: 1,
      device: 'x',
      type: 'label.created',
      payload: { id: 'bad' + i, nom: 'B' },
    })),
  ),
}

await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
for (const [nom, contenu] of Object.entries(cas)) {
  await page.setInputFiles('input[type=file]', {
    name: 'h.json',
    mimeType: 'application/json',
    buffer: Buffer.from(contenu),
  })
  await page.waitForTimeout(600)
  const msg = (
    await page.locator('.carte:has(h2:text("Sauvegarde")) [role=status]').allTextContents()
  )
    .join(' ')
    .trim()
  const pourquoi = (
    await page.locator('.carte:has(h2:text("Sauvegarde")) .erreur-champ').allTextContents()
  )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  console.log(`${nom.padEnd(24)} → ${msg || '(aucun message)'}`)
  if (pourquoi) console.log(`${' '.repeat(26)}  ${pourquoi.slice(0, 190)}`)
}

const pollution = await page.evaluate(() => ({
  proto: {}.pollue ?? null,
  proto2: {}.pollue2 ?? null,
  objProto: Object.prototype.pollue ?? null,
}))
console.log('pollution prototype :', JSON.stringify(pollution))

await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
console.log('accueil encore vivant :', (await page.locator('h1').first().textContent())?.trim())
await page.goto(base + '#/depenses', { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
console.log('dépenses :', (await page.locator('h1').first().textContent())?.trim())

console.log('\nerreurs :', erreurs.length ? erreurs.slice(0, 6).join('\n  ') : 'aucune')
await b.close()

/*
 * Le code de sortie est le verdict.
 *
 * Afficher les problèmes ne suffit pas : le lanceur ne lit pas le français, et
 * un audit qui décrit vingt fautes en sortant sur zéro passe pour un succès.
 * C'est arrivé — vingt et un audits « passés » sur une version périmée du site.
 */
process.exit(erreurs.length > 0 ? 1 : 0)
