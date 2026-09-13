import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { analyserCsv, decoderTexte, NOMS_SEPARATEUR, type FichierCsv } from '../core/csv'
import { useFormatMontant } from '../app/discretion'
import { ecrire } from '../app/magasin'
import { useEtat } from '../app/useEtat'
import type { EntreeJournal } from '../domain/events'
import type { TypeCompte } from '../domain/etat'
import { identifiant } from '../domain/identifiant'
import {
  correspondanceUtilisable,
  detecterCorrespondance,
  evenementsImport,
  lireOperations,
  NOMS_ROLE,
  preparerImport,
  premiereLigneEstEntete,
  ROLES,
  type Correspondance,
  type PlanImport,
  type RejetLigne,
} from '../domain/releve'

/**
 * Import d'un relevé bancaire.
 *
 * L'écran est bâti sur un principe : **rien n'est écrit avant que tout soit
 * montré**. Le journal est en ajout seul, donc un import se défait mal ; un
 * aperçu chiffré — tant de nouvelles, tant de déjà connues, tant sans effet sur
 * le solde — coûte un écran et évite un regret.
 *
 * Les trois questions auxquelles il doit répondre avant d'écrire :
 *
 * - **Quel compte ?** Un fichier de banque ne le dit pas. On le choisit, ou on
 *   le crée ici même : obliger à sortir pour créer le compte puis revenir
 *   perdrait le fichier en route.
 * - **Y aura-t-il des doublons ?** Non pour les lignes déjà importées — elles
 *   portent le même identifiant. Peut-être pour celles déjà saisies à la main :
 *   on les montre, on ne devine pas à leur place.
 * - **Qu'est-ce que ça change ?** Rien de ce qui existe : un import ajoute. Sauf
 *   les écarts de réconciliation, qui font double emploi avec le détail qu'on
 *   importe et qu'on propose donc de retirer.
 */
const TYPES: { valeur: TypeCompte; libelle: string }[] = [
  { valeur: 'courant', libelle: 'Compte courant' },
  { valeur: 'livret', libelle: 'Livret (A, LDDS, LEP…)' },
  { valeur: 'autre', libelle: 'Autre' },
]

const MAX_APERCU = 6
const MAX_REFUS = 5
const NOUVEAU = '__nouveau__'

