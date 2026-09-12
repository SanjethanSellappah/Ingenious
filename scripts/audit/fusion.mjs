import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4192'
const base = `http://localhost:${PORT}/Ingenious/`
const nav = await chromium.launch(optionsNavigateur())
const dit = (n, v) => console.log(`${String(n).padEnd(6)} ${v}`)
const erreurs = []

async function appareil(nom) {
  const ctx = await nav.newContext({ ...devices['Pixel 7'], acceptDownloads: true })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => erreurs.push(`${nom} PAGEERROR ` + String(e)))
  page.on('console', (m) => m.type() === 'error' && erreurs.push(`${nom} CONSOLE ` + m.text()))
  return { nom, ctx, page }
}

async function exporter(a) {
  await a.page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
  const [dl] = await Promise.all([
    a.page.waitForEvent('download', { timeout: 20000 }),
    a.page.click('button:has-text("Exporter")'),
  ])
  const flux = await dl.createReadStream()
  let contenu = ''
  for await (const bloc of flux) contenu += bloc
  return contenu
}

// Un appareil neuf n'a pas de Réglages : il a l'écran d'accueil, qui doit
// porter la restauration. Un appareil déjà installé passe par Réglages.
async function importer(a, contenu) {
  const neuf = await a.page.locator('h1:has-text("Bienvenue")').count()
  if (neuf === 0) await a.page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
  await a.page.setInputFiles('input[type=file]', {
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(contenu),
  })
  await a.page.waitForTimeout(1500)
  // Sur un appareil neuf, une restauration réussie ouvre l'application : l'écran
  // qui portait le message n'existe plus, et c'est le résultat attendu.
  const statut = a.page.locator('[role=status]')
  if ((await statut.count()) === 0) return 'restauré, application ouverte'
  return (await statut.first().textContent())?.trim()
}

// Empreinte observable de l'appareil : ce que l'utilisateur voit, pas la base.
async function empreinte(a) {
  await a.page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
  await a.page.waitForTimeout(400)
  const patrimoine = (
    await a.page.locator('.montant-principal, .principal').first().textContent()
  )?.trim()
  const comptes = (await a.page.locator('.carte h2, .liste li').allTextContents())
    .map((t) => t.trim())
    .filter(Boolean)
    .sort()
  await a.page.goto(base + '#/abonnements', { waitUntil: 'networkidle' })
  await a.page.waitForTimeout(300)
  const abos = (await a.page.locator('.carte h2').allTextContents()).map((t) => t.trim()).sort()
  await a.page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
  await a.page.waitForTimeout(300)
  const journal = (
    await a.page.locator('.carte:has(h2:text("Journal")) .discret').first().textContent()
  )?.trim()
  return { patrimoine, comptes, abos, journal }
}

// --- A : installation, puis données ---
const A = await appareil('A')
await A.page.goto(base + '#/', { waitUntil: 'networkidle' })
await A.page.fill('#nom-compte', 'Courant')
await A.page.fill('input[inputmode="decimal"]', '1000')
await A.page.click('button:has-text("Continuer")')
await A.page.fill('input[inputmode="decimal"]', '2000')
await A.page.click('button:has-text("Continuer")')
await A.page.waitForSelector('#abo-nom-0')
await A.page.click('button:has-text("Terminer")')
await A.page.waitForSelector('nav.onglets')
dit('1.', 'appareil A installé')

// --- B : appareil neuf, reçoit l'export de A ---
const B = await appareil('B')
await B.page.goto(base + '#/', { waitUntil: 'networkidle' })
const neuf = await B.page.locator('text=Bienvenue').count()
const sauvegardeA = await exporter(A)
dit(
  '2.',
  `B est neuf : ${neuf > 0} · export de A : ${JSON.parse(sauvegardeA).events.length} événements`,
)
dit('2b.', 'import sur B : ' + (await importer(B, sauvegardeA)))

const empA0 = await empreinte(A)
const empB0 = await empreinte(B)
dit('3.', `après import, A = B : ${JSON.stringify(empA0) === JSON.stringify(empB0)}`)
dit(
  '3b.',
  `A ${empA0.patrimoine} · ${empA0.journal}   |   B ${empB0.patrimoine} · ${empB0.journal}`,
)

