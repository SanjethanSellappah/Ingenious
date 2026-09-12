import { useState } from 'react'
import { aujourdhui } from '../core/clock'
import { type Cents } from '../core/money'
import { ecrire } from '../app/magasin'
import { SaisieMontant } from '../ui/SaisieMontant'

/**
 * Démarrage à froid.
 *
 * Le jour 1, l'application est vide et donc inutile. On ne demande rien
 * d'exhaustif : un compte, une rentrée, trois abonnements suffisent à faire
 * fonctionner la projection et le reste à vivre. Tout le reste vient ensuite.
 *
 * L'abonnement est facultatif à cette étape : exiger trois saisies avant de
 * montrer quoi que ce soit est la meilleure façon de faire abandonner.
 */
type Etape = 0 | 1 | 2

export function Onboarding({ onTermine }: { onTermine: () => void }) {
  const [etape, setEtape] = useState<Etape>(0)
  const [nomCompte, setNomCompte] = useState('Compte courant')
  const [solde, setSolde] = useState<Cents | null>(null)
  const [nomSalaire, setNomSalaire] = useState('Salaire')
  const [montantSalaire, setMontantSalaire] = useState<Cents | null>(null)
  const [jourSalaire, setJourSalaire] = useState(30)
  const [occupe, setOccupe] = useState(false)

  const compteId = 'compte-courant'

  async function terminer() {
    setOccupe(true)
    const jour = aujourdhui()
    const entrees: {
      type: Parameters<typeof ecrire>[0][number]['type']
      payload: Record<string, unknown>
    }[] = [
      {
        type: 'account.created',
        payload: {
          id: compteId,
          nom: nomCompte.trim() || 'Compte courant',
          type: 'courant',
          groupe: 'bancaire',
          mode: 'saisi',
        },
      },
      {
        type: 'account.balance_set',
        payload: { account_id: compteId, date: jour, solde_cents: solde ?? 0 },
      },
      { type: 'settings.updated', payload: { compte_courant_id: compteId } },
    ]

    if (montantSalaire !== null && montantSalaire > 0) {
      const abonnementId = 'rentree-salaire'
      entrees.push({
        type: 'subscription.created',
        payload: {
          id: abonnementId,
          nom: nomSalaire.trim() || 'Salaire',
          account_id: compteId,
          sens: 'rentree',
          // Estimé dès le départ : un salaire variable est le cas courant, et le
          // montant saisi ici sert de première valeur connue.
          montant_mode: 'estime',
          frequence: 'mensuel',
          jour_du_mois: jourSalaire,
          regle_weekend: 'jour_ouvre_precedent',
          date_debut: jour,
          actif: true,
        },
      })
      // Sans historique, rien ne serait estimable au premier mois : ce
      // prévisionnel est la valeur de départ que l'onboarding doit demander.
      entrees.push({
        type: 'occurrence.overridden',
        payload: {
          subscription_id: abonnementId,
          date_theorique: `${jour.slice(0, 7)}-${String(jourSalaire).padStart(2, '0')}`,
          montant_cents: montantSalaire,
          statut: 'previsionnel',
        },
      })
    }

    await ecrire(entrees)
    onTermine()
  }

  return (
    <main className="page">
      <div className="etapes" aria-label={`Étape ${etape + 1} sur 3`}>
        {[0, 1, 2].map((rang) => (
          <span key={rang} className={rang <= etape ? 'faite' : ''} />
        ))}
      </div>

      {etape === 0 && (
        <>
          <header>
            <h1>Bienvenue</h1>
            <p>Commençons par le compte que vous regardez tous les jours.</p>
          </header>
          <div className="champ">
            <label htmlFor="nom-compte">Nom du compte</label>
            <input
              id="nom-compte"
              value={nomCompte}
              onChange={(e) => setNomCompte(e.target.value)}
              autoComplete="off"
            />
          </div>
          <SaisieMontant libelle="Solde actuel" onChange={setSolde} />
          <div className="actions">
            <button type="button" onClick={() => setEtape(1)} disabled={solde === null}>
              Continuer
            </button>
          </div>
        </>
      )}

      {etape === 1 && (
        <>
          <header>
            <h1>Votre rentrée principale</h1>
            <p>
              Le montant saisi sert de point de départ. Il s’affinera tout seul à mesure que les
              versements réels seront connus.
            </p>
          </header>
          <div className="champ">
            <label htmlFor="nom-salaire">Intitulé</label>
            <input
              id="nom-salaire"
              value={nomSalaire}
              onChange={(e) => setNomSalaire(e.target.value)}
              autoComplete="off"
            />
          </div>
          <SaisieMontant libelle="Montant habituel" onChange={setMontantSalaire} />
          <div className="champ">
            <label htmlFor="jour-salaire">Jour du mois</label>
            <input
              id="jour-salaire"
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              value={jourSalaire}
              onChange={(e) => setJourSalaire(Number(e.target.value))}
            />
          </div>
          <div className="actions">
            <button type="button" className="secondaire" onClick={() => setEtape(0)}>
              Retour
            </button>
            <button type="button" onClick={() => setEtape(2)}>
              Continuer
            </button>
          </div>
        </>
      )}

      {etape === 2 && (
        <>
          <header>
            <h1>C’est prêt</h1>
            <p>
              La projection et le reste à vivre fonctionnent déjà. Les abonnements s’ajoutent quand
              vous voulez, depuis l’onglet Comptes.
            </p>
          </header>
          <div className="carte">
            <h2>Avant de saisir vos vraies données</h2>
            <p className="discret">
              Il n’y a ni serveur ni sauvegarde automatique. L’export depuis Réglages est le seul
              filet : un téléphone cassé sans export, c’est tout perdu.
            </p>
          </div>
          <div className="actions">
            <button type="button" className="secondaire" onClick={() => setEtape(1)}>
              Retour
            </button>
            <button type="button" onClick={() => void terminer()} disabled={occupe}>
              {occupe ? 'Enregistrement…' : 'Terminer'}
            </button>
          </div>
        </>
      )}
    </main>
  )
}
