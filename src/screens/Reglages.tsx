import { useRef, useState, useSyncExternalStore } from 'react'
import { aujourdhui } from '../core/clock'
import { formaterMontant, type Cents } from '../core/money'
import { depotCourant, ecrire, recharger } from '../app/magasin'
import { marquerExport, rappelSauvegarde } from '../app/automatismes'
import { useEtat } from '../app/useEtat'
import { installationProposee, installer, sabonnerInstallation } from '../app/installation'
import { PIN_LONGUEUR_RECOMMANDEE } from '../app/verrou'
import type { EtatPersistance } from '../storage/persistance'
import { Montant } from '../ui/Montant'
import { SaisieMontant } from '../ui/SaisieMontant'

/**
 * Réglages.
 *
 * L'export a été livré ici avant tout écran de saisie : la règle du plan est
 * qu'aucune donnée réelle n'entre avant que le filet existe.
 */

/**
 * Combien de refus d'import on détaille.
 *
 * Un fichier corrompu en produit parfois des milliers, tous identiques : les
 * afficher tous noierait la seule information utile, qui est la première ligne.
 * Assez pour distinguer « une date invalide » de « ce fichier n'est pas le bon ».
 */
const MAX_REFUS_AFFICHES = 5
export function Reglages({
  persistance,
  aUnPin,
  onConfigurerPin,
  onChangerPin,
}: {
  persistance: EtatPersistance
  aUnPin: boolean
  onConfigurerPin: () => void
  onChangerPin: () => void
}) {
  const { etat, journal, rejets } = useEtat()
  const [message, setMessage] = useState<string | null>(null)
  const [refus, setRefus] = useState<string[]>([])
  const [occupe, setOccupe] = useState(false)
  const champFichier = useRef<HTMLInputElement>(null)
  const rappel = rappelSauvegarde()

  /**
   * Export du journal.
   *
   * Tout le filet de sécurité de cette application tient à ce bouton : sans
   * serveur, un téléphone perdu sans export, c'est tout perdu. Il doit donc
   * marcher sur un téléphone, et `<a download>` n'y est pas sûr : Safari sur iOS
   * l'ignore pour une URL blob et ouvre le contenu dans un onglet. L'utilisateur
   * croit avoir sauvegardé, le rappel disparaît, et il n'a aucun fichier.
   *
   * D'où l'ordre : la feuille de partage quand le navigateur sait la faire —
   * c'est elle qui donne « Enregistrer dans Fichiers » sur iOS, et le choix de
   * l'application de destination sur Android — et le lien de téléchargement
   * sinon. Le rappel n'est effacé que si quelque chose a
   * réellement eu lieu : un partage annulé n'est pas une sauvegarde.
   */
  async function exporter() {
    const depot = depotCourant()
    if (!depot) {
      setMessage('Le journal n’est pas encore ouvert. Réessayez dans un instant.')
      return
    }
    setOccupe(true)
    setRefus([])
    try {
      const texte = await depot.exporterTexte()
      // Date civile locale, pas UTC : un export fait à 00 h 30 doit porter la
      // date d'aujourd'hui, pas celle d'hier.
      const nom = `ingenious-${aujourdhui()}.json`
      const partage = await partagerFichier(nom, texte)
      if (partage === 'annule') {
        setMessage('Export annulé. Rien n’a été enregistré.')
        return
      }
      if (partage === 'indisponible') telechargerFichier(nom, texte)
      marquerExport()
      setMessage(`${journal.length} événements exportés dans ${nom}.`)
    } catch (erreur) {
      setMessage(erreur instanceof Error ? erreur.message : String(erreur))
    } finally {
      setOccupe(false)
    }
  }

  async function importer(fichier: File) {
    const depot = depotCourant()
    if (!depot) {
      // Ne jamais sortir en silence : un bouton qui ne fait rien sans rien dire
      // est plus déroutant qu'un message d'erreur.
      setMessage('Le journal n’est pas encore ouvert. Réessayez dans un instant.')
      return
    }
    setOccupe(true)
    setRefus([])
    try {
      // Le contenu est lu **avant** toute remise à zéro du champ : vider
      // `input.value` invalide la source du fichier, et la lecture reste alors
      // en suspens pour toujours — un import qui ne finit jamais et ne dit rien.
      const texte = await fichier.text()
      const resultat = await depot.importer(texte)
      await recharger()
      setMessage(
        `${resultat.ajoutes} ajoutés, ${resultat.deja} déjà présents` +
          (resultat.rejets.length > 0 ? `, ${resultat.rejets.length} refusés.` : '.'),
      )
      // La raison, pas seulement le compte. Un import qui annonce
      // « 412 refusés » et s'arrête là ne laisse rien à faire ; la même phrase
      // suivie de « event[3].payload.date : date civile attendue » se corrige.
      setRefus(resultat.rejets.map((rejet) => rejet.raison))
    } catch (erreur) {
      setMessage(erreur instanceof Error ? erreur.message : String(erreur))
    } finally {
      setOccupe(false)
      // Remis à zéro maintenant que la lecture est terminée, pour que
      // réimporter le même fichier redéclenche l'événement.
      if (champFichier.current) champFichier.current.value = ''
    }
  }

  return (
    <main className="page">
      <header>
        <h1>Réglages</h1>
      </header>

      {rappel.du && (
        <div className="carte a-confirmer">
          <h2>
            <span aria-hidden="true">💾</span> Sauvegarde
          </h2>
          <p>
            {rappel.dernier === null
              ? 'Aucun export n’a jamais été fait depuis cet appareil.'
              : `Dernier export il y a ${rappel.jours} jours.`}{' '}
            Sans serveur, un téléphone cassé sans export, c’est tout perdu.
          </p>
        </div>
      )}

      <div className="carte">
        <h2>Sauvegarde</h2>
        <p className="discret">
          Le fichier produit est le journal lui-même, en clair : relisible dans dix ans avec
          n’importe quel outil. L’import fusionne, il n’écrase jamais.
        </p>
        <div className="actions">
          <button type="button" onClick={() => void exporter()} disabled={occupe}>
            Exporter
          </button>
          <input
            ref={champFichier}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const fichier = e.target.files?.[0]
              if (fichier) void importer(fichier)
            }}
          />
          <button
            type="button"
            className="secondaire"
            onClick={() => champFichier.current?.click()}
            disabled={occupe}
          >
            Importer
          </button>
        </div>
        {message !== null && (
          <p className="discret" role="status">
            {message}
          </p>
        )}
        {refus.length > 0 && (
          <div className="erreur-champ">
            <p>Ce qui a été refusé, et pourquoi :</p>
            <ul>
              {refus.slice(0, MAX_REFUS_AFFICHES).map((raison, rang) => (
                <li key={rang}>{raison}</li>
              ))}
            </ul>
            {refus.length > MAX_REFUS_AFFICHES && (
              <p>et {refus.length - MAX_REFUS_AFFICHES} autre(s) de la même nature.</p>
            )}
          </div>
        )}
      </div>

      <ReserveResteAVivre reserve={etat.reglages.reserve_cents} />

      <CompteCourant
        comptes={[...etat.comptes.values()].filter((c) => c.archived_at === undefined)}
        courant={etat.reglages.compte_courant_id}
      />

      <div className="carte">
        <h2>Code de verrouillage</h2>
        {aUnPin ? (
          <>
            <p className="discret">
              Un code est configuré. Les données de cet appareil sont chiffrées avec lui.
            </p>
            <div className="actions">
              <button type="button" className="secondaire" onClick={onChangerPin}>
                Changer le code
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="discret">
              Aucun code. Les données ne sont pas chiffrées : qui ouvre les outils de développement
              les lit.
            </p>
            <p className="avertissement">
              <strong>À savoir avant de choisir :</strong> un code perdu, ce sont les données
              perdues, sans aucune récupération. Un code à quatre chiffres protège d’un curieux, pas
              d’un adversaire outillé qui a le téléphone en main — {PIN_LONGUEUR_RECOMMANDEE}{' '}
              chiffres sont recommandés.
            </p>
            <div className="actions">
              <button type="button" onClick={onConfigurerPin}>
                Configurer un code
              </button>
            </div>
          </>
        )}
      </div>

      <GestionLabels />

      <div className="carte">
        <h2>Stockage</h2>
        <p className="discret">
          Persistance accordée par le navigateur :{' '}
          <strong>{persistance.accorde ? 'oui' : 'non'}</strong>. Installée sur l’écran d’accueil :{' '}
          <strong>{persistance.installee ? 'oui' : 'non'}</strong>.
        </p>
        <Installation persistance={persistance} />
      </div>

      <div className="carte">
        <h2>Journal</h2>
        <p className="discret">{journal.length} événements.</p>
        {rejets.length > 0 && (
          <p className="erreur-champ">
            {rejets.length} enregistrement(s) illisible(s) : {rejets[0]!.raison}
          </p>
        )}
      </div>
    </main>
  )
}

