import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'

/**
 * Le calendrier, conduit au doigt.
 *
 * Cet audit existe parce qu'un défaut a été trouvé à l'usage et non ici : les
 * cases du calendrier et les lignes d'échéance n'avaient **jamais** été
 * cliquables. Rien ne plantait, rien ne s'affichait de travers, les tests
 * passaient — simplement, appuyer ne faisait rien, et on en concluait que
 * l'application était cassée.
 *
 * C'est le genre de manque qu'aucune assertion sur une fonction pure ne peut
 * relever : il ne se voit qu'en appuyant. D'où cet audit, qui appuie.
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
const route = () => page.url().split('#')[1] ?? ''

// --- Mise en place : un abonnement et une dépense saisie -------------------------

await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', 'Courant')
await page.fill('input[inputmode="decimal"]', '1200')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.fill('#abo-nom-0', 'Loyer')
// Le montant de l'abonnement est le premier champ décimal de sa carte.
await page.fill('input[inputmode="decimal"] >> nth=0', '780')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '42,50')
await page.click('button:has-text("Enregistrer")')
await page.waitForTimeout(900)

// --- Les cases sont-elles des boutons ? -------------------------------------------

await page.goto(base + '#/calendrier', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)

const cases = page.locator('.case-jour')
const nombreCases = await cases.count()
dit('1.', 'cases du mois : ' + nombreCases)
exiger(nombreCases >= 28, `un mois compte au moins 28 jours, trouvé ${nombreCases}`)

const balises = await cases.evaluateAll((noeuds) => [...new Set(noeuds.map((n) => n.tagName))])
dit('2.', 'nature des cases : ' + balises.join(', '))
exiger(
  balises.length === 1 && balises[0] === 'BUTTON',
  `les cases doivent être des boutons, trouvé : ${balises.join(', ')}`,
)

// Chacune doit se nommer : un bouton sans nom n'existe pas pour un lecteur d'écran.
const sansNom = await cases.evaluateAll(
  (noeuds) => noeuds.filter((n) => !(n.getAttribute('aria-label') || '').trim()).length,
)
dit('3.', 'cases sans nom accessible : ' + sansNom)
exiger(sansNom === 0, `${sansNom} case(s) n’ont aucun nom accessible`)

// --- Choisir un jour filtre la liste ----------------------------------------------

const avecEcheance = page.locator('.case-jour:has(.pastille)')
const combienPorteuses = await avecEcheance.count()
dit('4.', 'jours porteurs d’une échéance : ' + combienPorteuses)
exiger(combienPorteuses > 0, 'aucun jour ne porte d’échéance : la mise en place a échoué')

const titreAvant = (await page.locator('.carte:has(.liste) h2').first().textContent())?.trim()
await avecEcheance.first().click()
await page.waitForTimeout(400)
const titreApres = (await page.locator('.carte:has(.liste) h2').first().textContent())?.trim()
dit('5.', `titre : « ${titreAvant} » → « ${titreApres} »`)
exiger(titreApres !== titreAvant, 'choisir un jour ne change rien à la liste')
exiger(
  /Échéances du \d/.test(titreApres ?? ''),
  `le titre ne nomme pas le jour : « ${titreApres} »`,
)

const choisies = await page.locator('.case-jour.choisi').count()
dit('6.', 'cases marquées comme choisies : ' + choisies)
exiger(choisies === 1, `une seule case doit être marquée, trouvé ${choisies}`)

// --- La ligne mène à ce qu'elle désigne --------------------------------------------

// Toutes les lignes, et non la première : un mouvement saisi et une occurrence
// d'abonnement empruntent deux chemins différents, et vérifier l'un laisserait
// l'autre se casser sans bruit.
await page.click('button:has-text("Voir tout le mois")').catch(() => {})
await page.waitForTimeout(300)
const toutesLignes = page.locator('.carte:has(.liste) .liste li')
const combienLignes = await toutesLignes.count()
const combienLiens = await page.locator('.carte:has(.liste) .liste li a').count()
dit('7.', `lignes d’échéance : ${combienLiens} sur ${combienLignes} mènent quelque part`)
exiger(combienLignes > 1, `au moins deux échéances attendues, trouvé ${combienLignes}`)
exiger(
  combienLiens === combienLignes,
  `${combienLignes - combienLiens} ligne(s) d’échéance ne mènent nulle part`,
)

// Et les deux chemins possibles doivent être représentés.
const cibles = await page
  .locator('.carte:has(.liste) .liste li a')
  .evaluateAll((noeuds) => noeuds.map((n) => n.getAttribute('href') ?? ''))
dit('7b.', 'destinations : ' + [...new Set(cibles.map((c) => c.split('/')[2]))].join(', '))
exiger(
  cibles.some((c) => c.includes('/mouvements/')),
  'aucune ligne ne mène à un mouvement saisi',
)
exiger(
  cibles.some((c) => c.includes('/abonnements/')),
  'aucune ligne ne mène à l’abonnement qui la produit',
)

const lien = page.locator('.carte:has(.liste) .liste li a').first()

await lien.click()
await page.waitForTimeout(700)
dit('8.', 'après le clic, route = ' + route())
exiger(
  /^\/(mouvements|abonnements)\//.test(route()),
  `la ligne devait ouvrir un mouvement ou un abonnement, arrivé sur ${route()}`,
)
const ouvert = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
exiger(
  /Corriger|Abonnement|Modifier/.test(ouvert),
  'l’écran ouvert ne ressemble ni à un mouvement ni à un abonnement',
)

// --- Un jour sans échéance répond quand même ----------------------------------------

await page.goto(base + '#/calendrier', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const sansEcheance = page.locator('.case-jour:not(:has(.pastille))').first()
await sansEcheance.click()
await page.waitForTimeout(400)
const vide = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
dit('9.', 'jour sans échéance : ' + (/Aucune échéance[^.]*\./.exec(vide)?.[0] ?? '(rien dit)'))
exiger(/Aucune échéance ce jour-là/.test(vide), 'un jour vide ne dit pas qu’il est vide')

// --- Revenir au mois entier, et changer de mois --------------------------------------

await page.click('button:has-text("Voir tout le mois")')
await page.waitForTimeout(400)
const retour = (await page.locator('.carte:has(.liste) h2').first().textContent())?.trim()
dit('10.', 'retour au mois : « ' + retour + ' »')
exiger(retour === 'Échéances du mois', `« Voir tout le mois » n’a pas rétabli la liste : ${retour}`)

await avecEcheance.first().click()
await page.waitForTimeout(300)
// La flèche de droite, et elle seule : chaque case du jour porte aussi un
// `aria-label`, et un sélecteur plus large cliquerait sur un jour.
await page.click('.navigation-mois button >> nth=1')
await page.waitForTimeout(500)
// C'est le **titre** qui trahit le défaut, pas la case : le jour choisi
// n'existant pas dans le mois suivant, aucune case n'y apparaît marquée de
// toute façon. Ce qui resterait, c'est une liste filtrée sur un jour d'un autre
// mois — donc vide, sous un titre qui nomme un jour qu'on ne voit nulle part.
const titreMoisSuivant = (await page.locator('.carte:has(.liste) h2').first().textContent())?.trim()
const casesChoisies = await page.locator('.case-jour.choisi').count()
dit(
  '11.',
  `après changement de mois : « ${titreMoisSuivant} », ${casesChoisies} case(s) choisie(s)`,
)
exiger(
  titreMoisSuivant === 'Échéances du mois',
  `le jour choisi survit au changement de mois : « ${titreMoisSuivant} » sur une liste vide`,
)
exiger(casesChoisies === 0, `${casesChoisies} case reste marquée dans un autre mois`)

console.log('\nproblèmes :', problemes.length ? problemes.join('\n  ') : 'aucun')
console.log('erreurs :', erreurs.length ? [...new Set(erreurs)].slice(0, 4).join(' | ') : 'aucune')
await nav.close()

process.exit(problemes.length > 0 || erreurs.length > 0 ? 1 : 0)
