import { readFileSync } from 'node:fs'
import { chromium, devices } from 'playwright-core'
import { optionsNavigateur } from './navigateur.mjs'

/**
 * L'import d'un relevé bancaire, conduit depuis l'écran.
 *
 * Trois choses se vérifient ici et nulle part ailleurs, parce qu'elles ne se
 * voient qu'en conduisant la vraie application :
 *
 * - **Réimporter le même fichier n'ajoute rien.** C'est la promesse centrale.
 *   Les tests unitaires la vérifient sur le plan d'import ; ici on la vérifie
 *   sur le solde affiché, qui est ce que l'utilisateur regarde.
 * - **L'écart de réconciliation ne survit pas au détail qui le remplace.** Le
 *   double comptage est invisible : les totaux gonflent sans que rien n'alerte.
 * - **Un accent codé sur un octet reste un accent.** Un libellé abîmé change
 *   l'empreinte, donc la reconnaissance des doublons, en silence.
 * - **Les quatre formats arrivent au même endroit.** CSV, Excel moderne, Excel
 *   97 et PDF sont lus par quatre codes très différents ; c'est ici qu'on
 *   vérifie qu'ils produisent les mêmes lignes dans la vraie application, et
 *   qu'importer le même relevé sous deux formats n'ajoute rien la seconde fois.
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

const jour = (recul) =>
  new Date(Date.now() - recul * 86400000).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

const RELEVE = [
  'Date operation;Libelle;Montant',
  `${jour(1)};CB BOULANGERIE;-2,50`,
  `${jour(1)};CB BOULANGERIE;-2,50`,
  `${jour(0)};PRLV LOYER;-780,00`,
  `${jour(0)};VIR SALAIRE;2 000,00`,
].join('\r\n')

const solde = async () => {
  await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
  await page.waitForTimeout(350)
  return (await page.locator('.montant-principal').first().textContent())?.trim()
}
const enEuros = (t) => Number((t ?? '').replace(/[^\d,-]/g, '').replace(',', '.'))

async function deposer(texte, encodage = 'utf8', nom = 'releve.csv') {
  await page.setInputFiles('input[type=file]', {
    name: nom,
    mimeType: 'text/csv',
    buffer: Buffer.from(texte, encodage),
  })
  await page.waitForTimeout(700)
}

// --- Mise en place ------------------------------------------------------------

await page.goto(base + '#/', { waitUntil: 'networkidle' })
await page.fill('#nom-compte', 'Courant')
await page.fill('input[inputmode="decimal"]', '1000')
await page.click('button:has-text("Continuer")')
await page.fill('input[inputmode="decimal"]', '2000')
await page.click('button:has-text("Continuer")')
await page.waitForSelector('#abo-nom-0')
await page.click('button:has-text("Terminer")')
await page.waitForSelector('nav.onglets')

// Une réconciliation, pour avoir un écart « Non catégorisé » à recouvrir.
await page.goto(base + '#/reconciliation', { waitUntil: 'networkidle' })
await page.fill('input[inputmode="decimal"]', '950')
await page.waitForTimeout(300)
await page.click('button:has-text("Recaler le solde")')
await page.waitForTimeout(900)
dit('1.', 'solde après réconciliation : ' + (await solde()))

// --- Premier import ------------------------------------------------------------

await page.goto(base + '#/import-releve', { waitUntil: 'networkidle' })
await deposer(RELEVE)

const apercu = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
dit(
  '2.',
  'fichier lu : ' + (/releve\.csv[^A-Z]*/.exec(apercu)?.[0] ?? '(non annoncé)').slice(0, 80),
)
exiger(/point-virgule/.test(apercu), 'le séparateur n’a pas été reconnu')
exiger(/UTF-8/.test(apercu), 'l’encodage n’a pas été annoncé')

const aEcrire = (await page.locator('.montant-principal').first().textContent())?.trim()
dit('3.', 'opérations annoncées : ' + aEcrire)
exiger(aEcrire === '4', `4 opérations attendues à l’aperçu, annoncé ${aEcrire}`)

// Les colonnes doivent avoir été devinées sans intervention.
const roleDate = await page.locator('#colonne-0').inputValue()
const roleMontant = await page.locator('#colonne-2').inputValue()
dit(
  '4.',
  `colonnes devinées : ${roleDate} / ${await page.locator('#colonne-1').inputValue()} / ${roleMontant}`,
)
exiger(roleDate === 'date' && roleMontant === 'montant', 'les colonnes ont été mal devinées')

// L'écart de réconciliation doit être proposé à la suppression, déjà coché.
exiger(/Écarts de réconciliation/.test(apercu), 'l’écart de réconciliation n’est pas signalé')
const caseEcart = page.locator('label:has-text("Supprimer cet écart") input')
exiger(await caseEcart.isChecked(), 'la suppression de l’écart n’est pas proposée par défaut')
dit('5.', 'écart de réconciliation signalé et coché')

