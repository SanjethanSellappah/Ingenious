import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

// Dépôt de projet sur GitHub Pages : l'application est servie sous /Ingenious/.
// `start_url` et `scope` du manifeste doivent rester alignés sur cette base,
// sinon l'application installée s'ouvre hors de son propre périmètre.
const base = '/Ingenious/'

export default defineConfig({
  base,
  plugins: [
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
