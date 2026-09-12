import { useRef, useState } from 'react'
import { composantes, depuisComposantes, joursDansLeMois, type CivilDate } from '../core/civilDate'
import { aujourdhui } from '../core/clock'
import { type Cents } from '../core/money'
import { depotCourant, ecrire, recharger } from '../app/magasin'
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
 *
 * Cet écran porte aussi la **restauration**, et ce n'est pas un détail. Le
 * téléphone remplacé est exactement le cas pour lequel l'export existe ; sans
 * issue ici, il faudrait inventer un compte fictif pour atteindre Réglages, et
 * ce compte resterait dans le patrimoine — le journal est append-only, on ne
 * l'effacerait jamais. Demander d'abîmer ses données pour récupérer ses données
 * n'est pas une procédure de secours.
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
  const dateCivileDuJour = aujourdhui()

  const champFichier = useRef<HTMLInputElement>(null)
  const [messageImport, setMessageImport] = useState<string | null>(null)
  const [refus, setRefus] = useState<string[]>([])

  /**
   * Restauration depuis un export, sans rien saisir au préalable.
   *
   * L'import fusionne comme partout ailleurs : si l'appareil portait déjà
   * quelque chose, rien n'est écrasé. Une fois des comptes présents,
   * l'application s'ouvre d'elle-même — l'accueil du démarrage à froid n'a plus
   * de raison d'être.
   */
  async function restaurer(fichier: File) {
    const depot = depotCourant()
    if (!depot) {
      setMessageImport('Le journal n’est pas encore ouvert. Réessayez dans un instant.')
      return
    }
    setOccupe(true)
    setMessageImport(null)
    setRefus([])
    try {
      // Lu avant toute remise à zéro du champ : vider `input.value` invalide la
      // source du fichier, et la lecture resterait en suspens pour toujours.
      const texte = await fichier.text()
      const resultat = await depot.importer(texte)
      setRefus(resultat.rejets.map((rejet) => rejet.raison))
      if (resultat.ajoutes === 0 && resultat.deja === 0) {
        setMessageImport('Ce fichier n’a apporté aucun événement.')
        return
      }
      setMessageImport(`${resultat.ajoutes} événements restaurés.`)
      // `recharger` fait apparaître les comptes, et l'application s'ouvre aussitôt
      // d'elle-même : cet écran disparaît. Tant qu'il reste quelque chose à lire,
      // on ne recharge pas — sinon les refus s'afficheraient le temps d'un
      // clignement, sur l'écran même où l'on répare une sauvegarde abîmée.
      if (resultat.rejets.length > 0) return
      await entrer()
    } catch (erreur) {
      setMessageImport(erreur instanceof Error ? erreur.message : String(erreur))
    } finally {
      setOccupe(false)
      if (champFichier.current) champFichier.current.value = ''
    }
  }

  /** Ouvre l'application sur les données restaurées. */
  async function entrer() {
    await recharger()
    onTermine()
  }

  /**
   * Ancre une récurrence déclarée à l'installation, dans le mois en cours.
   *
   * Ce que l'utilisateur décrit ici n'est pas une dépense qui commence
   * aujourd'hui : c'est un loyer qu'il paie depuis des années. Dater le début
   * du jour de l'installation fait sauter l'échéance du mois quand son quantième
   * est déjà passé — installez l'application le 12 en déclarant un loyer le 5, et
   * votre plus grosse charge est invisible pendant tout le premier mois. C'est
   * exactement ce qu'on croit voir comme « l'abonnement n'est pas pris en
   * compte ».
   *
   * Elle est donc ancrée au quantième du mois courant. Le solde n'est pas compté
   * deux fois pour autant : le relevé saisi à l'étape 1 est daté d'aujourd'hui,
   * et seuls les mouvements postérieurs à ce relevé entrent dans le calcul.
   */
  function debutDansLeMois(jourDuMois: number): CivilDate {
    const { annee, mois } = composantes(dateCivileDuJour)
    return depuisComposantes(annee, mois, Math.min(jourDuMois, joursDansLeMois(annee, mois)))
  }

  /**
   * Depuis quand le tarif déclaré vaut.
   *
   * Le premier jour du mois, et non la date de la première échéance : un
   * abonnement dont le quantième n'est pas encore arrivé n'aurait alors aucun
   * tarif *aujourd'hui*, et sortirait du coût mensuel cumulé jusqu'à ce que la
   * date tombe. Le premier du mois précède à coup sûr et la date du jour et
   * toute échéance de ce mois.
   */
  function debutDuMois(): CivilDate {
    const { annee, mois } = composantes(dateCivileDuJour)
    return depuisComposantes(annee, mois, 1)
  }

  async function terminer() {
    setOccupe(true)
    const jour = dateCivileDuJour
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
          date_debut: debutDansLeMois(jourSalaire),
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
          valide_du: debutDuMois(),
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
          date_debut: debutDansLeMois(abonnement.jour),
          actif: true,
        },
      })
      entrees.push({
        type: 'subscription.price_changed',
        payload: {
          subscription_id: id,
          montant_cents: Math.abs(abonnement.montant),
          valide_du: debutDuMois(),
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
            <button type="button" onClick={() => setEtape(1)} disabled={solde === null || occupe}>
              Continuer
            </button>
          </div>

          <div className="carte">
            <h2>Vous avez déjà une sauvegarde ?</h2>
            <p className="discret">
              Téléphone remplacé, application réinstallée : reprenez votre fichier d’export, il
              contient tout. Rien à saisir ici.
            </p>
            <input
              ref={champFichier}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const fichier = e.target.files?.[0]
                if (fichier) void restaurer(fichier)
              }}
            />
            <div className="actions">
              <button
                type="button"
                className="secondaire"
                onClick={() => champFichier.current?.click()}
                disabled={occupe}
              >
                Restaurer une sauvegarde
              </button>
            </div>
            {messageImport !== null && (
              <p className="discret" role="status">
                {messageImport}
              </p>
            )}
            {refus.length > 0 && (
              <>
                <div className="erreur-champ">
                  <p>Ce qui a été refusé, et pourquoi :</p>
                  <ul>
                    {refus.slice(0, 5).map((raison, rang) => (
                      <li key={rang}>{raison}</li>
                    ))}
                  </ul>
                  {refus.length > 5 && <p>et {refus.length - 5} autre(s) de la même nature.</p>}
                </div>
                <div className="actions">
                  <button type="button" onClick={() => void entrer()} disabled={occupe}>
                    Continuer avec ce qui a été lu
                  </button>
                </div>
              </>
            )}
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
