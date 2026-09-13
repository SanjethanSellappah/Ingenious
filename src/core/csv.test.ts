import { describe, expect, it } from 'vitest'
import { analyserCsv, decoderTexte, decouper, detecterSeparateur } from './csv'

describe('découpage', () => {
  it('sépare les champs et les lignes', () => {
    expect(decouper('a;b;c\nd;e;f', ';')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ])
  })

  it('accepte les fins de ligne Windows', () => {
    expect(decouper('a;b\r\nc;d\r\n', ';')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('garde le séparateur qui se trouve dans un champ entre guillemets', () => {
    // Sans cela, toute la ligne se décale d'une colonne et le montant se
    // retrouve lu comme une date.
    expect(decouper('"12/09/2025";"CB LECLERC, ROUEN";"-45,20"', ';')).toEqual([
      ['12/09/2025', 'CB LECLERC, ROUEN', '-45,20'],
    ])
  })

  it('lit un guillemet doublé comme un guillemet', () => {
    expect(decouper('"CB ""LE PETIT MARCHE""";1', ';')).toEqual([['CB "LE PETIT MARCHE"', '1']])
  })

  it('accepte un retour à la ligne dans un champ entre guillemets', () => {
    expect(decouper('"deux\nlignes";1', ';')).toEqual([['deux\nlignes', '1']])
  })

  it('ignore les lignes vides de fin de fichier', () => {
    expect(decouper('a;b\n\n\n', ';')).toEqual([['a', 'b']])
  })
})

describe('détection du séparateur', () => {
  it('préfère le point-virgule quand les libellés contiennent des virgules', () => {
    const texte = [
      'Date;Libelle;Montant',
      '12/09/2025;CB LECLERC, ROUEN;-45,20',
      '13/09/2025;VIR SALAIRE, SEPTEMBRE;2000,00',
    ].join('\n')
    expect(detecterSeparateur(texte)).toBe(';')
  })

  it('reconnaît la virgule quand c’est elle qui sépare', () => {
    const texte = ['Date,Description,Amount', '2025-09-12,COFFEE,-2.50'].join('\n')
    expect(detecterSeparateur(texte)).toBe(',')
  })

  it('reconnaît la tabulation', () => {
    const texte = ['Date\tLibelle\tMontant', '12/09/2025\tLOYER\t-780,00'].join('\n')
    expect(detecterSeparateur(texte)).toBe('\t')
  })

  it('analyse sans qu’on ait à nommer le séparateur', () => {
    const { separateur, lignes } = analyserCsv('Date;Montant\n12/09/2025;-1,00')
    expect(separateur).toBe(';')
    expect(lignes).toHaveLength(2)
  })
})

describe('décodage', () => {
  const octets = (valeurs: number[]) => new Uint8Array(valeurs).buffer

  it('lit de l’UTF-8', () => {
    const texte = 'RETRAIT DÉCEMBRE'
    const { texte: lu, encodage } = decoderTexte(new TextEncoder().encode(texte).buffer)
    expect(lu).toBe(texte)
    expect(encodage).toBe('UTF-8')
  })

  it('retombe sur Windows-1252 pour un accent codé sur un octet', () => {
    // 0xE9 est « é » en Windows-1252, et une séquence UTF-8 invalide. Décodé
    // sans le voir, il deviendrait « <?> » — et l'empreinte qui reconnaît un
    // doublon changerait avec le libellé, en silence.
    const { texte, encodage } = decoderTexte(
      octets([0x52, 0x45, 0x54, 0x52, 0x41, 0x49, 0x54, 0x20, 0x44, 0xe9, 0x43]),
    )
    expect(texte).toBe('RETRAIT DéC')
    expect(encodage).toBe('Windows-1252')
  })

  it('ne prend pas pour de l’UTF-8 un fichier qui n’en est pas', () => {
    const { encodage } = decoderTexte(octets([0x41, 0xe9, 0x42]))
    expect(encodage).not.toBe('UTF-8')
  })
})
