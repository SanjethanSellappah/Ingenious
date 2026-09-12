import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'

/**
 * Saisies extrêmes.
 *
 * Un nom de compte de cent vingt caractères, un montant à sept chiffres, un
 * libellé sans espace : rien de tout cela n'est malveillant, ce sont des
 * saisies que quelqu'un fera un jour. Ce qu'on vérifie est que l'écran tient —
 * pas de débordement horizontal, pas de bouton repoussé hors de l'écran — et
 * que les montants restent justes.
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

const LONG = 'Compte joint Crédit Mutuel Arkéa pour les dépenses courantes du foyer'
const SANS_ESPACE = 'Abonnementmensuelàuneplateformedediffusionvidéoenlignetrèslong'

const mesurer = async (ou) => {
  await page.goto(base + ou, { waitUntil: 'networkidle' })
  await page.waitForTimeout(350)
  return page.evaluate(() => ({
    scrollH: document.documentElement.scrollWidth > window.innerWidth + 1,
    largeur: window.innerWidth,
    depassent: [...document.querySelectorAll('*')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.right > window.innerWidth + 1
      })
      .map((el) => `${el.tagName}.${el.className}`)
      .slice(0, 4),
    boutonsHorsEcran: [...document.querySelectorAll('button, a.lien-bouton')]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .map((el) => el.textContent?.trim().slice(0, 30)),
  }))
}

await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', LONG)
await page.fill('input[inputmode="decimal"]', '9999999,99')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '8888888,88')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.fill('#abo-nom-0', SANS_ESPACE)
await page.locator('input[inputmode="decimal"]').first().fill('1234567,89')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')
dit('1.', 'créé avec un nom de 68 caractères et un solde à sept chiffres')

for (const ou of ['#/', '#/comptes', '#/abonnements', '#/calendrier', '#/depenses', '#/ajout']) {
  const m = await mesurer(ou)
  dit(ou, `débordement ${m.scrollH} · dépassent ${JSON.stringify(m.depassent)}`)
  exiger(!m.scrollH, `débordement horizontal sur ${ou}`)
  exiger(
    m.boutonsHorsEcran.length === 0,
    `boutons hors écran sur ${ou} : ${JSON.stringify(m.boutonsHorsEcran)}`,
  )
}

// Le montant doit rester juste, pas arrondi ni tronqué à l'affichage.
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const patrimoine = (await page.locator('.montant-principal').first().textContent())?.trim()
dit('2.', 'patrimoine : ' + patrimoine)
exiger(/9\s*999\s*999,99/.test(patrimoine ?? ''), `montant altéré à l’affichage : ${patrimoine}`)

// Un montant au-delà de l'entier sûr doit être refusé, pas accepté en silence.
await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '999999999999999999')
await page.waitForTimeout(300)
const valeurLue = await page.locator('input[inputmode="decimal"]').first().inputValue()
const boutonActif = await page.locator('button:has-text("Enregistrer")').isEnabled()
dit('3.', `saisie démesurée : champ « ${valeurLue.slice(0, 24)} » · bouton actif ${boutonActif}`)
if (boutonActif) {
  await page.click('button:has-text("Enregistrer")')
  await page.waitForTimeout(1000)
  const corps = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  const panne = await page.locator('.panne').count()
  dit('3b.', `après enregistrement : panne ${panne} · ${corps.slice(0, 90)}`)
  // Soit c'est refusé proprement, soit c'est accepté et juste — jamais NaN.
  exiger(!/NaN|Infinity|undefined/.test(corps), 'un montant démesuré produit un affichage cassé')
}

// Un nom vide ou fait d'espaces ne doit pas créer de compte fantôme.
await page.goto(base + '#/comptes/nouveau', { waitUntil: 'networkidle' })
await page.fill('#nom-compte-form', '     ')
await page.locator('input[inputmode="decimal"]').first().fill('10')
await page.waitForTimeout(300)
const actif = await page.locator('button:has-text("Enregistrer")').isEnabled()
dit('4.', 'nom fait d’espaces, bouton actif : ' + actif)
exiger(!actif, 'un compte peut être créé avec un nom vide')

// Un montant négatif saisi dans un champ de solde.
await page.fill('#nom-compte-form', 'Découvert')
await page.locator('input[inputmode="decimal"]').first().fill('-250,50')
await page.waitForTimeout(300)
await page.click('button:has-text("Enregistrer")')
await page.waitForTimeout(900)
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
await page.waitForTimeout(400)
const corpsComptes = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
dit('5.', 'solde négatif accepté : ' + (/-\s*250,50/.test(corpsComptes) ? 'oui' : 'non'))
exiger(!/NaN|undefined/.test(corpsComptes), 'affichage cassé après un solde négatif')

const m = await mesurer('#/comptes')
dit('6.', `comptes avec nom long et solde négatif : débordement ${m.scrollH}`)
exiger(!m.scrollH, 'débordement sur la liste des comptes')

console.log('\nproblèmes :', problemes.length ? problemes.join('\n  ') : 'aucun')
console.log('erreurs :', erreurs.length ? [...new Set(erreurs)].slice(0, 4).join(' | ') : 'aucune')
await nav.close()

/*
 * Le code de sortie est le verdict.
 */
process.exit(problemes.length > 0 || erreurs.length > 0 ? 1 : 0)
