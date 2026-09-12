import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4192'
const base = `http://localhost:${PORT}/Ingenious/`
const nav = await chromium.launch(optionsNavigateur())
const dit = (n, v) => console.log(`${String(n).padEnd(6)} ${v}`)
const problemes = []
const exiger = (condition, quoi) => {
  if (!condition) problemes.push(quoi)
}

async function session(prepare) {
  const ctx = await nav.newContext({ ...devices['Pixel 7'], acceptDownloads: true })
  const page = await ctx.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e)))
  page.on('console', (m) => m.type() === 'error' && erreurs.push('CONSOLE ' + m.text()))
  if (prepare) await page.addInitScript(prepare)
  await page.goto(base + '#/', { waitUntil: 'networkidle' })
  await page.fill('#nom-compte', 'Courant')
  await page.fill('input[inputmode="decimal"]', '1000')
  await page.click('button:has-text("Continuer")')
  await page.fill('input[inputmode="decimal"]', '2000')
  await page.click('button:has-text("Continuer")')
  await page.waitForSelector('#abo-nom-0')
  await page.click('button:has-text("Terminer")')
  await page.waitForSelector('nav.onglets')
  return { ctx, page, erreurs }
}
const msg = (page) =>
  page.locator('.carte:has(h2:text("Sauvegarde")) [role=status]').first().textContent()
const rappelVisible = (page) => page.locator('.carte.a-confirmer:has-text("Sauvegarde")').count()

// --- 1. Pas de partage : téléchargement par lien ---
{
  const { ctx, page, erreurs } = await session(() => {
    delete Navigator.prototype.share
    delete Navigator.prototype.canShare
  })
  await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
  dit('1.', 'rappel avant export : ' + ((await rappelVisible(page)) > 0))
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('button:has-text("Exporter")'),
  ])
  dit('1b.', 'fichier téléchargé : ' + dl.suggestedFilename())
  exiger(
    /^ingenious-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()),
    'nom de fichier inattendu',
  )
  const flux = await dl.createReadStream()
  let contenu = ''
  for await (const bloc of flux) contenu += bloc
  const journal = JSON.parse(contenu)
  dit(
    '1c.',
    `contenu : format=${journal.format} · ${journal.events.length} événements · chiffre=${journal.chiffre}`,
  )
  await page.waitForTimeout(400)
  dit('1d.', 'message : ' + (await msg(page))?.trim())
  const rappel1 = (await rappelVisible(page)) > 0
  dit('1e.', 'rappel après export : ' + rappel1)
  exiger(!rappel1, 'le rappel de sauvegarde subsiste après un export réussi')
  dit('1f.', 'erreurs : ' + (erreurs.length ? erreurs.join(' | ') : 'aucune'))
  exiger(erreurs.length === 0, 'erreurs pendant le téléchargement : ' + erreurs.join(' | '))
  await ctx.close()
}

// --- 2. Partage accepté ---
{
  const { ctx, page, erreurs } = await session(() => {
    Navigator.prototype.canShare = function () {
      return true
    }
    Navigator.prototype.share = function (d) {
      window.__partage = {
        noms: (d.files ?? []).map((f) => f.name),
        taille: (d.files ?? []).map((f) => f.size),
      }
      return Promise.resolve()
    }
  })
  await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
  await page.click('button:has-text("Exporter")')
  await page.waitForTimeout(700)
  const partage = await page.evaluate(() => window.__partage ?? null)
  dit('2.', 'partage reçu : ' + JSON.stringify(partage))
  exiger(
    partage !== null && partage.noms.length === 1,
    'la feuille de partage n’a reçu aucun fichier',
  )
  exiger(partage !== null && partage.taille[0] > 0, 'le fichier partagé est vide')
  dit('2b.', 'message : ' + (await msg(page))?.trim())
  const rappel2 = (await rappelVisible(page)) > 0
  dit('2c.', 'rappel après partage : ' + rappel2)
  exiger(!rappel2, 'le rappel subsiste après un partage réussi')
  dit('2d.', 'erreurs : ' + (erreurs.length ? erreurs.join(' | ') : 'aucune'))
  exiger(erreurs.length === 0, 'erreurs pendant le partage : ' + erreurs.join(' | '))
  await ctx.close()
}

// --- 3. Partage annulé : rien ne doit être considéré comme sauvegardé ---
{
  const { ctx, page, erreurs } = await session(() => {
    Navigator.prototype.canShare = function () {
      return true
    }
    Navigator.prototype.share = function () {
      return Promise.reject(new DOMException('annulé', 'AbortError'))
    }
  })
  await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
  await page.click('button:has-text("Exporter")')
  await page.waitForTimeout(700)
  const message3 = (await msg(page))?.trim()
  dit('3.', 'message : ' + message3)
  exiger(/annul/i.test(message3 ?? ''), 'un partage annulé n’est pas annoncé comme tel')
  const rappel3 = (await rappelVisible(page)) > 0
  dit('3b.', 'rappel TOUJOURS présent : ' + rappel3)
  exiger(rappel3, 'un partage annulé efface le rappel : aucune sauvegarde n’a pourtant eu lieu')
  await page.goto(base + '#/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  dit(
    '3c.',
    'rappel aussi sur l’accueil : ' +
      ((await page.locator('.carte.a-confirmer:has-text("Sauvegarde")').count()) > 0),
  )
  dit('3d.', 'erreurs : ' + (erreurs.length ? erreurs.join(' | ') : 'aucune'))
  exiger(erreurs.length === 0, 'erreurs pendant l’annulation : ' + erreurs.join(' | '))
  await ctx.close()
}

// --- 4. Partage refusé par le navigateur (geste consommé) : repli sur le lien ---
{
  const { ctx, page, erreurs } = await session(() => {
    Navigator.prototype.canShare = function () {
      return true
    }
    Navigator.prototype.share = function () {
      return Promise.reject(new DOMException('geste requis', 'NotAllowedError'))
    }
  })
  await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('button:has-text("Exporter")'),
  ])
  dit('4.', 'repli sur le téléchargement : ' + dl.suggestedFilename())
  exiger(dl.suggestedFilename().endsWith('.json'), 'le repli n’a pas produit de fichier')
  await page.waitForTimeout(400)
  const rappel4 = (await rappelVisible(page)) > 0
  dit('4b.', 'rappel après repli : ' + rappel4)
  exiger(!rappel4, 'le rappel subsiste après un repli réussi')
  dit('4c.', 'erreurs : ' + (erreurs.length ? erreurs.join(' | ') : 'aucune'))
  exiger(erreurs.length === 0, 'erreurs pendant le repli : ' + erreurs.join(' | '))
  await ctx.close()
}

await nav.close()

/*
 * Le code de sortie est le verdict.
 *
 * Afficher les problèmes ne suffit pas : le lanceur ne lit pas le français, et
 * un audit qui décrit vingt fautes en sortant sur zéro passe pour un succès.
 * C'est arrivé — vingt et un audits « passés » sur une version périmée du site.
 */
console.log('\nproblèmes :', problemes.length ? problemes.join('\n  ') : 'aucun')
process.exit(problemes.length > 0 ? 1 : 0)
