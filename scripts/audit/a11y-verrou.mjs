import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4192'
const nav = await chromium.launch(optionsNavigateur())
const ctx = await nav.newContext({ ...devices['Pixel 7'] })
const page = await ctx.newPage()
const base = `http://localhost:${PORT}/Ingenious/`
const erreurs = []
page.on('pageerror', (e) => erreurs.push('PAGEERROR ' + String(e)))
page.on('console', (m) => m.type() === 'error' && erreurs.push('CONSOLE ' + m.text()))

const contraste = (a, b) => {
  const lum = (c) => {
    const [r, g, bb] = c
      .match(/\d+/g)
      .slice(0, 3)
      .map(Number)
      .map((v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bb
  }
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

const problemes = []
let route = ''

async function auditer(nom) {
  route = nom
  await page.waitForTimeout(250)
  const rapport = await page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    // Un seul h1, hiérarchie sans saut
    const titres = [...document.querySelectorAll('h1,h2,h3')].map((h) => Number(h.tagName[1]))
    let saut = null
    for (let i = 1; i < titres.length; i++) {
      if (titres[i] - titres[i - 1] > 1) saut = `${titres[i - 1]} → ${titres[i]}`
    }
    // Champs sans étiquette
    const sansLabel = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')]
      .filter(visible)
      .filter((el) => {
        if (el.getAttribute('aria-label')) return false
        if (el.id && document.querySelector(`label[for="${el.id}"]`)) return false
        return !el.closest('label')
      })
      .map((el) => el.id || el.type)
    // Boutons sans nom accessible
    const sansNom = [...document.querySelectorAll('button, a')]
      .filter(visible)
      .filter((el) => (el.textContent || '').trim() === '' && !el.getAttribute('aria-label'))
      .map((el) => el.className)
    // Couleurs du texte
    const textes = [...document.querySelectorAll('p, span, li, h1, h2, strong, label, button, a')]
      .filter(visible)
      .filter((el) => (el.textContent || '').trim() !== '')
      .map((el) => {
        const s = getComputedStyle(el)
        let fond = 'rgb(15, 23, 42)'
        for (let n = el; n; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor
          if (c && c !== 'rgba(0, 0, 0, 0)') {
            fond = c
            break
          }
        }
        return {
          texte: (el.textContent || '').trim().slice(0, 24),
          couleur: s.color,
          fond,
          taille: parseFloat(s.fontSize),
          gras: s.fontWeight,
        }
      })
    return {
      h1: document.querySelectorAll('h1').length,
      saut,
      sansLabel,
      sansNom,
      textes,
      landmarks: {
        main: document.querySelectorAll('main').length,
        nav: document.querySelectorAll('nav').length,
      },
    }
  })

  if (rapport.h1 !== 1) problemes.push(`${route} : ${rapport.h1} h1`)
  if (rapport.saut) problemes.push(`${route} : saut de titre ${rapport.saut}`)
  if (rapport.sansLabel.length)
    problemes.push(`${route} : champs sans étiquette ${JSON.stringify(rapport.sansLabel)}`)
  if (rapport.sansNom.length)
    problemes.push(`${route} : éléments sans nom ${JSON.stringify(rapport.sansNom)}`)
  if (rapport.landmarks.main !== 1) problemes.push(`${route} : ${rapport.landmarks.main} <main>`)
  console.log(
    `${route.padEnd(18)} ${String(rapport.textes.length).padStart(3)} textes, ${rapport.sansLabel.length} champs sans étiquette`,
  )

  for (const t of rapport.textes) {
    const ratio = contraste(t.couleur, t.fond)
    const gros = t.taille >= 24 || (t.taille >= 18.66 && Number(t.gras) >= 700)
    const seuil = gros ? 3 : 4.5
    if (ratio < seuil)
      problemes.push(
        `${route} : contraste ${ratio.toFixed(2)} < ${seuil} — « ${t.texte} » (${t.couleur} sur ${t.fond}, ${t.taille}px)`,
      )
  }
}

// Application remplie, puis un code, pour atteindre les écrans de verrou.
await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', 'Courant')
await page.fill('input[inputmode="decimal"]', '1200')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.click('button:has-text("Configurer un code")')
await page.waitForSelector('h1')
await auditer('configuration du code')

await page.fill('#pin-nouveau', '123456')
await page.fill('#pin-confirmation', '123456')
await page.check('input[type=checkbox]')
await page.click('button:has-text("Activer le code")')
await page.waitForTimeout(2500)

// Écran de saisie du code, au rechargement.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('h1')
await auditer('saisie du code')

// Le même écran après un refus : le message d'erreur doit rester lisible.
await page.fill('#pin', '999999')
await page.click('form button[type=submit]')
await page.waitForTimeout(1200)
await auditer('code refusé')

// Écran de secours.
await page.click('button:has-text("Code oublié"), a:has-text("Code oublié")').catch(() => {})
await page.waitForTimeout(600)
await auditer('code oublié')

// Changement de code, une fois déverrouillé.
await page.click('button:has-text("Revenir au code")')
await page.waitForSelector('#pin')
await page.waitForTimeout(6000) // la temporisation après un refus
if (await page.locator('#pin').count()) {
  await page.fill('#pin', '123456')
  await page.click('form button[type=submit]')
  await page.waitForTimeout(2500)
}
await page.goto(base + '#/reglages', { waitUntil: 'networkidle' })
await page.click('button:has-text("Changer le code")')
await page.waitForSelector('h1:has-text("Changer le code")')
await auditer('changer le code')

console.log(problemes.length ? 'PROBLEMES :\n' + problemes.join('\n') : 'AUCUN PROBLÈME')
console.log('erreurs :', erreurs.length ? erreurs.join(' | ') : 'aucune')
await nav.close()

/*
 * Le code de sortie est le verdict.
 *
 * Afficher les problèmes ne suffit pas : le lanceur ne lit pas le français, et
 * un audit qui décrit vingt fautes en sortant sur zéro passe pour un succès.
 * C'est arrivé — vingt et un audits « passés » sur une version périmée du site.
 */
process.exit(problemes.length > 0 || erreurs.length > 0 ? 1 : 0)
