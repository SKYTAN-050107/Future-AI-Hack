import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import AppLayout from '../components/layout/AppLayout'
import { usePWA } from '../hooks/usePWA'
import { useSessionContext } from '../hooks/useSessionContext'
import { clearPostAuthPath, getLastAppPath, getPostAuthPath, setPostAuthPath } from '../utils/navigationState'
import Dashboard from '../pages/app/Dashboard'
import History from '../pages/app/History'
import MapPage from '../pages/app/Map'
import Profile from '../pages/app/Profile'
import Report from '../pages/app/Report'
import Scanner from '../pages/app/Scanner'
import Treatment from '../pages/app/Treatment'
import Onboarding from '../pages/onboarding/Onboarding'
import Auth from '../pages/public/Auth'
import Landing from '../pages/public/Landing'

function LaunchScreen() {
  const navigate = useNavigate()

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      navigate('/auth', { replace: true })
    }, 1500)

    return () => window.clearTimeout(timeout)
  }, [navigate])

  return (
    <div className="pg-public-screen">
      <section className="pg-launch">
        <div className="pg-launch-orb" />
        <h1 className="pg-launch-title">PadiGuard AI</h1>
        <p className="pg-launch-subtitle">Crop intelligence in your pocket</p>
      </section>
    </div>
  )
}

function WebLaunchScreen() {
  const navigate = useNavigate()

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      navigate('/landing', { replace: true })
    }, 1300)

    return () => window.clearTimeout(timeout)
  }, [navigate])

  return (
    <div className="pg-public-screen">
      <section className="pg-launch">
        <div className="pg-launch-orb" />
        <h1 className="pg-launch-title">PadiGuard AI</h1>
        <p className="pg-launch-subtitle">Preparing website mode</p>
      </section>
    </div>
  )
}

function RootEntry() {
  const { isInstalled } = usePWA()
  const { isAuthenticated, isOnboarded } = useSessionContext()

  if (!isInstalled && isAuthenticated) {
    return <Navigate to={isOnboarded ? getLastAppPath() : '/onboarding'} replace />
  }

  return isInstalled ? <LaunchScreen /> : <WebLaunchScreen />
}

function RequireAuth({ children }) {
  const location = useLocation()
  const { isAuthenticated } = useSessionContext()

  if (!isAuthenticated) {
    setPostAuthPath(location.pathname)
  }

  return isAuthenticated ? children : <Navigate to="/auth" replace />
}

function RequireOnboarding({ children }) {
  const { isOnboarded } = useSessionContext()
  return isOnboarded ? children : <Navigate to="/onboarding" replace />
}

function RedirectAuthenticatedEntry() {
  const { isAuthenticated, isOnboarded } = useSessionContext()
  const postAuthPath = getPostAuthPath()
  const resumePath = postAuthPath && postAuthPath.startsWith('/app') ? postAuthPath : getLastAppPath()

  if (!isAuthenticated) {
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
      { path: 'scan', element: <Scanner /> },
      { path: 'report', element: <Report /> },
      { path: 'treatment', element: <Treatment /> },
      { path: 'history', element: <History /> },
      { path: 'profile', element: <Profile /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]
