import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

// Dépôt de projet sur GitHub Pages : l'application est servie sous /Ingenious/.
// `start_url` et `scope` du manifeste doivent rester alignés sur cette base,
// sinon l'application installée s'ouvre hors de son propre périmètre.
const base = '/Ingenious/'

/**
 * Politique de sécurité du contenu.
 *
 * L'application ne charge rien d'extérieur : ni police, ni script, ni image
 * distante. Le seul appel réseau qu'elle fasse est la cotation des instruments,
 * et `connect-src` n'autorise que cet hôte-là. La politique reste donc aussi
 * stricte qu'elle peut l'être — c'est la seule barrière disponible contre un
 * script injecté, GitHub Pages ne permettant pas d'en-têtes HTTP.
 *
 * `frame-ancestors` en est absent volontairement : cette directive est ignorée
 * dans une balise `meta`, l'y mettre donnerait l'illusion d'une protection.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  // Le seul hôte extérieur de toute l'application : le service de cotation, et
  // uniquement lui. Une liste plus large signifierait une politique plus large,
  // pour un bénéfice que personne n'a demandé.
  "connect-src 'self' https://api.twelvedata.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/**
 * Injecte la politique, en production **et** en développement.
 *
 * En développement, trois directives sont desserrées parce que Vite lui-même ne
 * peut pas les respecter : il sert ses scripts et sa feuille de style en ligne,
 * et ouvre une liaison de rafraîchissement à chaud. Le reste — images, appels
 * réseau, `object-src`, `base-uri`, `form-action` — reste identique, de sorte
 * qu'une dépendance externe introduite par mégarde se voie à l'écriture du code
 * plutôt qu'en production seulement.
 *
 * Le style en ligne reste donc non vérifié en développement. Les styles React
 * (`style={{}}`) passent par le CSSOM et ne sont pas concernés par la CSP ; le
 * seul risque réel serait un attribut `style` écrit à la main dans `index.html`,
 * qui se verrait au premier chargement du build.
 */
function politiqueSecurite() {
  return {
    name: 'ingenious-csp',
    transformIndexHtml(html: string, contexte: { server?: unknown }) {
      const developpement = contexte.server !== undefined
      const politique = developpement
        ? CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'")
            .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
            .replace("connect-src 'self'", "connect-src 'self' ws: wss:")
        : CSP
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${politique}" />`,
      )
    },
  }
}

export default defineConfig({
  base,
  plugins: [
    politiqueSecurite(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: base,
        name: 'Ingenious',
        short_name: 'Ingenious',
        description: 'Suivi de finances personnelles, hors ligne et sans serveur',
        lang: 'fr',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: 'icone-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icone-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icone-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Routage par hash : une seule entrée de navigation, index.html.
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    // Le noyau est pur : pas de DOM par défaut. Un test de composant ouvre son
    // fichier par `// @vitest-environment jsdom`.
    environment: 'node',
    // Fuseau décalé par rapport à UTC : c'est la seule façon que les tests de
    // date attrapent un calcul fait en UTC au lieu du fuseau de l'appareil.
    env: { TZ: 'Europe/Paris' },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    restoreMocks: true,
  },
})
