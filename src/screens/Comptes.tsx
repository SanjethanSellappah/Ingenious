import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { CivilDate } from '../core/civilDate'
import { aujourdhui } from '../core/clock'
import { cents } from '../core/money'
import { useEtat } from '../app/useEtat'
import type { Compte, Etat } from '../domain/etat'
import { ancreDuCompte, mouvementsDuCompte, patrimoine, soldeDuCompte } from '../domain/selecteurs'
import { Montant } from '../ui/Montant'

const LIBELLES_TYPE: Record<string, string> = {
  courant: 'Compte courant',
  livret: 'Livret',
  pea: 'PEA',
  cto: 'Compte-titres',
  av: 'Assurance-vie',
  or: 'Or',
  autre: 'Autre',
}

/**
 * Comptes et patrimoine.
 *
 * Les comptes sont groupés bancaire / investissement parce que les deux ne
 * répondent pas à la même question : le premier groupe dit ce qu'on peut
 * dépenser, le second ce qu'on possède.
 */
export function Comptes() {
  const { etat } = useEtat()
  const jour = aujourdhui()

  const { total, parGroupe } = useMemo(() => patrimoine(etat, jour), [etat, jour])
  const comptes = useMemo(
    () => [...etat.comptes.values()].filter((compte) => compte.archived_at === undefined),
    [etat.comptes],
  )

  const bancaires = comptes.filter((compte) => compte.groupe === 'bancaire')
  const investissements = comptes.filter((compte) => compte.groupe === 'investissement')

  return (
    <main className="page">
      <header>
        <h1>Patrimoine</h1>
      </header>

      <div className="carte">
        <Montant valeur={total} principal neutre />
        <p className="discret">
          Bancaire <Montant valeur={parGroupe.get('bancaire') ?? cents(0)} neutre /> ·
          Investissement <Montant valeur={parGroupe.get('investissement') ?? cents(0)} neutre />
        </p>
      </div>

      <div className="actions">
        <Link to="/reconciliation" className="lien-bouton">
          Réconcilier un solde
        </Link>
      </div>

      <GroupeComptes titre="Bancaire" comptes={bancaires} etat={etat} jour={jour} />
      <GroupeComptes titre="Investissement" comptes={investissements} etat={etat} jour={jour} />

      {comptes.length === 0 && (
        <div className="carte">
          <p className="discret">Aucun compte.</p>
        </div>
      )}

      <div className="actions">
        <Link to="/abonnements" className="lien-bouton">
          Abonnements
        </Link>
        <Link to="/depenses" className="lien-bouton">
          Dépenses
        </Link>
      </div>
    </main>
  )
}

function GroupeComptes({
  titre,
  comptes,
  etat,
  jour,
}: {
  titre: string
  comptes: readonly Compte[]
  etat: Etat
  jour: CivilDate
}) {
  if (comptes.length === 0) return null
  return (
    <>
      <h2 className="titre-groupe">{titre}</h2>
      {comptes.map((compte) => (
        <Link className="carte carte-lien" to={`/comptes/${compte.id}`} key={compte.id}>
          <div className="ligne-label">
            <span>
              <strong>{compte.nom}</strong>
              <span className="discret"> · {LIBELLES_TYPE[compte.type] ?? compte.type}</span>
            </span>
            <Montant valeur={soldeDuCompte(etat, compte.id, jour)} neutre />
          </div>
        </Link>
      ))}
    </>
  )
}

/**
 * Détail d'un compte.
 *
 * Pour un compte `saisi`, c'est l'historique des relevés et des mouvements. Le
 * relevé le plus récent est signalé comme **ancre** : c'est lui qui sert de point
 * de départ au calcul, et le voir explique pourquoi le solde vaut ce qu'il vaut.
 */
export function DetailCompte() {
  const { etat } = useEtat()
  const { id } = useParams()
  const jour = aujourdhui()

  const compte = id !== undefined ? etat.comptes.get(id) : undefined
  const mouvements = useMemo(
    () => (compte ? mouvementsDuCompte(etat, compte.id).slice(-40).reverse() : []),
    [etat, compte],
  )
  const ancre = compte ? ancreDuCompte(etat, compte.id, jour) : null

  if (!compte) {
    return (
      <main className="page">
        <header>
          <h1>Compte introuvable</h1>
        </header>
        <Link to="/comptes" className="lien-action">
          Retour aux comptes
        </Link>
      </main>
    )
  }

  const releves = etat.releves
    .filter((releve) => releve.account_id === compte.id)
    .slice(-12)
    .reverse()

  return (
    <main className="page">
      <header>
        <h1>{compte.nom}</h1>
        <p>{LIBELLES_TYPE[compte.type] ?? compte.type}</p>
      </header>

      <div className="carte">
        <h2>Solde</h2>
        <Montant valeur={soldeDuCompte(etat, compte.id, jour)} principal neutre />
        {ancre !== null ? (
          <p className="discret">
            Dernier relevé le {ancre.date} à <Montant valeur={ancre.solde_cents} neutre />, plus les
            mouvements postérieurs.
          </p>
        ) : (
          <p className="discret">Aucun relevé : le solde n’est que la somme des mouvements.</p>
        )}
      </div>

      <div className="actions">
        <Link to="/reconciliation" className="lien-bouton">
          Relever le solde réel
        </Link>
      </div>

      <div className="carte">
        <h2>Relevés</h2>
        {releves.length === 0 ? (
          <p className="discret">Aucun relevé enregistré.</p>
        ) : (
          <ul className="liste">
            {releves.map((releve, rang) => (
              <li key={`${releve.date}-${releve.ts}`}>
                <span>
                  {releve.date}
                  {rang === 0 && <span className="discret"> · ancre du calcul</span>}
                </span>
                <Montant valeur={releve.solde_cents} neutre />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="carte">
        <h2>Mouvements</h2>
        {mouvements.length === 0 ? (
          <p className="discret">Aucun mouvement.</p>
        ) : (
          <ul className="liste">
            {mouvements.map((mouvement) => (
              <li key={`${mouvement.source_id}-${mouvement.nature}`}>
                <span>
                  {mouvement.date} · {mouvement.libelle ?? libelleParDefaut(mouvement.nature)}
                  {mouvement.nature === 'virement' && <span className="discret"> · virement</span>}
                </span>
                <Montant valeur={mouvement.montant_cents} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}

function libelleParDefaut(nature: string): string {
  return nature === 'virement' ? 'Virement' : 'Mouvement'
}
