/**
 * Génère les icônes PNG de l'application.
 *
 * Les icônes sont produites par ce script plutôt que déposées en binaire : un
 * PNG commité est une impasse le jour où la couleur change. Aucune dépendance —
 * `zlib` suffit à écrire un PNG.
 *
 *   node scripts/generer-icones.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..')
const sortie = join(racine, 'public')

const FOND = [0x0f, 0x17, 0x2a]
const BARRES = [
  [0x2a, 0x5f, 0x48],
  [0x37, 0xa0, 0x6a],
  [0x4a, 0xde, 0x80],
]

/** Échantillonnage 4×4 par pixel : les bords obliques et les arrondis sortent lissés. */
const SUPER = 4

/** Rectangle à coins arrondis, en coordonnées unitaires (0 → 1). */
function dansRectArrondi(x, y, gauche, haut, largeur, hauteur, rayon) {
  const droite = gauche + largeur
  const bas = haut + hauteur
  if (x < gauche || x > droite || y < haut || y > bas) return false
  const cx = Math.min(Math.max(x, gauche + rayon), droite - rayon)
  const cy = Math.min(Math.max(y, haut + rayon), bas - rayon)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= rayon * rayon
}

/**
 * Trois barres ascendantes, inscrites dans les 80 % centraux : c'est la zone sûre
 * d'une icône `maskable`, que les lanceurs Android rognent en cercle.
 */
function couleurMotif(x, y) {
  const baseline = 0.7
  const largeur = 0.1
  const ecart = 0.07
  const hauteurs = [0.18, 0.28, 0.38]
  for (let i = 0; i < 3; i++) {
    const gauche = 0.28 + i * (largeur + ecart)
    const hauteur = hauteurs[i]
    if (dansRectArrondi(x, y, gauche, baseline - hauteur, largeur, hauteur, 0.022)) {
      return BARRES[i]
    }
  }
  return null
}

/** @returns {Buffer} pixels RGBA de `taille` × `taille`. */
function dessiner(taille, { rayonFond }) {
  const pixels = Buffer.alloc(taille * taille * 4)
  const pas = 1 / (taille * SUPER)
  for (let py = 0; py < taille; py++) {
    for (let px = 0; px < taille; px++) {
      let r = 0
      let v = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SUPER; sy++) {
        for (let sx = 0; sx < SUPER; sx++) {
          const x = (px * SUPER + sx + 0.5) * pas
          const y = (py * SUPER + sy + 0.5) * pas
          const dansFond = rayonFond === 0 || dansRectArrondi(x, y, 0, 0, 1, 1, rayonFond)
          if (!dansFond) continue
          const motif = couleurMotif(x, y) ?? FOND
          r += motif[0]
          v += motif[1]
          b += motif[2]
          a += 255
        }
      }
      const total = SUPER * SUPER
      const i = (py * taille + px) * 4
      // Prémultiplication inverse : les échantillons hors du fond ne teintent pas le bord.
      const opaques = a / 255
      pixels[i] = opaques ? Math.round(r / opaques) : 0
      pixels[i + 1] = opaques ? Math.round(v / opaques) : 0
      pixels[i + 2] = opaques ? Math.round(b / opaques) : 0
      pixels[i + 3] = Math.round(a / total)
    }
  }
  return pixels
}

const TABLE_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const octet of buffer) c = TABLE_CRC[(c ^ octet) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function morceau(type, donnees) {
  const longueur = Buffer.alloc(4)
  longueur.writeUInt32BE(donnees.length)
  const corps = Buffer.concat([Buffer.from(type, 'latin1'), donnees])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(corps))
  return Buffer.concat([longueur, corps, crc])
}

function encoderPng(taille, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(taille, 0)
  ihdr.writeUInt32BE(taille, 4)
  ihdr[8] = 8 // profondeur
  ihdr[9] = 6 // RGBA
  const brut = Buffer.alloc(taille * (taille * 4 + 1))
  for (let y = 0; y < taille; y++) {
    brut[y * (taille * 4 + 1)] = 0 // filtre « aucun »
    pixels.copy(brut, y * (taille * 4 + 1) + 1, y * taille * 4, (y + 1) * taille * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau('IHDR', ihdr),
    morceau('IDAT', deflateSync(brut, { level: 9 })),
    morceau('IEND', Buffer.alloc(0)),
  ])
}

const cibles = [
  { fichier: 'icone-192.png', taille: 192, rayonFond: 0.22 },
  { fichier: 'icone-512.png', taille: 512, rayonFond: 0.22 },
  // `maskable` : plein cadre, le lanceur découpe lui-même.
  { fichier: 'icone-maskable-512.png', taille: 512, rayonFond: 0 },
  // iOS applique son propre masque : lui donner un carré plein.
  { fichier: 'apple-touch-icon.png', taille: 180, rayonFond: 0 },
]

mkdirSync(sortie, { recursive: true })
for (const { fichier, taille, rayonFond } of cibles) {
  const png = encoderPng(taille, dessiner(taille, { rayonFond }))
  writeFileSync(join(sortie, fichier), png)
  console.log(`${fichier} — ${taille}×${taille}, ${png.length} octets`)
}
