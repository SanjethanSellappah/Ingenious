import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { aujourdhui } from '../core/clock'
import { ecrire } from '../app/magasin'
import { useEtat } from '../app/useEtat'
import type { GroupeCompte, TypeCompte } from '../domain/etat'
import { identifiant } from '../domain/identifiant'
import { SaisieMontant } from '../ui/SaisieMontant'
import type { Cents } from '../core/money'

/**
 * Création et modification d'un compte.
 *
 * Le **groupe** n'est pas une décoration : il sépare ce qu'on peut dépenser de
 * ce qu'on possède. Il est donc proposé par défaut selon le type — un livret est
 * bancaire, un PEA ne l'est pas — mais reste modifiable, parce que personne ne
 * range son argent exactement comme une nomenclature le prévoit.
 *
 * Un compte clôturé **s'archive, ne se supprime pas** : ses mouvements passés
 * font partie de l'histoire, et les effacer réécrirait le patrimoine d'hier.
 */
const TYPES: { valeur: TypeCompte; libelle: string; groupe: GroupeCompte }[] = [
  { valeur: 'courant', libelle: 'Compte courant', groupe: 'bancaire' },
  { valeur: 'livret', libelle: 'Livret (A, LDDS, LEP…)', groupe: 'bancaire' },
  { valeur: 'pea', libelle: 'PEA', groupe: 'investissement' },
  { valeur: 'cto', libelle: 'Compte-titres', groupe: 'investissement' },
  { valeur: 'av', libelle: 'Assurance-vie', groupe: 'investissement' },
  { valeur: 'or', libelle: 'Or', groupe: 'investissement' },
  { valeur: 'autre', libelle: 'Autre', groupe: 'bancaire' },
]

export function FormulaireCompte() {
  const { etat } = useEtat()
  const { id } = useParams()
  const naviguer = useNavigate()
  const jour = aujourdhui()

  const existant = id !== undefined && id !== 'nouveau' ? etat.comptes.get(id) : undefined

  const [nom, setNom] = useState(existant?.nom ?? '')
  const [type, setType] = useState<TypeCompte>(existant?.type ?? 'livret')
  const [groupe, setGroupe] = useState<GroupeCompte>(existant?.groupe ?? 'bancaire')
  const [solde, setSolde] = useState<Cents | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [confirmeArchivage, setConfirmeArchivage] = useState(false)

  const valide = nom.trim() !== '' && (existant !== undefined || solde !== null)

  function choisirType(valeur: TypeCompte) {
    setType(valeur)
    // Le groupe suit le type tant que l'utilisateur ne l'a pas contredit
    // explicitement ; il reste modifiable juste en dessous.
    const propose = TYPES.find((t) => t.valeur === valeur)?.groupe
    if (propose) setGroupe(propose)
  }

  async function enregistrer() {
    if (!valide) return
    setOccupe(true)
    try {
      const compteId = existant?.id ?? identifiant('compte')
      const entrees: Parameters<typeof ecrire>[0][number][] = [
        {
          type: existant ? 'account.updated' : 'account.created',
          payload: { id: compteId, nom: nom.trim(), type, groupe, mode: 'saisi' },
        },
      ]
      if (solde !== null) {
        entrees.push({
          type: 'account.balance_set',
          payload: { account_id: compteId, date: jour, solde_cents: solde },
        })
      }
      await ecrire(entrees)
      void naviguer('/comptes')
    } finally {
      setOccupe(false)
    }
  }

  async function archiver() {
    if (!existant) return
    setOccupe(true)
    try {
      await ecrire([{ type: 'account.archived', payload: { id: existant.id, date: jour } }])
      void naviguer('/comptes')
    } finally {
      setOccupe(false)
    }
  }

  const estCompteCourant = existant !== undefined && etat.reglages.compte_courant_id === existant.id

  return (
    <main className="page">
      <header>
        <h1>{existant ? 'Modifier le compte' : 'Nouveau compte'}</h1>
        {!existant && (
          <p>Un livret, un PEA, de l’or : tout ce dont vous relevez le solde à la main.</p>
        )}
      </header>

      <div className="champ">
        <label htmlFor="nom-compte-form">Nom</label>
        <input
          id="nom-compte-form"
          value={nom}
          autoComplete="off"
          placeholder="Livret A"
          onChange={(e) => setNom(e.target.value)}
        />
      </div>

      <div className="champ">
        <label htmlFor="type-compte">Type</label>
        <select
          id="type-compte"
          value={type}
          onChange={(e) => choisirType(e.target.value as TypeCompte)}
        >
          {TYPES.map((t) => (
            <option key={t.valeur} value={t.valeur}>
              {t.libelle}
            </option>
          ))}
        </select>
      </div>

      <div className="champ">
        <label htmlFor="groupe-compte">Groupe</label>
        <select
          id="groupe-compte"
          value={groupe}
          onChange={(e) => setGroupe(e.target.value as GroupeCompte)}
        >
          <option value="bancaire">Bancaire — ce que je peux dépenser</option>
          <option value="investissement">Investissement — ce que je possède</option>
        </select>
      </div>

      <SaisieMontant
        libelle={existant ? 'Relever le solde (facultatif)' : 'Solde actuel'}
        onChange={setSolde}
      />

      <div className="actions">
        <button type="button" className="secondaire" onClick={() => void naviguer('/comptes')}>
          Annuler
        </button>
        <button type="button" onClick={() => void enregistrer()} disabled={!valide || occupe}>
          Enregistrer
        </button>
      </div>

      {existant && (
        <div className="carte">
          <h2>Clôturer</h2>
          {estCompteCourant ? (
            <p className="discret">
              C’est le compte du reste à vivre. Désignez-en un autre dans Réglages avant de
              l’archiver.
            </p>
          ) : confirmeArchivage ? (
            <>
              <p className="discret">
                Le compte disparaîtra du patrimoine. Ses mouvements passés restent dans le journal :
                archiver n’efface rien, et le patrimoine d’hier reste ce qu’il était.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="secondaire"
                  onClick={() => setConfirmeArchivage(false)}
                >
                  Non, garder
                </button>
                <button type="button" onClick={() => void archiver()} disabled={occupe}>
                  Oui, archiver
                </button>
              </div>
            </>
          ) : (
            <div className="actions">
              <button
                type="button"
                className="secondaire"
                onClick={() => setConfirmeArchivage(true)}
              >
                Archiver ce compte
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  )
}
