import { aujourdhui } from '../core/clock'
import { useEtat } from '../app/useEtat'
import { patrimoine, soldeDuCompte } from '../domain/selecteurs'
import { Montant } from '../ui/Montant'

/**
 * Écrans en attente du lot 5.
 *
 * Ils affichent ce que l'état sait déjà dire, et **rien de plus**. Un écran qui
 * affiche un chiffre inventé en attendant le vrai est pire qu'un écran vide :
 * on finit par croire le chiffre.
 */
function EnAttente({ titre, quoi }: { titre: string; quoi: string }) {
  return (
    <main className="page">
      <header>
        <h1>{titre}</h1>
        <p>{quoi}</p>
      </header>
      <div className="carte">
        <p className="discret">Cet écran arrive au lot 5.</p>
      </div>
    </main>
  )
}

export function Accueil() {
  const { etat } = useEtat()
  const jour = aujourdhui()
  const compteId = etat.reglages.compte_courant_id
  const solde = compteId !== undefined ? soldeDuCompte(etat, compteId, jour) : null

  return (
    <main className="page">
      <header>
        <h1>Accueil</h1>
        <p>{jour}</p>
      </header>
      {solde !== null ? (
        <div className="carte">
          <h2>Solde du compte courant</h2>
          <Montant valeur={solde} principal neutre />
          <p className="discret">
            Le reste à vivre, la projection et les prochaines échéances arrivent au lot 5.
          </p>
        </div>
      ) : (
        <div className="carte">
          <p className="discret">Aucun compte courant désigné.</p>
        </div>
      )}
    </main>
  )
}

export function Comptes() {
  const { etat } = useEtat()
  const jour = aujourdhui()
  const { total, parGroupe } = patrimoine(etat, jour)
  const comptes = [...etat.comptes.values()].filter((c) => c.archived_at === undefined)

  return (
    <main className="page">
      <header>
        <h1>Comptes</h1>
        <p>Patrimoine total</p>
      </header>
      <div className="carte">
        <Montant valeur={total} principal neutre />
        <p className="discret">
          Bancaire <Montant valeur={parGroupe.get('bancaire') ?? (0 as never)} neutre /> ·
          Investissement <Montant valeur={parGroupe.get('investissement') ?? (0 as never)} neutre />
        </p>
      </div>
      {comptes.map((compte) => (
        <div className="carte" key={compte.id}>
          <h2>{compte.nom}</h2>
          <Montant valeur={soldeDuCompte(etat, compte.id, jour)} neutre />
        </div>
      ))}
      {comptes.length === 0 && (
        <div className="carte">
          <p className="discret">Aucun compte.</p>
        </div>
      )}
    </main>
  )
}

export function Calendrier() {
  return <EnAttente titre="Calendrier" quoi="Grille mensuelle et courbe de solde projeté." />
}

export function Ajout() {
  return <EnAttente titre="Ajout rapide" quoi="Montant d’abord, puis entrée, sortie ou virement." />
}