// --- Chacun travaille de son côté, hors ligne ---
async function ajouterDepense(a, montant, note) {
  await a.page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
  await a.page.fill('input[inputmode="decimal"]', montant)
  const note_ = a.page.locator('#note')
  if (await note_.count()) await note_.fill(note)
  await a.page.click('button:has-text("Enregistrer")')
  await a.page.waitForTimeout(700)
}
await ajouterDepense(A, '30', 'Livres sur A')
await ajouterDepense(A, '12,50', 'Café sur A')
await ajouterDepense(B, '45,90', 'Pharmacie sur B')
dit('4.', 'A a saisi 2 dépenses, B en a saisi 1, sans se voir')

// --- Échange croisé ---
const sauvegardeA2 = await exporter(A)
const sauvegardeB2 = await exporter(B)
dit('5.', 'import de B sur A : ' + (await importer(A, sauvegardeB2)))
dit('5b.', 'import de A sur B : ' + (await importer(B, sauvegardeA2)))

const empA1 = await empreinte(A)
const empB1 = await empreinte(B)
dit('6.', `convergence : ${JSON.stringify(empA1) === JSON.stringify(empB1)}`)
dit('6b.', `A ${empA1.patrimoine} · ${empA1.journal}`)
dit('6c.', `B ${empB1.patrimoine} · ${empB1.journal}`)

// --- Réimport du même fichier : rien ne doit bouger ---
dit('7.', 'réimport du même fichier sur A : ' + (await importer(A, sauvegardeB2)))
const empA2 = await empreinte(A)
dit('7b.', `idempotent : ${JSON.stringify(empA1) === JSON.stringify(empA2)}`)

// --- Modification concurrente de la MÊME transaction ---
async function premierMouvement(a) {
  await a.page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
  const lien = await a.page.locator('a[href*="#/comptes/"]').first().getAttribute('href')
  await a.page.goto(base + lien.slice(lien.indexOf('#/')), { waitUntil: 'networkidle' })
  const m = await a.page.locator('a[href*="#/mouvements/"]').first().getAttribute('href')
  return m.slice(m.indexOf('#/'))
}
const routeMvt = await premierMouvement(A)
// A corrige le montant ; B supprime le même mouvement. Aucun arbitrage n'existe :
// c'est l'ordre des instants qui tranche, et il doit trancher pareil des deux côtés.
await A.page.goto(base + routeMvt, { waitUntil: 'networkidle' })
await A.page.locator('input[inputmode="decimal"]').first().fill('99,99')
await A.page.click('button:has-text("Enregistrer")')
await A.page.waitForTimeout(800)
await B.page.goto(base + routeMvt, { waitUntil: 'networkidle' })
await B.page.click('button:has-text("Supprimer")')
await B.page.waitForTimeout(300)
const confirme = B.page.locator('button:has-text("Oui"), button:has-text("Confirmer")')
if (await confirme.count()) await confirme.first().click()
await B.page.waitForTimeout(800)
dit('8.', 'A a corrigé le mouvement, B l’a supprimé')

const sauvegardeA3 = await exporter(A)
const sauvegardeB3 = await exporter(B)
await importer(A, sauvegardeB3)
await importer(B, sauvegardeA3)
const empA3 = await empreinte(A)
const empB3 = await empreinte(B)
dit('9.', `même verdict des deux côtés : ${JSON.stringify(empA3) === JSON.stringify(empB3)}`)
dit('9b.', `A ${empA3.patrimoine} · ${empA3.journal}`)
dit('9c.', `B ${empB3.patrimoine} · ${empB3.journal}`)

// --- Un troisième appareil qui importe dans l'autre ordre ---
const C = await appareil('C')
await C.page.goto(base + '#/', { waitUntil: 'networkidle' })
await importer(C, sauvegardeB3)
await importer(C, sauvegardeA3)
const empC = await empreinte(C)
dit('10.', `ordre d’import indifférent (C) : ${JSON.stringify(empC) === JSON.stringify(empA3)}`)
dit('10b.', `C ${empC.patrimoine} · ${empC.journal}`)

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
