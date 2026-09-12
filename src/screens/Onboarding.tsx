import { useState } from 'react'
import { aujourdhui } from '../core/clock'
import { type Cents } from '../core/money'
import { ecrire } from '../app/magasin'
import { identifiant } from '../domain/identifiant'
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

type SaisieAbonnement = { nom: string; montant: Cents | null; jour: number }

/** Suggestions, pas des valeurs : l'utilisateur n'a pas forcément ces trois-là. */
const PLACEHOLDERS = ['Loyer', 'Téléphone', 'Électricité']

export function Onboarding({ onTermine }: { onTermine: () => void }) {
  const [etape, setEtape] = useState<Etape>(0)
  const [nomCompte, setNomCompte] = useState('Compte courant')
  const [solde, setSolde] = useState<Cents | null>(null)
  const [nomSalaire, setNomSalaire] = useState('Salaire')
  const [montantSalaire, setMontantSalaire] = useState<Cents | null>(null)
  const [jourSalaire, setJourSalaire] = useState(30)
  const [occupe, setOccupe] = useState(false)
  const [abonnements, setAbonnements] = useState<SaisieAbonnement[]>(() => [
    { nom: '', montant: null, jour: 1 },
    { nom: '', montant: null, jour: 1 },
    { nom: '', montant: null, jour: 1 },
  ])

  function modifierAbonnement(rang: number, champs: Partial<SaisieAbonnement>) {
    setAbonnements((courants) =>
      courants.map((abonnement, i) => (i === rang ? { ...abonnement, ...champs } : abonnement)),
    )
  }

  /**
   * Identifiants tirés au sort, jamais figés.
   *
   * Un identifiant en dur ferait que deux appareils créeraient « le même »
   * compte : à la fusion des journaux, l'un écraserait l'autre en silence, et
   * deux soldes différents deviendraient un seul. C'est la panne la plus
   * difficile à diagnostiquer que ce modèle puisse produire.
   */
  const [compteId] = useState(() => identifiant('compte'))
  const [abonnementId] = useState(() => identifiant('rentree'))

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
      // Le montant annoncé est enregistré comme tarif : il sert de montant de
      // départ tant qu'aucune occurrence n'a été confirmée. Sans lui, la
      // rentrée disparaîtrait de la projection dès le mois suivant, puis
      // réapparaîtrait — une courbe qui ment sans rien signaler.
      entrees.push({
        type: 'subscription.price_changed',
        payload: {
          subscription_id: abonnementId,
          montant_cents: montantSalaire,
          valide_du: jour,
        },
      })
    }

    // Les abonnements renseignés, et eux seuls : une ligne laissée vide n'est
    // pas une erreur, c'est un abonnement qu'on ajoutera plus tard.
    for (const abonnement of abonnements) {
      const nom = abonnement.nom.trim()
      if (nom === '' || abonnement.montant === null || abonnement.montant === 0) continue
      const id = identifiant('abonnement')
      entrees.push({
        type: 'subscription.created',
        payload: {
          id,
          nom,
          account_id: compteId,
          sens: 'depense',
          montant_mode: 'fixe',
          frequence: 'mensuel',
          jour_du_mois: abonnement.jour,
          regle_weekend: 'exact',
          date_debut: jour,
          actif: true,
        },
      })
      entrees.push({
        type: 'subscription.price_changed',
        payload: {
          subscription_id: id,
          montant_cents: Math.abs(abonnement.montant),
          valide_du: jour,
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
            <h1>Vos abonnements</h1>
            <p>
              Trois suffisent pour commencer : les plus gros. Le reste s’ajoute quand vous voulez —
              rien ici n’est obligatoire.
            </p>
          </header>

          {abonnements.map((abonnement, rang) => (
            <div className="carte" key={rang}>
              <div className="champ">
                <label htmlFor={`abo-nom-${rang}`}>Nom</label>
                <input
                  id={`abo-nom-${rang}`}
                  value={abonnement.nom}
                  autoComplete="off"
                  placeholder={PLACEHOLDERS[rang] ?? 'Abonnement'}
                  onChange={(e) => modifierAbonnement(rang, { nom: e.target.value })}
                />
              </div>
              <SaisieMontant
                libelle="Montant mensuel"
                onChange={(valeur) => modifierAbonnement(rang, { montant: valeur })}
              />
              <div className="champ">
                <label htmlFor={`abo-jour-${rang}`}>Jour du prélèvement</label>
                <input
                  id={`abo-jour-${rang}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={31}
                  value={abonnement.jour}
                  onChange={(e) =>
                    modifierAbonnement(rang, {
                      jour: Math.min(31, Math.max(1, Number(e.target.value))),
                    })
                  }
                />
              </div>
            </div>
          ))}

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