export function ImportReleve() {
  const { etat, journal } = useEtat()
  const naviguer = useNavigate()
  const formater = useFormatMontant()
  const champFichier = useRef<HTMLInputElement>(null)

  const comptes = [...etat.comptes.values()].filter(
    (compte) => compte.archived_at === undefined && compte.mode === 'saisi',
  )

  const [choixCompte, setChoixCompte] = useState<string>(
    etat.reglages.compte_courant_id ?? comptes[0]?.id ?? NOUVEAU,
  )
  const [nomCompte, setNomCompte] = useState('')
  const [typeCompte, setTypeCompte] = useState<TypeCompte>('courant')
  // Fixé une fois pour toutes : le recalculer à chaque rendu changerait les
  // empreintes sous l'aperçu, et le plan affiché ne serait plus celui qu'on écrit.
  const [idNouveauCompte] = useState(() => identifiant('compte'))
  const nouveau = choixCompte === NOUVEAU
  const compteId = nouveau ? idNouveauCompte : choixCompte

  const [fichier, setFichier] = useState<(FichierCsv & { nom: string; encodage: string }) | null>(
    null,
  )
  const [correspondance, setCorrespondance] = useState<Correspondance>([])
  const [entete, setEntete] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)

  const [ecarterRessemblances, setEcarterRessemblances] = useState(true)
  const [ecarterAnterieures, setEcarterAnterieures] = useState(false)
  const [choixEcarts, setChoixEcarts] = useState<Record<string, boolean>>({})

  const [calcul, setCalcul] = useState<{
    lecture: unknown
    compteId: string
    plan: PlanImport
  } | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [resultat, setResultat] = useState<string | null>(null)

  const lecture = useMemo(() => {
    if (fichier === null || !correspondanceUtilisable(correspondance)) return null
    return lireOperations(fichier.lignes, correspondance, { premiereEstEntete: entete })
  }, [fichier, correspondance, entete])

  // Le plan demande un condensé par ligne, donc une opération asynchrone. Il est
  // rangé avec ce dont il a été tiré : tant que la lecture ou le compte ne
  // correspondent plus, on n'affiche rien plutôt qu'un aperçu périmé — montrer
  // le plan d'un autre compte que celui choisi serait pire que ne rien montrer.
  useEffect(() => {
    if (lecture === null || lecture.operations.length === 0) return
    let vivant = true
    void preparerImport(etat, journal, compteId, lecture.operations).then((prepare) => {
      if (vivant) setCalcul({ lecture, compteId, plan: prepare })
    })
    return () => {
      vivant = false
    }
  }, [lecture, compteId, etat, journal])

  const plan =
    calcul !== null && calcul.lecture === lecture && calcul.compteId === compteId
      ? calcul.plan
      : null

  async function charger(brut: File) {
    setErreur(null)
    setResultat(null)
    try {
      // Le contenu est lu **avant** toute remise à zéro du champ : vider
      // `input.value` invalide la source, et la lecture reste alors en suspens.
      const { texte, encodage } = decoderTexte(await brut.arrayBuffer())
      const analyse = analyserCsv(texte)
      if (analyse.lignes.length === 0) {
        setErreur('Ce fichier ne contient aucune ligne.')
        return
      }
      const largeur = Math.max(...analyse.lignes.map((ligne) => ligne.length))
      const premiere = analyse.lignes[0]!
      const devinee = detecterCorrespondance(
        Array.from({ length: largeur }, (_, rang) => premiere[rang] ?? ''),
      )
      setFichier({ ...analyse, nom: brut.name, encodage })
      setCorrespondance(devinee)
      setEntete(premiereLigneEstEntete(analyse.lignes, devinee))
      setChoixEcarts({})
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      if (champFichier.current) champFichier.current.value = ''
    }
  }

  function changerRole(rang: number, role: string) {
    setCorrespondance((actuelle) => {
      const suivante = [...actuelle]
      // Un rôle ne vaut que porté par une seule colonne : le déplacer plutôt que
      // le dupliquer évite une correspondance impossible à lire.
      if (role !== 'ignore') {
        for (let i = 0; i < suivante.length; i++) if (suivante[i] === role) suivante[i] = 'ignore'
      }
      suivante[rang] = role as Correspondance[number]
      return suivante
    })
  }

  const supprimerEcart = (id: string, defaut: boolean) => choixEcarts[id] ?? defaut

  const aEcrire = useMemo(() => {
    if (plan === null) return 0
    return plan.nouvelles.filter(
      (operation) =>
        !(ecarterRessemblances && operation.ressemblance !== undefined) &&
        !(ecarterAnterieures && operation.sansEffetSurSolde),
    ).length
  }, [plan, ecarterRessemblances, ecarterAnterieures])

  const compteValide = !nouveau || nomCompte.trim() !== ''

  async function confirmer() {
    if (plan === null || !compteValide) return
    setOccupe(true)
    setErreur(null)
    try {
      const entrees: EntreeJournal[] = []
      if (nouveau) {
        entrees.push({
          type: 'account.created',
          payload: {
            id: compteId,
            nom: nomCompte.trim(),
            type: typeCompte,
            groupe: 'bancaire',
            mode: 'saisi',
          },
        })
      }
      entrees.push(
        ...evenementsImport(plan, {
          ecarterRessemblances,
          ecarterAnterieures,
          reconciliationsASupprimer: plan.reconciliations
            .filter((ecart) => supprimerEcart(ecart.transaction.id, ecart.pleinementCouverte))
            .map((ecart) => ecart.transaction.id),
        }),
      )
      const ecrits = await ecrire(entrees)
      const operations = ecrits.filter((e) => e.type === 'transaction.created').length
      setResultat(
        operations === 0
          ? 'Rien de nouveau : toutes ces lignes étaient déjà dans le journal.'
          : `${operations} opération(s) importée(s).`,
      )
      setFichier(null)
      setCalcul(null)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setOccupe(false)
    }
  }

  return (
    <main className="page">
      <header>
        <h1>Importer un relevé</h1>
        <p>
          Un fichier CSV de votre banque. Rien n’est écrit avant que vous ayez vu ce qui va être
          ajouté.
        </p>
      </header>

      <div className="champ">
        <label htmlFor="compte-import">Compte concerné</label>
        <select
          id="compte-import"
          value={choixCompte}
          onChange={(e) => setChoixCompte(e.target.value)}
        >
          <option value={NOUVEAU}>+ Nouveau compte…</option>
          {comptes.map((compte) => (
            <option key={compte.id} value={compte.id}>
              {compte.nom}
            </option>
          ))}
        </select>
        <p className="discret">
          Un fichier de banque ne dit pas à quel compte il appartient : c’est à vous de le désigner.
        </p>
      </div>

      {nouveau && (
        <div className="champ-imbrique">
          <div className="champ">
            <label htmlFor="nom-nouveau-compte">Nom du compte</label>
            <input
              id="nom-nouveau-compte"
              value={nomCompte}
              autoComplete="off"
              placeholder="Compte courant"
              onChange={(e) => setNomCompte(e.target.value)}
            />
          </div>
          <div className="champ">
            <label htmlFor="type-nouveau-compte">Type</label>
            <select
              id="type-nouveau-compte"
              value={typeCompte}
              onChange={(e) => setTypeCompte(e.target.value as TypeCompte)}
            >
              {TYPES.map((type) => (
                <option key={type.valeur} value={type.valeur}>
                  {type.libelle}
                </option>
              ))}
            </select>
          </div>
          <p className="discret">
            Le compte sera créé sans solde de départ : toutes les lignes importées compteront donc
            dans son solde. Relevez le solde réel ensuite, par une réconciliation.
          </p>
        </div>
      )}

      <div className="carte">
        <h2>Fichier</h2>
        <input
          ref={champFichier}
          type="file"
          accept="text/csv,.csv,.txt"
          hidden
          onChange={(e) => {
            const choisi = e.target.files?.[0]
            if (choisi) void charger(choisi)
          }}
        />
        {fichier === null ? (
          <p className="discret">
            Exportez le relevé depuis le site de votre banque, au format CSV, puis choisissez-le
            ici.
          </p>
        ) : (
          <p className="discret">
            {fichier.nom} · {fichier.lignes.length} ligne(s) · séparateur{' '}
            {NOMS_SEPARATEUR[fichier.separateur]} · {fichier.encodage}
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            className="secondaire"
            onClick={() => champFichier.current?.click()}
            disabled={occupe}
          >
            {fichier === null ? 'Choisir un fichier' : 'Changer de fichier'}
          </button>
        </div>
      </div>

      {erreur !== null && (
        <div className="erreur-champ" role="alert">
          <p>{erreur}</p>
        </div>
      )}

      {fichier !== null && (
        <div className="carte">
          <h2>Colonnes</h2>
          <p className="discret">
            Chaque banque nomme ses colonnes à sa façon. Vérifiez, et corrigez si besoin.
          </p>
          <label className="case">
            <input type="checkbox" checked={entete} onChange={(e) => setEntete(e.target.checked)} />
            La première ligne contient les noms de colonnes
          </label>
          <ul className="liste">
            {correspondance.map((role, rang) => {
              const exemple = (fichier.lignes[entete ? 1 : 0] ?? [])[rang] ?? ''
              return (
                <li key={rang}>
                  <div className="champ">
                    <label htmlFor={`colonne-${rang}`}>
                      {entete
                        ? ((fichier.lignes[0] ?? [])[rang] ?? `Colonne ${rang + 1}`)
                        : `Colonne ${rang + 1}`}
                    </label>
                    <select
                      id={`colonne-${rang}`}
                      value={role}
                      onChange={(e) => changerRole(rang, e.target.value)}
                    >
                      {ROLES.map((valeur) => (
                        <option key={valeur} value={valeur}>
                          {NOMS_ROLE[valeur]}
                        </option>
                      ))}
                    </select>
                    {exemple !== '' && <p className="discret">Exemple : {exemple}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
          {!correspondanceUtilisable(correspondance) && (
            <p className="avertissement">
              <strong>Il manque l’essentiel</strong> : une colonne de date, et soit un montant
              signé, soit un débit et un crédit.
            </p>
          )}
        </div>
      )}

      {lecture !== null && lecture.rejets.length > 0 && <Refus rejets={lecture.rejets} />}

      {plan !== null && (
        <>
          <div className="carte">
            <h2>Ce qui va être ajouté</h2>
            <p className="montant-principal">{aEcrire}</p>
            <p className="discret">
              opération(s) sur {plan.operations.length} lue(s), du {plan.debut} au {plan.fin}.
            </p>
            {plan.deja.length > 0 && (
              <p className="discret">
                {plan.deja.length} ligne(s) déjà importée(s) : elles portent le même identifiant que
                la première fois, elles ne seront pas ajoutées une seconde fois.
              </p>
            )}
            <ul className="liste">
              {plan.nouvelles.slice(0, MAX_APERCU).map((operation) => (
                <li key={operation.idEvenement}>
                  <div className="ligne-label">
                    <span>
                      <strong>
                        {operation.libelle === '' ? 'Sans libellé' : operation.libelle}
                      </strong>
                      <span className="discret"> · {operation.date}</span>
                    </span>
                    <span>{formater(operation.montant_cents)}</span>
                  </div>
                </li>
              ))}
            </ul>
            {plan.nouvelles.length > MAX_APERCU && (
              <p className="discret">et {plan.nouvelles.length - MAX_APERCU} autre(s).</p>
            )}
          </div>

          {plan.ressemblances.length > 0 && (
            <div className="carte a-confirmer">
              <h2>Peut-être déjà saisies</h2>
              <p>
                {plan.ressemblances.length} ligne(s) tombent le même jour et pour le même montant
                qu’une opération déjà présente, saisie autrement. Aucune empreinte ne peut trancher
                : le libellé de la banque n’est pas celui que vous avez tapé.
              </p>
              <ul className="liste">
                {plan.ressemblances.slice(0, MAX_APERCU).map((operation) => (
                  <li key={operation.idEvenement}>
                    <div className="ligne-label">
                      <span>
                        {operation.date} ·{' '}
                        {operation.libelle === '' ? 'Sans libellé' : operation.libelle}
                        <span className="discret">
                          {' '}
                          ↔ {operation.ressemblance?.note ?? 'saisie existante'}
                        </span>
                      </span>
                      <span>{formater(operation.montant_cents)}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <label className="case">
                <input
                  type="checkbox"
                  checked={ecarterRessemblances}
                  onChange={(e) => setEcarterRessemblances(e.target.checked)}
                />
                Ne pas les importer
              </label>
            </div>
          )}

          {plan.sansEffetSurSolde.length > 0 && (
            <div className="carte">
              <h2>Sans effet sur le solde</h2>
              <p className="discret">
                {plan.sansEffetSurSolde.length} ligne(s) sont antérieures à votre dernier relevé
                {plan.ancre !== null && <> du {plan.ancre}</>}. Le solde part de ce relevé et
                n’additionne que ce qui vient après : ces lignes enrichiront votre historique et vos
                totaux par poste, mais ne déplaceront pas le solde. Ce n’est pas une panne.
              </p>
              <label className="case">
                <input
                  type="checkbox"
                  checked={ecarterAnterieures}
                  onChange={(e) => setEcarterAnterieures(e.target.checked)}
                />
                Ne pas les importer
              </label>
            </div>
          )}

          {plan.reconciliations.length > 0 && (
            <div className="carte a-confirmer">
              <h2>Écarts de réconciliation</h2>
              <p>
                Un écart « Non catégorisé » résume les dépenses non saisies d’une période. Le relevé
                que vous importez les apporte en détail : garder les deux compterait deux fois les
                mêmes dépenses dans vos totaux.
              </p>
              <ul className="liste">
                {plan.reconciliations.map((ecart) => (
                  <li key={ecart.transaction.id}>
                    <div className="ligne-label">
                      <span>
                        <strong>{ecart.transaction.date}</strong>
                        <span className="discret">
                          {' '}
                          · période{' '}
                          {ecart.depuis === null ? 'depuis l’origine' : `depuis le ${ecart.depuis}`}
                        </span>
                      </span>
                      <span>{formater(ecart.transaction.montant_cents)}</span>
                    </div>
                    <label className="case">
                      <input
                        type="checkbox"
                        checked={supprimerEcart(ecart.transaction.id, ecart.pleinementCouverte)}
                        onChange={(e) =>
                          setChoixEcarts((actuels) => ({
                            ...actuels,
                            [ecart.transaction.id]: e.target.checked,
                          }))
                        }
                      />
                      Supprimer cet écart
                    </label>
                    {!ecart.pleinementCouverte && (
                      <p className="avertissement">
                        <strong>Période couverte en partie seulement.</strong> Le supprimer
                        effacerait des dépenses que ce fichier ne remplace pas.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <p className="discret">
                Supprimer un écart ne change pas le solde affiché : il avait été écrit juste avant
                le relevé qui l’a suivi, donc il ne comptait déjà plus. Ce sont les totaux du mois
                que cela corrige.
              </p>
            </div>
          )}
        </>
      )}

      {resultat !== null && (
        <p className="discret" role="status">
          {resultat}
        </p>
      )}

      <div className="actions">
        <button type="button" className="secondaire" onClick={() => void naviguer(-1)}>
          {resultat === null ? 'Annuler' : 'Retour'}
        </button>
        <button
          type="button"
          onClick={() => void confirmer()}
          disabled={
            plan === null ||
            occupe ||
            !compteValide ||
            aEcrire + countEcarts(plan, choixEcarts) === 0
          }
        >
          {occupe ? 'Import…' : 'Importer'}
        </button>
      </div>
    </main>
  )
}

/** Nombre d'écarts de réconciliation que l'utilisateur a laissés cochés. */
function countEcarts(plan: PlanImport | null, choix: Record<string, boolean>): number {
  if (plan === null) return 0
  return plan.reconciliations.filter(
    (ecart) => choix[ecart.transaction.id] ?? ecart.pleinementCouverte,
  ).length
}

/**
 * Les lignes refusées, avec la raison.
 *
 * La raison, pas seulement le compte : « 3 lignes ignorées » ne se corrige pas,
 * « ligne 14 : montant illisible (« 12,505 ») » se corrige.
 */
function Refus({ rejets }: { rejets: RejetLigne[] }) {
  return (
    <div className="erreur-champ">
      <p>Ce qui n’a pas pu être lu :</p>
      <ul>
        {rejets.slice(0, MAX_REFUS).map((rejet) => (
          <li key={rejet.ligne}>
            Ligne {rejet.ligne} : {rejet.raison}
          </li>
        ))}
      </ul>
      {rejets.length > MAX_REFUS && (
        <p>et {rejets.length - MAX_REFUS} autre(s) de la même nature.</p>
      )}
    </div>
  )
}