/**
 * Propose le fichier à la feuille de partage du système.
 *
 * `canShare` est interrogé avec le fichier lui-même : plusieurs navigateurs
 * exposent `navigator.share` sans accepter les fichiers, et ne pas le vérifier
 * ferait échouer l'export là où le lien aurait suffi.
 *
 * Safari refuse le partage si le geste de l'utilisateur a été consommé par
 * l'attente du journal ; ce refus n'est pas une erreur, c'est le cas normal sur
 * un gros journal, et il faut retomber sur le téléchargement.
 */
async function partagerFichier(
  nom: string,
  texte: string,
): Promise<'partage' | 'annule' | 'indisponible'> {
  if (typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') {
    return 'indisponible'
  }
  const fichier = new File([texte], nom, { type: 'application/json' })
  if (!navigator.canShare({ files: [fichier] })) return 'indisponible'
  try {
    await navigator.share({ files: [fichier], title: nom })
    return 'partage'
  } catch (erreur) {
    // `AbortError` : l'utilisateur a fermé la feuille. C'est un choix, pas une
    // panne — surtout pas une raison de retomber sur un téléchargement qu'il
    // n'a pas demandé, ni d'effacer le rappel de sauvegarde.
    if (erreur instanceof DOMException && erreur.name === 'AbortError') return 'annule'
    return 'indisponible'
  }
}

