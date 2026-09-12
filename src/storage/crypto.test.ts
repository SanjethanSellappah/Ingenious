import { describe, expect, it } from 'vitest'
import {
  changerPin,
  chiffreurCoffre,
  chiffreurIdentite,
  creerCoffre,
  depuisBase64,
  ITERATIONS_PLANCHER,
  ouvrirCoffre,
  PinIncorrect,
  versBase64,
} from './crypto'

// Les tests fixent les itérations à un chiffre bas : on vérifie la mécanique de
// l'enveloppe, pas le coût de la dérivation. Le plancher réel est vérifié à part.
const TOURS = 1000

describe('base64', () => {
  it('fait l’aller-retour sur des octets quelconques', () => {
    const octets = new Uint8Array([0, 1, 127, 128, 255, 254, 65, 10])
    expect(depuisBase64(versBase64(octets))).toEqual(octets)
  })

  it('fait l’aller-retour sur 256 valeurs d’octet', () => {
    const octets = new Uint8Array(256).map((_, i) => i)
    expect(depuisBase64(versBase64(octets))).toEqual(octets)
  })
})

describe('coffre', () => {
  it('ne persiste jamais la clé de données en clair', async () => {
    const coffre = await creerCoffre('123456', TOURS)
    const serialise = JSON.stringify(coffre.meta)
    expect(serialise).toContain('cle_enveloppee')
    // Ce qui est écrit sur le disque, c'est le sel, les paramètres, et un
    // chiffré. Rien d'autre.
    expect(Object.keys(coffre.meta).sort()).toEqual(['cle_enveloppee', 'kdf', 'version'])
  })

  it('rend une clé non exportable — même la page ne peut pas la relire', async () => {
    const coffre = await creerCoffre('123456', TOURS)
    expect(coffre.cle.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('raw', coffre.cle)).rejects.toThrow()
    const rouvert = await ouvrirCoffre('123456', coffre.meta)
    expect(rouvert.cle.extractable).toBe(false)
  })

  it('le déballage est la vérification du PIN, sans second chiffré à côté', async () => {
    const coffre = await creerCoffre('123456', TOURS)
    // Pas de témoin : AES-GCM authentifie, donc un mauvais PIN fait échouer le
    // déballage au lieu de rendre une clé fausse.
    expect(coffre.meta).not.toHaveProperty('temoin')
  })

  it('tire un sel différent à chaque coffre', async () => {
    const a = await creerCoffre('123456', TOURS)
    const b = await creerCoffre('123456', TOURS)
    expect(a.meta.kdf.sel_b64).not.toBe(b.meta.kdf.sel_b64)
  })

  it('rouvre avec le bon PIN', async () => {
    const coffre = await creerCoffre('123456', TOURS)
    const chiffre = await chiffreurCoffre(coffre).chiffrer({ secret: 42 })
    const rouvert = await ouvrirCoffre('123456', coffre.meta)
    expect(await chiffreurCoffre(rouvert).dechiffrer(chiffre)).toEqual({ secret: 42 })
  })

  it('refuse un PIN faux sans laisser deviner autre chose', async () => {
    const coffre = await creerCoffre('123456', TOURS)
    await expect(ouvrirCoffre('123457', coffre.meta)).rejects.toBeInstanceOf(PinIncorrect)
  })

  it('refuse un PIN vide comme un PIN faux', async () => {
    const coffre = await creerCoffre('123456', TOURS)
    await expect(ouvrirCoffre('', coffre.meta)).rejects.toBeInstanceOf(PinIncorrect)
  })
})

describe('changement de PIN', () => {
  it('ne re-chiffre pas les données — c’est tout l’intérêt de l’enveloppe', async () => {
    const coffre = await creerCoffre('111111', TOURS)
    const chiffre = await chiffreurCoffre(coffre).chiffrer({ montant_cents: 1250 })

    const meta = await changerPin(coffre, '111111', '222222')
    const avecNouveau = await ouvrirCoffre('222222', meta)

    // Les données écrites sous l'ancien PIN restent lisibles telles quelles.
    expect(await chiffreurCoffre(avecNouveau).dechiffrer(chiffre)).toEqual({ montant_cents: 1250 })
  })

  it('invalide l’ancien PIN', async () => {
    const coffre = await creerCoffre('111111', TOURS)
    const meta = await changerPin(coffre, '111111', '222222')
    await expect(ouvrirCoffre('111111', meta)).rejects.toBeInstanceOf(PinIncorrect)
  })

  it('refuse de changer si l’ancien PIN est faux', async () => {
    const coffre = await creerCoffre('111111', TOURS)
    await expect(changerPin(coffre, '999999', '222222')).rejects.toBeInstanceOf(PinIncorrect)
  })

  it('renouvelle le sel', async () => {
    const coffre = await creerCoffre('111111', TOURS)
    const meta = await changerPin(coffre, '111111', '222222')
    expect(meta.kdf.sel_b64).not.toBe(coffre.meta.kdf.sel_b64)
  })
})

describe('chiffreur', () => {
  it('produit un scellé différent à chaque appel, même contenu', async () => {
    const coffre = await creerCoffre('123456', TOURS)
    const chiffreur = chiffreurCoffre(coffre)
    const a = (await chiffreur.chiffrer({ x: 1 })) as { iv_b64: string; donnees_b64: string }
    const b = (await chiffreur.chiffrer({ x: 1 })) as { iv_b64: string; donnees_b64: string }
    // IV aléatoire par enregistrement : deux écritures identiques ne doivent pas
    // se reconnaître dans la base.
    expect(a.iv_b64).not.toBe(b.iv_b64)
    expect(a.donnees_b64).not.toBe(b.donnees_b64)
  })

  it('refuse un scellé altéré', async () => {
    const coffre = await creerCoffre('123456', TOURS)
    const chiffreur = chiffreurCoffre(coffre)
    const scelle = (await chiffreur.chiffrer({ x: 1 })) as { iv_b64: string; donnees_b64: string }
    const octets = depuisBase64(scelle.donnees_b64)
    const altere = Uint8Array.from(octets, (octet, rang) => (rang === 0 ? octet ^ 0xff : octet))
    // AES-GCM authentifie : une modification d'un seul bit est détectée.
    await expect(
      chiffreur.dechiffrer({ ...scelle, donnees_b64: versBase64(altere) }),
    ).rejects.toThrow()
  })

  it('refuse un enregistrement en clair dans une base chiffrée', async () => {
    const coffre = await creerCoffre('123456', TOURS)
    await expect(chiffreurCoffre(coffre).dechiffrer({ type: 'account.created' })).rejects.toThrow(
      /non chiffré/,
    )
  })

  it('laisse tout passer tant qu’aucun PIN n’est configuré', async () => {
    const identite = chiffreurIdentite()
    expect(identite.actif).toBe(false)
    const valeur = { type: 'account.created' }
    expect(await identite.chiffrer(valeur)).toBe(valeur)
    expect(await identite.dechiffrer(valeur)).toBe(valeur)
  })
})

describe('paramètres de dérivation', () => {
  it('ne descend jamais sous le plancher', async () => {
    const coffre = await creerCoffre('123456')
    expect(coffre.meta.kdf.iterations).toBeGreaterThanOrEqual(ITERATIONS_PLANCHER)
    expect(coffre.meta.kdf.algo).toBe('PBKDF2-SHA256')
  })
})
