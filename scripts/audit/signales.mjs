import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'

/**
 * Les défauts remontés à l'usage réel.
 *
 * Aucun n'avait été trouvé par les tests ni par les autres audits : ils
 * vérifiaient que l'application calcule juste, pas qu'elle montre ce qu'on
 * vient de lui dire. Chacun a sa ligne ici pour ne pas revenir.
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
const enEuros = (t) => Number((t ?? '').replace(/[^\d,-]/g, '').replace(',', '.'))

// Le jour est figé au 12 : le loyer du 5 est donc déjà passé, ce qui est
// précisément la situation où l'abonnement disparaissait du mois en cours.
await page.addInitScript(() => {
  const Vrai = Date
  const fige = Vrai.UTC(2026, 8, 12, 10, 0, 0)
  window.Date = class extends Vrai {
    constructor(...a) {
      super(...(a.length ? a : [fige]))
    }
    static now() {
      return fige
    }
  }
})

await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', 'Courant')
await page.locator('input[inputmode="decimal"]').first().fill('1000')
await page.click('button:has-text("Continuer")')
await page.locator('input[inputmode="decimal"]').first().fill('2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.fill('#abo-nom-0', 'Loyer')
await page.locator('input[inputmode="decimal"]').nth(0).fill('700')
await page.fill('#abo-jour-0', '5')
await page.fill('#abo-nom-1', 'Téléphone')
await page.locator('input[inputmode="decimal"]').nth(1).fill('19,99')
await page.fill('#abo-jour-1', '15')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

// --- Les abonnements déclarés à l'installation comptent dès le mois en cours ---
await page.goto(base + '#/abonnements', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const ecranAbos = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
const cout = enEuros(/([\d  ]+,\d\d) € par mois/.exec(ecranAbos)?.[1])
dit('1.', 'coût récurrent : ' + cout + ' €')
exiger(Math.abs(cout - 719.99) < 0.01, `le coût cumulé vaut ${cout} €, attendu 719,99 €`)

dit('2.', 'faux « tarif modifié » : ' + /Tarif modifié/.test(ecranAbos))
exiger(!/Tarif modifié/.test(ecranAbos), 'un abonnement neuf s’annonce « tarif modifié »')

await page.goto(base + '#/calendrier', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const cal = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
const echeances = cal.slice(cal.indexOf('Échéances du mois'))
dit('3.', 'échéances du mois : ' + echeances.slice(0, 90))
exiger(
  /Loyer/.test(echeances),
  'le loyer déclaré à l’installation n’apparaît pas dans le mois en cours',
)
exiger(/Téléphone/.test(echeances), 'le téléphone n’apparaît pas dans le mois en cours')

// --- Un label se crée depuis le formulaire d'abonnement ---
await page.goto(base + '#/abonnements/nouveau', { waitUntil: 'networkidle' })
await page.fill('#nom-abo', 'Courses hebdo')
await page.locator('input[inputmode="decimal"]').first().fill('60')
await page.fill('#jour-mois', '10')
const champLabel = await page.locator('#label-abo-liste').count()
dit('4.', 'liste de labels sur le formulaire : ' + (champLabel > 0))
exiger(champLabel > 0, 'aucun moyen de choisir un label depuis le formulaire d’abonnement')
// « Nouveau label » doit être la première entrée de la liste.
const premiere = await page.locator('#label-abo-liste option').first().textContent()
dit('4b.', 'première entrée : ' + premiere?.trim())
exiger(/Nouveau label/.test(premiere ?? ''), '« Nouveau label » n’est pas en tête de liste')
await page.selectOption('#label-abo-liste', { label: 'Alimentation' })
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Abonnements")')

await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const reglages = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
dit('5.', 'label créé depuis l’abonnement : ' + /Alimentation/.test(reglages))
exiger(/Alimentation/.test(reglages), 'le label nommé sur l’abonnement n’a pas été créé')

// Le même nom sous une autre casse ne doit pas créer un second label.
await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.locator('input[inputmode="decimal"]').first().fill('12')
await page.selectOption('#nouveau-label-liste', '__nouveau__')
await page.fill('#nouveau-label', 'ALIMENTATION')
await page.click('button:has-text("Enregistrer")')
await page.waitForTimeout(900)
await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const apres = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
const occurrences = (apres.match(/Alimentation/gi) ?? []).length
dit('6.', 'occurrences du label après une saisie en majuscules : ' + occurrences)
exiger(occurrences === 1, `la casse a créé un second label : ${occurrences} occurrences`)

// --- Une dépense sans note porte le nom de son poste, pas « Échéance » ---
await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.locator('input[inputmode="decimal"]').first().fill('42')
await page.selectOption('#nouveau-label-liste', { label: 'Alimentation' })
await page.click('button:has-text("Enregistrer")')
await page.waitForTimeout(900)
await page.goto(base + '#/calendrier', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const calendrier = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
const duMois = calendrier.slice(calendrier.indexOf('Échéances du mois'))
dit('6b.', 'calendrier : ' + duMois.slice(0, 100))
exiger(
  !/·\s*Échéance\s/.test(duMois),
  'une dépense sans note s’affiche « Échéance » au lieu de son poste',
)
exiger(/Alimentation/.test(duMois), 'le poste de la dépense n’apparaît pas dans le calendrier')

// --- La courbe : le temps en abscisse, les montants en ordonnée ---
await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.waitForTimeout(700)
const axes = await page.evaluate(() => {
  const fig = document.querySelector('.courbe')
  if (!fig) return null
  const haut = fig.querySelector('.courbe-axe-haut')
  const bas = fig.querySelector('.courbe-axe-bas')
  const dates = [...fig.querySelectorAll('.courbe-dates span')].map((e) => e.textContent.trim())
  const legende = fig.querySelector('figcaption')?.getBoundingClientRect()
  return {
    montants: [haut?.textContent?.trim(), bas?.textContent?.trim()],
    hautAuDessus: haut.getBoundingClientRect().top < bas.getBoundingClientRect().top,
    chevaucheLegende: legende ? bas.getBoundingClientRect().bottom > legende.top + 2 : null,
    premiereDate: dates[0],
    derniereDate: dates[dates.length - 1],
  }
})
dit('7.', 'axes : ' + JSON.stringify(axes))
if (axes) {
  exiger(axes.hautAuDessus, 'le plus haut montant n’est pas au-dessus du plus bas')
  exiger(!axes.chevaucheLegende, 'le repère de montant se couche sur la légende')
  // Les dates se lisent de gauche à droite : aujourd'hui d'abord, l'horizon ensuite.
  const [jourA, moisA] = axes.premiereDate.split('/').map(Number)
  const [jourB, moisB] = axes.derniereDate.split('/').map(Number)
  exiger(
    moisA < moisB || (moisA === moisB && jourA < jourB),
    `l’axe du temps est inversé : ${axes.premiereDate} à gauche, ${axes.derniereDate} à droite`,
  )
}

console.log('\nproblèmes :', problemes.length ? problemes.join('\n  ') : 'aucun')
console.log('erreurs :', erreurs.length ? [...new Set(erreurs)].slice(0, 4).join(' | ') : 'aucune')
await nav.close()

/*
 * Le code de sortie est le verdict.
 */
process.exit(problemes.length > 0 || erreurs.length > 0 ? 1 : 0)