/**
 * Téléchargement par lien, pour les navigateurs de bureau.
 *
 * Le lien est attaché au document avant d'être cliqué, et l'URL n'est révoquée
 * qu'au tour de boucle suivant : révoquer dans la foulée du clic annule le
 * téléchargement sur plusieurs navigateurs, sans la moindre erreur visible.
 */
function telechargerFichier(nom: string, texte: string): void {
  const url = URL.createObjectURL(new Blob([texte], { type: 'application/json' }))
  const lien = document.createElement('a')
  lien.href = url
  lien.download = nom
  lien.rel = 'noopener'
  lien.style.display = 'none'
  document.body.append(lien)
  lien.click()
  lien.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Installer l'application, et dire pourquoi.
 *
 * L'écran réclamait l'installation sans offrir aucun moyen de la faire — une
 * impasse de plus. Chrome nous confie une invitation : on en fait un bouton.
 *
 * Le ton suit **ce que le navigateur a répondu**, pas une supposition sur
 * l'appareil. Quand la persistance est accordée, l'installation reste utile mais
 * n'est plus un filet de survie ; quand elle est refusée, elle est la seule
 * chose qui empêche le navigateur de faire le ménage dans des données qu'il
 * prend pour celles d'un site oublié.
 */
function Installation({ persistance }: { persistance: EtatPersistance }) {
  const proposee = useSyncExternalStore(sabonnerInstallation, installationProposee, () => false)
  const [message, setMessage] = useState<string | null>(null)

  if (persistance.installee) return null

  async function lancer() {
    const resultat = await installer()
    setMessage(
      resultat === 'acceptee'
        ? 'Installée. Ouvrez-la depuis son icône plutôt que depuis le navigateur.'
        : resultat === 'refusee'
          ? 'Installation refusée. Vous pourrez la relancer depuis le menu du navigateur.'
          : 'Ce navigateur ne propose pas l’installation ici. Passez par son menu.',
    )
  }

  return (
    <>
      <p className={persistance.accorde ? 'discret' : 'avertissement'}>
        {persistance.accorde ? (
          <>
            Le navigateur s’engage à conserver les données de cet appareil. Installer l’application
            reste préférable : elle s’ouvre en un geste, fonctionne hors ligne, et sort
            définitivement du ménage que fait le navigateur dans les sites qu’on ne visite plus.
          </>
        ) : (
          <>
            <strong>À faire :</strong> installer l’application sur l’écran d’accueil. Le navigateur
            n’a pas accordé la persistance : sans installation, il peut effacer ces données après
            quelques jours sans ouverture.
          </>
        )}
      </p>
      {proposee ? (
        <div className="actions">
          <button type="button" onClick={() => void lancer()}>
            Installer l’application
          </button>
        </div>
      ) : (
        <p className="discret">
          Par le menu du navigateur : <strong>Installer l’application</strong> ou{' '}
          <strong>Ajouter à l’écran d’accueil</strong>. Sur iPhone, c’est dans le menu de partage de
          Safari.
        </p>
      )}
      {message !== null && (
        <p className="discret" role="status">
          {message}
        </p>
      )}
    </>
  )
}

function ReserveResteAVivre({ reserve }: { reserve: Cents }) {
  const [valeur, setValeur] = useState<Cents | null>(null)
  const [occupe, setOccupe] = useState(false)

  async function enregistrer() {
    if (valeur === null) return
    setOccupe(true)
    try {
      await ecrire([{ type: 'settings.updated', payload: { reserve_cents: Math.abs(valeur) } }])
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div className="carte">
      <h2>Réserve</h2>
      <p className="discret">
        Le matelas que vous refusez d’entamer. Il est retiré du reste à vivre, pas du solde.
      </p>
      <p>
        Actuellement : <Montant valeur={reserve} neutre />
      </p>
      <SaisieMontant libelle="Nouvelle réserve" onChange={setValeur} valeurInitiale={reserve} />
      <div className="actions">
        <button
          type="button"
          onClick={() => void enregistrer()}
          disabled={valeur === null || occupe}
        >
          Enregistrer
        </button>
      </div>
    </div>
  )
}

function CompteCourant({
  comptes,
  courant,
}: {
  comptes: readonly { id: string; nom: string }[]
  courant: string | undefined
}) {
  const [occupe, setOccupe] = useState(false)

  async function choisir(id: string) {
    setOccupe(true)
    try {
      await ecrire([{ type: 'settings.updated', payload: { compte_courant_id: id } }])
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div className="carte">
      <h2>Compte du reste à vivre</h2>
      <p className="discret">
        Le reste à vivre se calcule sur un seul compte. Un solde global laisserait l’épargne masquer
        un découvert.
      </p>
      <div className="champ">
        <label htmlFor="compte-courant">Compte</label>
        <select
          id="compte-courant"
          value={courant ?? ''}
          disabled={occupe}
          onChange={(e) => void choisir(e.target.value)}
        >
          <option value="">—</option>
          {comptes.map((compte) => (
            <option key={compte.id} value={compte.id}>
              {compte.nom}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function GestionLabels() {
  const { etat } = useEtat()
  const [enEdition, setEnEdition] = useState<string | null>(null)
  const [budget, setBudget] = useState<Cents | null>(null)
  const [nom, setNom] = useState('')
  const [occupe, setOccupe] = useState(false)
  const labels = [...etat.labels.values()].filter((label) => label.archived_at === undefined)

  async function poserBudget(id: string, montant: Cents | null) {
    setOccupe(true)
    try {
      await ecrire([
        {
          type: 'label.budget_set',
          payload: montant === null ? { id } : { id, budget_mensuel_cents: Math.abs(montant) },
        },
      ])
      setEnEdition(null)
      setBudget(null)
    } finally {
      setOccupe(false)
    }
  }

  async function renommer(id: string, nouveau: string) {
    const propre = nouveau.trim()
    if (propre === '') return
    setOccupe(true)
    try {
      // Le nom normalisé se recalcule au pliage : renommer « courses » en
      // « Courses » ne crée pas un second label.
      await ecrire([{ type: 'label.renamed', payload: { id, nom: propre } }])
    } finally {
      setOccupe(false)
    }
  }

  async function archiver(id: string) {
    setOccupe(true)
    try {
      await ecrire([{ type: 'label.archived', payload: { id, date: aujourdhui() } }])
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div className="carte">
      <h2>Labels</h2>
      {labels.length === 0 ? (
        <p className="discret">Aucun label. Ils se créent à la volée depuis l’ajout rapide.</p>
      ) : (
        <ul className="liste">
          {labels.map((label) => (
            <li key={label.id} className="ligne-label-reglage">
              <div className="ligne-label">
                <span>
                  {label.nom}
                  {label.budget_mensuel_cents !== undefined && (
                    <span className="discret">
                      {' '}
                      · budget {formaterMontant(label.budget_mensuel_cents)}
                    </span>
                  )}
                </span>
                <span className="actions-ligne">
                  <button
                    type="button"
                    className="secondaire"
                    disabled={occupe}
                    onClick={() => {
                      setEnEdition(enEdition === label.id ? null : label.id)
                      setBudget(null)
                      setNom(label.nom)
                    }}
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    className="secondaire"
                    disabled={occupe}
                    onClick={() => void archiver(label.id)}
                  >
                    Archiver
                  </button>
                </span>
              </div>
              {enEdition === label.id && (
                <>
                  <div className="champ">
                    <label htmlFor={`nom-label-${label.id}`}>Nom</label>
                    <input
                      id={`nom-label-${label.id}`}
                      value={nom}
                      autoComplete="off"
                      onChange={(e) => setNom(e.target.value)}
                      onBlur={() => {
                        if (nom.trim() !== '' && nom.trim() !== label.nom) {
                          void renommer(label.id, nom)
                        }
                      }}
                    />
                  </div>
                  <SaisieMontant
                    libelle={`Budget mensuel pour « ${label.nom} »`}
                    onChange={setBudget}
                    {...(label.budget_mensuel_cents !== undefined
                      ? { valeurInitiale: label.budget_mensuel_cents }
                      : {})}
                    autoFocus
                  />
                  <div className="actions">
                    <button
                      type="button"
                      className="secondaire"
                      disabled={occupe}
                      onClick={() => void poserBudget(label.id, null)}
                    >
                      Retirer le budget
                    </button>
                    <button
                      type="button"
                      disabled={occupe || budget === null}
                      onClick={() => budget !== null && void poserBudget(label.id, budget)}
                    >
                      Enregistrer
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