// Les deux lignes de la veille sont antérieures à l'ancre posée aujourd'hui.
exiger(
  /Sans effet sur le solde/.test(apercu),
  'les lignes antérieures à l’ancre ne sont pas signalées',
)
dit('6.', 'lignes sans effet sur le solde : signalées')

await page.click('button:has-text("Importer")')
await page.waitForTimeout(1200)
const message = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
dit(
  '7.',
  'résultat : ' + (/\d+ opération\(s\) importée\(s\)/.exec(message)?.[0] ?? message.slice(0, 80)),
)

const apresImport = await solde()
dit('8.', 'solde après import : ' + apresImport)
// 950 relevé, moins le loyer du jour, plus le salaire du jour. Les deux
// dépenses de la veille sont antérieures à l'ancre : elles n'y entrent pas.
exiger(
  enEuros(apresImport) === 2170,
  `solde attendu 2 170,00 après import, obtenu ${enEuros(apresImport)}`,
)

// L'écart « Non catégorisé » doit avoir disparu des dépenses du mois.
await page.goto(base + '#/depenses', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const depenses = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
dit(
  '9.',
  'dépenses du mois : ' +
    depenses.slice(depenses.indexOf('Dépenses'), depenses.indexOf('Dépenses') + 120),
)
// C'est le total qui tranche, pas le mot : « Non catégorisé » désigne aussi
// les lignes importées, qui n'ont pas encore de poste. L'écart de 50 € est en
// revanche soit dedans, soit dehors — 785 s'il a été retiré, 835 s'il est resté.
const totalMois = enEuros(/Total du mois ([\d  ]+,\d\d)/.exec(depenses)?.[1])
exiger(
  totalMois === 785,
  `l’écart de réconciliation a été compté en plus du détail importé : ${totalMois} au lieu de 785`,
)

// --- Réimport du même fichier ------------------------------------------------------

await page.goto(base + '#/import-releve', { waitUntil: 'networkidle' })
await deposer(RELEVE)
const second = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
const aEcrire2 = (await page.locator('.montant-principal').first().textContent())?.trim()
dit('10.', 'au réimport, opérations annoncées : ' + aEcrire2)
exiger(aEcrire2 === '0', `le réimport annonce ${aEcrire2} opérations au lieu de 0`)
exiger(/déjà importée/.test(second), 'le réimport ne dit pas que les lignes sont déjà connues')

const apresReimport = await solde()
dit('11.', 'solde après réimport : ' + apresReimport)
exiger(
  enEuros(apresReimport) === 2170,
  `le réimport a dupliqué des lignes : ${enEuros(apresReimport)}`,
)

// --- Un fichier plus large, encodé en Windows-1252, sur un compte créé ici -------------

const PLUS_LARGE = [
  'Date;Libelle;Debit;Credit',
  `${jour(1)};CB BOULANGERIE;2,50;`,
  `${jour(1)};CB BOULANGERIE;2,50;`,
  `${jour(0)};RETRAIT DÉCEMBRE;40,00;`,
  `${jour(0)};VIR REMBOURSEMENT;;15,80`,
].join('\r\n')

await page.goto(base + '#/import-releve', { waitUntil: 'networkidle' })
await page.selectOption('#compte-import', '__nouveau__')
await page.fill('#nom-nouveau-compte', 'Second compte')
await deposer(PLUS_LARGE, 'latin1', 'releve-1252.csv')
const troisieme = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
dit('12.', 'encodage annoncé : ' + (/Windows-1252|UTF-8/.exec(troisieme)?.[0] ?? '(aucun)'))
exiger(/Windows-1252/.test(troisieme), 'le fichier Windows-1252 a été lu comme de l’UTF-8')
exiger(/RETRAIT DÉCEMBRE/.test(troisieme), 'l’accent a été abîmé à la lecture')

const aEcrire3 = (await page.locator('.montant-principal').first().textContent())?.trim()
dit('13.', 'sur un compte neuf, opérations annoncées : ' + aEcrire3)
// Compte neuf : rien n'est déjà connu, et les colonnes débit/crédit donnent le signe.
exiger(aEcrire3 === '4', `4 opérations attendues sur le compte neuf, annoncé ${aEcrire3}`)

await page.click('button:has-text("Importer")')
await page.waitForTimeout(1200)
await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
await page.waitForTimeout(500)
const comptes = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
dit('14.', 'comptes : ' + comptes.slice(0, 120))
exiger(/Second compte/.test(comptes), 'le compte créé pendant l’import n’existe pas')
// 0 de départ, moins 2,50 deux fois, moins 40, plus 15,80.
exiger(/29,20/.test(comptes), 'le solde du compte créé ne reflète pas les lignes importées')

// --- Les trois autres formats, dans la vraie application ---------------------------

const fixture = (nom) =>
  readFileSync(new URL(`../../src/core/__fixtures__/${nom}`, import.meta.url))

async function deposerFichier(nom, type) {
  await page.setInputFiles('input[type=file]', {
    name: nom,
    mimeType: type,
    buffer: fixture(nom),
  })
  await page.waitForTimeout(900)
}

/** Ouvre l'écran d'import sur un compte neuf, et rend son nom. */
async function comptePourImport(nom) {
  await page.goto(base + '#/import-releve', { waitUntil: 'networkidle' })
  await page.selectOption('#compte-import', '__nouveau__')
  await page.fill('#nom-nouveau-compte', nom)
  return nom
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

await comptePourImport('Compte Excel')
await deposerFichier('releve.xlsx', XLSX)
const excel = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
dit(
  '15.',
  'classeur lu : ' + (/releve\.xlsx[^A-Z]*/.exec(excel)?.[0]?.trim().slice(0, 70) ?? '(rien)'),
)
exiger(/Excel \(\.xlsx\)/.test(excel), 'le format .xlsx n’a pas été annoncé')
exiger(
  /Feuille/.test(excel),
  'le choix de la feuille n’est pas proposé pour un classeur à deux feuilles',
)
const feuille = await page.locator('#feuille-import').inputValue()
exiger(feuille === '0', `la feuille des opérations devait être proposée, choisie : ${feuille}`)
const aEcrireExcel = (await page.locator('.montant-principal').first().textContent())?.trim()
dit('16.', 'opérations annoncées depuis le .xlsx : ' + aEcrireExcel)
exiger(aEcrireExcel === '8', `8 opérations attendues depuis le classeur, annoncé ${aEcrireExcel}`)
await page.click('button:has-text("Importer")')
await page.waitForTimeout(1300)

// Le même relevé, en PDF : rien ne doit s'ajouter une seconde fois.
await page.goto(base + '#/import-releve', { waitUntil: 'networkidle' })
await page.selectOption('#compte-import', { label: 'Compte Excel' })
await deposerFichier('releve-banque.pdf', 'application/pdf')
const pdf = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
dit('17.', 'PDF lu : ' + (/PDF ·[^·]*·[^·]*/.exec(pdf)?.[0]?.trim() ?? '(rien)'))
exiger(/PDF/.test(pdf), 'le format PDF n’a pas été annoncé')
const aEcrirePdf = (await page.locator('.montant-principal').first().textContent())?.trim()
dit('18.', 'opérations annoncées depuis le PDF du même relevé : ' + aEcrirePdf)
exiger(
  aEcrirePdf === '0',
  `le même relevé en PDF devait être reconnu, ${aEcrirePdf} opération(s) annoncée(s)`,
)
exiger(/déjà importée/.test(pdf), 'le PDF du même relevé n’est pas reconnu comme déjà importé')

// Le format binaire de 1997, sur un compte neuf : les huit opérations reviennent.
await comptePourImport('Compte Excel 97')
await deposerFichier('releve.xls', 'application/vnd.ms-excel')
const ancien = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
dit('19.', 'classeur 97 : ' + (/Excel 97[^·]*·[^·]*/.exec(ancien)?.[0]?.trim() ?? '(rien)'))
exiger(/Excel 97/.test(ancien), 'le format .xls n’a pas été annoncé')
const aEcrireAncien = (await page.locator('.montant-principal').first().textContent())?.trim()
dit('20.', 'opérations annoncées depuis le .xls : ' + aEcrireAncien)
exiger(aEcrireAncien === '8', `8 opérations attendues depuis le .xls, annoncé ${aEcrireAncien}`)
await page.click('button:has-text("Importer")')
await page.waitForTimeout(1300)

await page.goto(base + '#/comptes', { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
const tousComptes = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
dit('21.', 'comptes : ' + tousComptes.slice(0, 140))
// Les huit opérations du relevé font +41,04 € : deux comptes partis de zéro,
// nourris l'un par le classeur moderne et l'autre par le format de 1997,
// doivent tomber exactement sur le même chiffre.
const soldes = [...tousComptes.matchAll(/41,04/g)]
dit('22.', 'comptes au solde attendu (41,04 €) : ' + soldes.length)
exiger(
  soldes.length >= 2,
  `les deux comptes devaient valoir 41,04 € ; trouvé ${soldes.length} fois`,
)

// Un fichier qui n'est aucun des quatre doit être refusé en le disant.
await page.goto(base + '#/import-releve', { waitUntil: 'networkidle' })
await page.setInputFiles('input[type=file]', {
  name: 'photo.png',
  mimeType: 'image/png',
  buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3, 4, 5, 6, 7]),
})
await page.waitForTimeout(700)
const refus = (await page.locator('[role=alert]').first().textContent())?.trim() ?? ''
dit('23.', 'fichier d’un autre genre : ' + refus.slice(0, 90))
exiger(/Formats acceptés/.test(refus), 'un fichier illisible n’explique pas ce qui est accepté')

console.log('\nproblèmes :', problemes.length ? problemes.join('\n  ') : 'aucun')
console.log('erreurs :', erreurs.length ? [...new Set(erreurs)].slice(0, 4).join(' | ') : 'aucune')
await nav.close()

process.exit(problemes.length > 0 || erreurs.length > 0 ? 1 : 0)
