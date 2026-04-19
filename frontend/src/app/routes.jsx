import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import AppLayout from '../components/layout/AppLayout'
import { usePWA } from '../hooks/usePWA'
import { useSessionContext } from '../hooks/useSessionContext'
import { clearPostAuthPath, getLastAppPath, getPostAuthPath, setPostAuthPath } from '../utils/navigationState'
import Dashboard from '../pages/app/Dashboard'
import Chatbot from '../pages/app/Chatbot'
import Crops from '../pages/app/Crops'
import Inventory from '../pages/app/Inventory'
import MapPage from '../pages/app/Map'
import Profile from '../pages/app/Profile'
import Report from '../pages/app/Report'
import Scanner from '../pages/app/Scanner.jsx'
import Treatment from '../pages/app/Treatment'
import TreatmentPlan from '../pages/app/TreatmentPlan'
import YieldPrediction from '../pages/app/YieldPrediction'
import Weather from '../pages/app/Weather'
import Onboarding from '../pages/onboarding/Onboarding'
import Auth from '../pages/public/Auth'
import Landing from '../pages/public/Landing'

function LaunchScreen() {
  const navigate = useNavigate()

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      navigate('/auth', { replace: true })
    }, 1800)

    return () => window.clearTimeout(timeout)
  }, [navigate])

  return (
    <div className="pg-public-screen pg-ios-glass-bg">
      <section className="pg-launch pg-glass-panel">
        <div className="pg-launch-logo-container">
          <img src="/futurehack.png" alt="AcreZen Logo" className="pg-launch-logo-img" />
        </div>
        <h1 className="pg-launch-title pg-caveat-title">AcreZen</h1>
        <p className="pg-launch-subtitle">Padi health help in your pocket</p>
      </section>
    </div>
  )
}

function WebLaunchScreen() {
  const navigate = useNavigate()

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      navigate('/landing', { replace: true })
    }, 1600)

    return () => window.clearTimeout(timeout)
  }, [navigate])

  return (
    <div className="pg-public-screen pg-ios-glass-bg">
      <section className="pg-launch pg-glass-panel">
        <div className="pg-launch-logo-container">
          <img src="/futurehack.png" alt="AcreZen Logo" className="pg-launch-logo-img" />
        </div>
        <h1 className="pg-launch-title pg-caveat-title">AcreZen</h1>
        <p className="pg-launch-subtitle">Opening…</p>
      </section>
    </div>
  )
}

function RootEntry() {
  const { isInstalled } = usePWA()

  return isInstalled ? <LaunchScreen /> : <WebLaunchScreen />
}

function RequireAuth({ children }) {
  const location = useLocation()
  const { isAuthenticated, isAuthLoading } = useSessionContext()

  if (isAuthLoading) {
    return (
      <div className="pg-public-screen pg-ios-glass-bg">
        <section className="pg-launch pg-glass-panel">
          <div className="pg-launch-logo-container">
            <img src="/futurehack.png" alt="AcreZen Logo" className="pg-launch-logo-img" />
          </div>
          <h1 className="pg-launch-title pg-caveat-title">AcreZen</h1>
          <p className="pg-launch-subtitle">Checking session…</p>
        </section>
      </div>
    )
  }

  if (!isAuthenticated) {
    setPostAuthPath(location.pathname)
  }

  return isAuthenticated ? children : <Navigate to="/auth" replace />
}

function RequireOnboarding({ children }) {
  const { isOnboarded, isAuthLoading } = useSessionContext()

  if (isAuthLoading) {
    return (
      <div className="pg-public-screen pg-ios-glass-bg">
        <section className="pg-launch pg-glass-panel">
          <div className="pg-launch-logo-container">
            <img src="/futurehack.png" alt="AcreZen Logo" className="pg-launch-logo-img" />
          </div>
          <h1 className="pg-launch-title pg-caveat-title">AcreZen</h1>
          <p className="pg-launch-subtitle">Loading profile…</p>
        </section>
      </div>
    )
  }

  return isOnboarded ? children : <Navigate to="/onboarding" replace />
}

function RedirectAuthenticatedEntry() {
  const location = useLocation()
  const { isAuthenticated, isOnboarded, isAuthLoading } = useSessionContext()
  const postAuthPath = getPostAuthPath()
  const resumePath = postAuthPath && postAuthPath.startsWith('/app') ? postAuthPath : getLastAppPath()
  const forceAuth = Boolean(location.state?.forceAuth)

  if (isAuthLoading) {
    return (
      <div className="pg-public-screen pg-ios-glass-bg">
        <section className="pg-launch pg-glass-panel">
          <div className="pg-launch-logo-container">
            <img src="/futurehack.png" alt="AcreZen Logo" className="pg-launch-logo-img" />
          </div>
          <h1 className="pg-launch-title pg-caveat-title">AcreZen</h1>
          <p className="pg-launch-subtitle">Loading account…</p>
        </section>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Auth />
  }

  if (forceAuth) {
    return <Auth />
  }

  if (!isOnboarded) {
    return <Navigate to="/onboarding" replace />
  }

  return <Navigate to={resumePath} replace />
}

export const appRoutes = [
  { path: '/', element: <RootEntry /> },
  { path: '/landing', element: <Landing /> },
  { path: '/auth', element: <RedirectAuthenticatedEntry /> },
  {
    path: '/onboarding',
    element: (
      <RequireAuth>
        <Onboarding />
      </RequireAuth>
    ),
  },
  {
    path: '/app',
    element: (
      <RequireAuth>
        <RequireOnboarding>
          <AppLayout />
        </RequireOnboarding>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'map', element: <MapPage /> },
      { path: 'weather', element: <Weather /> },
      { path: 'scan', element: <Scanner /> },
      { path: 'report', element: <Report /> },
      { path: 'treatment', element: <Treatment /> },
      { path: 'roi', element: <Treatment /> },
      { path: 'treatment-plan', element: <TreatmentPlan /> },
      { path: 'yield-prediction', element: <YieldPrediction /> },
      { path: 'chatbot', element: <Chatbot /> },
      { path: 'inventory', element: <Inventory /> },
      { path: 'crops', element: <Crops /> },
      { path: 'profile', element: <Profile /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]
