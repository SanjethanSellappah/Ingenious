import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'
const PORT = process.argv[2] ?? '4192'
const nav = await chromium.launch(optionsNavigateur())
const THEME = process.env.THEME_AUDIT ?? 'sombre'
const ctx = await nav.newContext({
  ...devices['Pixel 7'],
  colorScheme: THEME === 'clair' ? 'light' : 'dark',
})
const page = await ctx.newPage()
// Un thème imposé avant le premier rendu : c'est la palette qu'on veut auditer,
// pas celle que le navigateur d'essai se trouve préférer.
await page.addInitScript((theme) => {
  try {
    localStorage.setItem('ingenious.theme', theme)
  } catch {
    /* mémoire locale refusée : le thème du contexte suffit */
  }
}, THEME)
const base = `http://localhost:${PORT}/Ingenious/`
console.log(`thème audité : ${THEME}`)

// Remplir l'application pour avoir du contenu à auditer.
await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', 'Courant')
await page.fill('input[inputmode="decimal"]', '1200')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

// Du contenu sur les écrans de détail : sans mouvement ni abonnement, ils
// n'affichent rien et l'audit passerait à vide.
await page.goto(base + '#/abonnements/nouveau', { waitUntil: 'networkidle' })
await page.fill('#nom-abo', 'Loyer')
await page.fill('input[inputmode="decimal"]', '712,35')
await page.fill('#jour-mois', '5')
await page.click('button:has-text("Enregistrer")')
await page.waitForSelector('h1:has-text("Abonnements")')

await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '42,50')
await page.fill('#note', 'Boulangerie').catch(() => {})
await page.click('button:has-text("Enregistrer")')
await page.waitForTimeout(600)

// Les identifiants réels des écrans de détail.
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
const lienCompte = await page.locator('a[href*="#/comptes/"]').first().getAttribute('href')
const routeCompte = lienCompte ? lienCompte.slice(lienCompte.indexOf('#/')) : null
await page.goto(base + '#/abonnements', { waitUntil: 'networkidle' })
const lienAbo = await page.locator('a[href*="#/abonnements/"]').first().getAttribute('href')
const routeAbo = lienAbo ? lienAbo.slice(lienAbo.indexOf('#/')) : null
let routeMouvement = null
if (routeCompte) {
  await page.goto(base + routeCompte, { waitUntil: 'networkidle' })
  const lienMvt = await page
    .locator('a[href*="#/mouvements/"]')
    .first()
    .getAttribute('href')
    .catch(() => null)
  routeMouvement = lienMvt ? lienMvt.slice(lienMvt.indexOf('#/')) : null
}

/*
 * Contraste, en lisant vraiment la couleur.
 *
 * Une version antérieure attrapait les entiers d'une chaîne et prenait
 * `color(srgb 1 1 1 / 0.85)` — du blanc presque opaque — pour trois canaux à 1
 * sur 255, c'est-à-dire du noir. Elle annonçait 3,32 là où le contraste réel
 * valait 6,3. Un détecteur qui se trompe de couleur ne mesure rien.
 */
const canaux = (couleur) => {
  const srgb = /color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/i.exec(couleur)
  if (srgb) {
    return [
      Number(srgb[1]) * 255,
      Number(srgb[2]) * 255,
      Number(srgb[3]) * 255,
      srgb[4] === undefined ? 1 : Number(srgb[4]),
    ]
  }
  const nombres = (couleur.match(/[\d.]+/g) ?? []).map(Number)
  if (nombres.length < 3) return [0, 0, 0, 1]
  return [nombres[0], nombres[1], nombres[2], nombres.length > 3 ? nombres[3] : 1]
}

/** Compose une couleur translucide sur son fond, comme le fait l'écran. */
const composer = (dessus, dessous) => {
  const [r1, g1, b1, a] = canaux(dessus)
  if (a >= 1) return [r1, g1, b1]
  const [r2, g2, b2] = canaux(dessous)
  return [r1 * a + r2 * (1 - a), g1 * a + g2 * (1 - a), b1 * a + b2 * (1 - a)]
}

const luminance = ([r, g, b]) => {
  const lin = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

const contraste = (texte, fond, fondDerriere = 'rgb(255,255,255)') => {
  const surface = composer(fond, fondDerriere)
  const encre = composer(texte, `rgb(${surface.join(',')})`)
  const [l1, l2] = [luminance(encre), luminance(surface)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

const routes = [
  '#/',
  '#/calendrier',
  '#/ajout',
  '#/comptes',
  '#/comptes/nouveau',
  '#/reglages',
  '#/abonnements',
  '#/abonnements/nouveau',
  '#/depenses',
  '#/confirmer',
  '#/reconciliation',
  routeCompte,
  routeAbo,
  routeMouvement,
  '#/comptes/inexistant',
  '#/mouvements/inexistant',
].filter(Boolean)
const problemes = []

for (const route of routes) {
  await page.goto(base + route, { waitUntil: 'networkidle' })
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
        // Le fond du document sert de dernier recours : une constante sombre
        // écrite en dur mesurerait le thème clair contre le mauvais fond.
        const dernier = getComputedStyle(document.documentElement).backgroundColor
        const translucide = (c) => /\/\s*0?\.\d/.test(c) || /,\s*0?\.\d+\s*\)$/.test(c)
        let fond = dernier
        let derriere = dernier
        let premier = true
        for (let n = el; n; n = n.parentElement) {
          const c = getComputedStyle(n).backgroundColor
          if (!c || c === 'rgba(0, 0, 0, 0)') continue
          if (premier) {
            fond = c
            premier = false
            if (!translucide(c)) {
              derriere = c
              break
            }
            continue
          }
          if (!translucide(c)) {
            derriere = c
            break
          }
        }
        return {
          texte: (el.textContent || '').trim().slice(0, 24),
          couleur: s.color,
          fond,
          derriere,
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
    const ratio = contraste(t.couleur, t.fond, t.derriere)
    const gros = t.taille >= 24 || (t.taille >= 18.66 && Number(t.gras) >= 700)
    const seuil = gros ? 3 : 4.5
    if (ratio < seuil)
      problemes.push(
        `${route} : contraste ${ratio.toFixed(2)} < ${seuil} — « ${t.texte} » (${t.couleur} sur ${t.fond}, ${t.taille}px)`,
      )
  }
}

// Focus visible au clavier
await page.goto(base + '#/ajout', { waitUntil: 'networkidle' })
await page.keyboard.press('Tab')
const focus = await page.evaluate(() => {
  const el = document.activeElement
  if (!el || el === document.body) return null
  const s = getComputedStyle(el)
  return { balise: el.tagName, contour: s.outlineStyle !== 'none' && s.outlineWidth !== '0px' }
})
if (!focus?.contour) problemes.push('focus clavier sans contour visible : ' + JSON.stringify(focus))

const uniques = [...new Set(problemes)]
console.log(uniques.length === 0 ? 'AUCUN PROBLÈME' : uniques.join('\n'))
await nav.close()

/*
 * Le code de sortie est le verdict.
 *
 * Afficher les problèmes ne suffit pas : le lanceur ne lit pas le français, et
 * un audit qui décrit vingt fautes en sortant sur zéro passe pour un succès.
 * C'est arrivé — vingt et un audits « passés » sur une version périmée du site.
 */
process.exit(problemes.length > 0 ? 1 : 0)
