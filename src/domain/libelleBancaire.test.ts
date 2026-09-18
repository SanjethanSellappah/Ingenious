import { describe, expect, it } from 'vitest'
import { casseLisible, libelleRaccourci, resumerLibelleBancaire } from './libelleBancaire'
import { plier } from './etat'
import { validerEvenement, type Evenement, type TypeEvenement } from './events'
import { mouvementsDuCompte } from './selecteurs'

/**
 * Les libellés ci-dessous reprennent la **forme** de vrais relevés — les champs
 * accolés, leur ordre, leurs séparateurs — avec des noms et des références
 * inventés. Le dépôt est public : un relevé réel n'y a pas sa place, même
 * partiellement.
 */
describe('résumé d’un libellé de banque', () => {
  it('ramène un prélèvement à sa nature et à son créancier', () => {
    expect(
      resumerLibelleBancaire(
        'PRELEVEMENT PAYPAL EUROPE S.A.R.L. ET CIE S.C.A DU 04/09/26 - EMETTEUR : ' +
          'LU96ZZZ00000000000000058 MDT - MOTIF : 1052796022080 - REF : 1052796022080 LIB',
      ),
    ).toBe('Prélèvement Paypal Europe')
  })

  it('ramène un virement à la personne qui l’a envoyé', () => {
    expect(
      resumerLibelleBancaire(
        'VIREMENT INSTANTANE RECU DE M OU MME A DURANDEL MOTIF: VIR DE M OU MME ' +
          'A DURANDEL - REF : CH3W26250M212457',
      ),
    ).toBe('Virement A Durandel')
  })

  it('prend le motif quand la tête ne dit rien', () => {
    // Ici le motif porte la seule information du libellé.
    expect(resumerLibelleBancaire('MOTIF : NAVIGO ANNUEL - REF : 3')).toBe('Navigo Annuel')
  })

  it('retire la forme juridique et la date déjà affichée à côté', () => {
    expect(resumerLibelleBancaire('PRELEVEMENT ORANGE SA DU 10/09/26 - REF : 4409123')).toBe(
      'Prélèvement Orange',
    )
  })

  it('retire le montant que certains relevés répètent à la fin', () => {
    expect(resumerLibelleBancaire('PRELEVEMENT ORANGE SA -13,99 €')).toBe('Prélèvement Orange')
    expect(resumerLibelleBancaire('VIREMENT SALAIRE 1 623,00')).toBe('Virement Salaire')
  })

  it('reconnaît les natures écrites en abrégé', () => {
    expect(resumerLibelleBancaire('PRLV FREE MOBILE')).toBe('Prélèvement Free Mobile')
    expect(resumerLibelleBancaire('CB LECLERC ROUEN')).toBe('Carte Leclerc Rouen')
    expect(resumerLibelleBancaire('VIR SEPA LOYER')).toBe('Virement Loyer')
  })

  it('garde les sigles, qui ne se lisent qu’en majuscules', () => {
    expect(resumerLibelleBancaire('PRELEVEMENT EDF')).toBe('Prélèvement EDF')
    expect(resumerLibelleBancaire('VIREMENT CAF DU 05/09/26')).toBe('Virement CAF')
    expect(resumerLibelleBancaire('PRELEVEMENT URSSAF')).toBe('Prélèvement Urssaf')
    // Les mots grammaticaux courts redescendent en minuscules : « DES » n'est
    // pas un sigle, et le garder en capitales se lit plus mal que l'original.
    expect(resumerLibelleBancaire('VIREMENT CAISSE DES DEPOTS')).toBe('Virement Caisse des Depots')
  })

  it('retire le numéro de carte, qui désigne la carte et non le commerçant', () => {
    expect(resumerLibelleBancaire('CB LECLERC ROUEN CARTE 4979')).toBe('Carte Leclerc Rouen')
    expect(resumerLibelleBancaire('PAIEMENT CARTE MONOPRIX CB 1234')).toBe('Carte Monoprix')
    // Quatre chiffres au milieu d'un nom ne sont pas un numéro de carte.
    expect(resumerLibelleBancaire('CB STATION 2000 ROUEN')).toBe('Carte Station 2000 Rouen')
  })

  it('n’abîme pas un libellé déjà court', () => {
    expect(resumerLibelleBancaire('CB BOULANGERIE')).toBe('Carte Boulangerie')
    expect(resumerLibelleBancaire('LOYER')).toBe('Loyer')
  })

  it('laisse intact un texte qui n’est pas crié en majuscules', () => {
    // Une note écrite à la main ne doit pas être recapitalisée.
    expect(casseLisible('Remboursement resto avec Léa')).toBe('Remboursement resto avec Léa')
  })

  it('rend l’original plutôt qu’un résumé qui ne dirait rien', () => {
    // Un libellé entièrement fait de références : il n'y a rien à en tirer, et
    // une ligne vide serait pire que la ligne illisible.
    const brut = 'REF : 0001220934 - MDT - ICS : FR76ZZZ123456'
    expect(resumerLibelleBancaire(brut)).toBe(brut)
  })

  it('raccourcit ce qui reste démesuré, sans jamais vider la ligne', () => {
    const brut = `ACHAT ${'COMMERCE '.repeat(20)}`
    const resume = resumerLibelleBancaire(brut)
    expect(resume.length).toBeLessThanOrEqual(64)
    expect(resume.endsWith('…')).toBe(true)
  })

  it('ne rend jamais une chaîne vide pour un libellé non vide', () => {
    for (const brut of [
      'MOTIF :',
      'REF : 1',
      '- - -',
      'DU 04/09/26',
      'LU96ZZZ00000000000000058',
      'PRELEVEMENT',
    ]) {
      expect(resumerLibelleBancaire(brut)).not.toBe('')
    }
  })

  it('dit quand le résumé n’apporte rien', () => {
    expect(libelleRaccourci('PRELEVEMENT ORANGE SA DU 10/09/26 - REF : 1')).toBe(true)
    expect(libelleRaccourci('Courses du samedi')).toBe(false)
  })

  it('est stable : résumer un résumé ne le change plus', () => {
    // Sans quoi l'affichage dépendrait du nombre de fois où la fonction a été
    // appelée, ce qui est le genre de défaut qu'on ne remarque que très tard.
    for (const brut of [
      'PRELEVEMENT PAYPAL EUROPE S.A.R.L. DU 04/09/26 - REF : 105279',
      'MOTIF : NAVIGO ANNUEL - REF : 3',
      'CB LECLERC ROUEN',
    ]) {
      const une = resumerLibelleBancaire(brut)
      expect(resumerLibelleBancaire(une)).toBe(une)
    }
  })
})

