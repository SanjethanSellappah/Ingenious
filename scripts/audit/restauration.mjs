import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4192'
const base = `http://localhost:${PORT}/Ingenious/`
const nav = await chromium.launch(optionsNavigateur())
const dit = (n, v) => console.log(`${String(n).padEnd(6)} ${v}`)
const erreurs = []
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const env = (events) =>
  JSON.stringify({
    format: 'ingenious.journal',
    version: 1,
    chiffre: false,
    genere_le: null,
    appareil: 'A',
    events,
  })

async function neuf() {
  const ctx = await nav.newContext({ ...devices['Pixel 7'] })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e)))
  page.on('console', (m) => m.type() === 'error' && erreurs.push('CONSOLE ' + m.text()))
  await page.goto(base + '#/', { waitUntil: 'networkidle' })
  return { ctx, page }
}
const deposer = async (page, contenu) => {
  await page.setInputFiles('input[type=file]', {
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(contenu),
  })
  await page.waitForTimeout(1400)
}

const compteOk = (n, nom, solde) => [
  {
    id: uuid(n),
    ts: 1000 + n,
    device: 'A',
    type: 'account.created',
    payload: { id: 'c' + n, nom, type: 'courant', groupe: 'bancaire', mode: 'saisi' },
  },
  {
    id: uuid(n + 50),
    ts: 1001 + n,
    device: 'A',
    type: 'account.balance_set',
    payload: { account_id: 'c' + n, date: '2026-09-01', solde_cents: solde },
  },
]

// --- 1. Sauvegarde partiellement abîmée : l'écran doit tenir et dire pourquoi ---
{
  const { ctx, page } = await neuf()
  await deposer(
    page,
    env([
      ...compteOk(1, 'Courant', 123456),
      {
        id: uuid(9),
        ts: 1100,
        device: 'A',
        type: 'transaction.created',
        payload: {
          id: 't1',
          account_id: 'c1',
          date: '2026-02-30',
          montant_cents: -100,
          origine: 'saisi',
        },
      },
      {
        id: 'pas-un-uuid',
        ts: 1101,
        device: 'A',
        type: 'label.created',
        payload: { id: 'l1', nom: 'X', couleur: '#fff' },
      },
    ]),
  )
  dit('1.', 'écran toujours là : ' + ((await page.locator('h1:has-text("Bienvenue")').count()) > 0))
  dit('1b.', 'message : ' + (await page.locator('[role=status]').first().textContent())?.trim())
  const raisons = await page.locator('.erreur-champ li').allTextContents()
  dit('1c.', 'raisons affichées : ' + JSON.stringify(raisons))
  dit(
    '1d.',
    'bouton de sortie : ' +
      ((await page.locator('button:has-text("Continuer avec ce qui a été lu")').count()) > 0),
  )
  await page.click('button:has-text("Continuer avec ce qui a été lu")')
  await page.waitForSelector('nav.onglets', { timeout: 10000 })
  await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  dit(
    '1e.',
    'après continuation, patrimoine : ' +
      (await page.locator('.montant-principal').first().textContent())?.trim(),
  )
  await ctx.close()
}

// --- 2. Sauvegarde saine : l'application s'ouvre directement ---
{
  const { ctx, page } = await neuf()
  await deposer(page, env(compteOk(2, 'Livret', 500000)))
  dit('2.', 'onboarding passé : ' + ((await page.locator('nav.onglets').count()) > 0))
  await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  dit(
    '2b.',
    'patrimoine : ' + (await page.locator('.montant-principal').first().textContent())?.trim(),
  )
  dit(
    '2c.',
    'aucun compte fictif : ' +
      JSON.stringify(
        (await page.locator('.liste li a, .carte h2').allTextContents()).map((t) => t.trim()),
      ),
  )
  await ctx.close()
}

// --- 3. Fichier qui n'est pas un journal : on reste, et on le dit ---
{
  const { ctx, page } = await neuf()
  await deposer(page, JSON.stringify({ format: 'autre', version: 1, events: [] }))
  dit('3.', 'écran toujours là : ' + ((await page.locator('h1:has-text("Bienvenue")').count()) > 0))
  dit('3b.', 'message : ' + (await page.locator('[role=status]').first().textContent())?.trim())
  await ctx.close()
}

// --- 4. Journal vide : rien à restaurer, et on le dit ---
{
  const { ctx, page } = await neuf()
  await deposer(page, env([]))
  dit('4.', 'écran toujours là : ' + ((await page.locator('h1:has-text("Bienvenue")').count()) > 0))
  dit('4b.', 'message : ' + (await page.locator('[role=status]').first().textContent())?.trim())
  dit(
    '4c.',
    'la saisie normale reste possible : ' + ((await page.locator('#nom-compte').count()) > 0),
  )
  await ctx.close()
}

console.log('\nerreurs :', erreurs.length ? erreurs.join('\n  ') : 'aucune')
await nav.close()

/*
 * Le code de sortie est le verdict.
 *
 * Afficher les problèmes ne suffit pas : le lanceur ne lit pas le français, et
 * un audit qui décrit vingt fautes en sortant sur zéro passe pour un succès.
 * C'est arrivé — vingt et un audits « passés » sur une version périmée du site.
 */
process.exit(erreurs.length > 0 ? 1 : 0)
