import { useCallback, useEffect, useRef, useState } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { maintenant } from '../core/clock'
import { Abonnements, FormulaireAbonnement } from '../screens/Abonnements'
import { Accueil } from '../screens/Accueil'
import { Ajout } from '../screens/Ajout'
import { Calendrier } from '../screens/Calendrier'
import { Comptes, DetailCompte } from '../screens/Comptes'
import { Confirmer } from '../screens/Confirmer'
import { Labels } from '../screens/Labels'
import { Onboarding } from '../screens/Onboarding'
import { Reconciliation } from '../screens/Reconciliation'
import { Reglages } from '../screens/Reglages'
import { BarreOnglets } from '../ui/BarreOnglets'
import { enregistrerInstantanes } from './automatismes'
import { ConfigurationPin } from './ConfigurationPin'
import { activerCoffre, demarrer, ouvrirJournal, type Demarrage } from './demarrage'
import { useEtat } from './useEtat'
import { Verrouillage } from './Verrouillage'
import { DELAI_REVERROUILLAGE_MS, verrouiller, type Verrou } from './verrou'

/**
 * Routage par hash : GitHub Pages ne réécrit pas les URL vers `index.html`, et le
 * contournement par `404.html` casse le partage de lien et l'historique.
 */
export function App() {
  const [demarrage, setDemarrage] = useState<Demarrage | null>(null)
  const [verrou, setVerrou] = useState<Verrou | null>(null)
  const [echec, setEchec] = useState<string | null>(null)
  const [configuration, setConfiguration] = useState(false)

  useEffect(() => {
    demarrer()
      .then((resultat) => {
        setDemarrage(resultat)
        setVerrou(resultat.verrou)
      })
      .catch((erreur: unknown) => {
        setEchec(erreur instanceof Error ? erreur.message : String(erreur))
      })
  }, [])

  const surOuverture = useCallback(
    (ouvert: Verrou) => {
      setVerrou(ouvert)
      if (demarrage) void ouvrirJournal(demarrage.base, ouvert)
    },
    [demarrage],
  )

  const surPinConfigure = useCallback(
    async (nouveau: Verrou) => {
      if (!demarrage || verrou === null || nouveau.meta === null) return
      // Le journal déjà écrit en clair est rechiffré avant toute chose : sans
      // cela, activer un code rendrait illisible tout ce qui existait.
      await activerCoffre(demarrage.base, verrou, nouveau)
      await ouvrirJournal(demarrage.base, nouveau)
      setVerrou(nouveau)
      setConfiguration(false)
    },
    [demarrage, verrou],
  )

  if (echec !== null) {
    return (
      <main className="page">
        <h1>Démarrage impossible</h1>
        <p className="erreur-champ" role="alert">
          {echec}
        </p>
      </main>
    )
  }

  if (!demarrage || !verrou) {
    return (
      <main className="page">
        <p className="discret">Ouverture…</p>
      </main>
    )
  }

  if (verrou.etat.statut === 'verrouille') {
    return <Verrouillage verrou={verrou} onVerrou={setVerrou} onOuvert={surOuverture} />
  }

  if (configuration) {
    return (
      <ConfigurationPin
        onAnnuler={() => setConfiguration(false)}
        onConfigure={(nouveau) => void surPinConfigure(nouveau)}
      />
    )
  }

  return (
    <>
      <ReverrouillageAutomatique
        verrou={verrou}
        onVerrouiller={() => setVerrou(verrouiller(verrou))}
      />
      <HashRouter>
        <Contenu
          persistance={demarrage.persistance}
          aUnPin={verrou.meta !== null}
          onConfigurerPin={() => setConfiguration(true)}
        />
      </HashRouter>
    </>
  )
}

function Contenu({
  persistance,
  aUnPin,
  onConfigurerPin,
}: {
  persistance: Demarrage['persistance']
  aUnPin: boolean
  onConfigurerPin: () => void
}) {
  const { etat, chargement } = useEtat()
  const [onboardingFini, setOnboardingFini] = useState(false)
  const instantanesFaits = useRef(false)

  // Sans cron, l'instantané quotidien se déclenche à l'ouverture. La courbe de
  // patrimoine aura donc des trous les semaines sans ouverture : on relie les
  // points existants, on n'invente jamais de valeur.
  useEffect(() => {
    if (chargement || instantanesFaits.current || etat.comptes.size === 0) return
    instantanesFaits.current = true
    void enregistrerInstantanes(etat)
  }, [chargement, etat])

  if (chargement) {
    return (
      <main className="page">
        <p className="discret">Lecture du journal…</p>
      </main>
    )
  }

  // Aucun compte : l'application est vide et donc inutile. On demande le minimum
  // qui la rend utile, pas un inventaire.
  if (etat.comptes.size === 0 && !onboardingFini) {
    return <Onboarding onTermine={() => setOnboardingFini(true)} />
  }

  return (
    <div className="coquille">
      <Routes>
        <Route path="/" element={<Accueil />} />
        <Route path="/calendrier" element={<Calendrier />} />
        <Route path="/ajout" element={<Ajout />} />
        <Route path="/comptes" element={<Comptes />} />
        <Route path="/comptes/:id" element={<DetailCompte />} />
        <Route path="/abonnements" element={<Abonnements />} />
        <Route path="/abonnements/:id" element={<FormulaireAbonnement />} />
        <Route path="/depenses" element={<Labels />} />
        <Route path="/reconciliation" element={<Reconciliation />} />
        <Route path="/confirmer" element={<Confirmer />} />
        <Route
          path="/reglages"
          element={
            <Reglages persistance={persistance} aUnPin={aUnPin} onConfigurerPin={onConfigurerPin} />
          }
        />
        <Route path="*" element={<Accueil />} />
      </Routes>
      <BarreOnglets />
    </div>
  )
}

/**
 * Re-verrouille après une absence.
 *
 * Le compte à rebours part au moment où l'application passe en arrière-plan, pas
 * à la dernière frappe : c'est le téléphone posé sur une table qui est le risque,
 * pas l'utilisateur qui réfléchit devant son écran.
 */
function ReverrouillageAutomatique({
  verrou,
  onVerrouiller,
}: {
  verrou: Verrou
  onVerrouiller: () => void
}) {
  const sortieLe = useRef<number | null>(null)

  useEffect(() => {
    if (verrou.etat.statut !== 'ouvert') return
    function surVisibilite() {
      if (document.visibilityState === 'hidden') {
        sortieLe.current = maintenant()
        return
      }
      if (sortieLe.current !== null && maintenant() - sortieLe.current > DELAI_REVERROUILLAGE_MS) {
        onVerrouiller()
      }
      sortieLe.current = null
    }
    document.addEventListener('visibilitychange', surVisibilite)
    return () => document.removeEventListener('visibilitychange', surVisibilite)
  }, [verrou.etat.statut, onVerrouiller])

  return null
}