// --- Ce que l'application en fait ---------------------------------------------

let sequence = 0
function ev(type: TypeEvenement, payload: Record<string, unknown>): Evenement {
  sequence += 1
  return validerEvenement({
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    ts: 1_757_000_000_000 + sequence,
    device: 'test',
    type,
    payload,
  })
}

const COMPTE = { id: 'c1', nom: 'Courant', type: 'courant', groupe: 'bancaire', mode: 'saisi' }
const PAVE = 'PRELEVEMENT ORANGE SA DU 10/09/26 - EMETTEUR : FR11ZZZ445566 - REF : 4409123'

describe('le résumé dans les mouvements', () => {
  it('abrège une ligne importée et garde son texte d’origine à côté', () => {
    const etat = plier([
      ev('account.created', COMPTE),
      ev('transaction.created', {
        id: 't1',
        account_id: 'c1',
        date: '2026-09-10',
        montant_cents: -1399,
        origine: 'csv',
        note: PAVE,
      }),
    ])
    const mouvement = mouvementsDuCompte(etat, 'c1')[0]!
    expect(mouvement.libelle).toBe('Prélèvement Orange')
    expect(mouvement.libelle_complet).toBe(PAVE)
  })

  it('ne touche pas à une note écrite à la main', () => {
    // Même si elle ressemble à un libellé de banque : ce que quelqu'un a tapé
    // chez lui n'est pas à corriger, fût-ce sa casse.
    const etat = plier([
      ev('account.created', COMPTE),
      ev('transaction.created', {
        id: 't2',
        account_id: 'c1',
        date: '2026-09-10',
        montant_cents: -1399,
        origine: 'manuel',
        note: PAVE,
      }),
    ])
    const mouvement = mouvementsDuCompte(etat, 'c1')[0]!
    expect(mouvement.libelle).toBe(PAVE)
    expect(mouvement.libelle_complet).toBeUndefined()
  })

  it('ne double pas le texte quand le résumé n’apporte rien', () => {
    const etat = plier([
      ev('account.created', COMPTE),
      ev('transaction.created', {
        id: 't3',
        account_id: 'c1',
        date: '2026-09-10',
        montant_cents: -1399,
        origine: 'csv',
        note: 'Courses',
      }),
    ])
    const mouvement = mouvementsDuCompte(etat, 'c1')[0]!
    expect(mouvement.libelle).toBe('Courses')
    expect(mouvement.libelle_complet).toBeUndefined()
  })
})
