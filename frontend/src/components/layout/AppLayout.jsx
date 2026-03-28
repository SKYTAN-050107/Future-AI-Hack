import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import OfflineIndicator from '../feedback/OfflineIndicator'
import { useOffline } from '../../hooks/useOffline'
import { clearPostAuthPath, setLastAppPath } from '../../utils/navigationState'

const tabs = [
  { to: '/app', label: 'Home', icon: 'HM' },
  { to: '/app/map', label: 'Map', icon: 'MP' },
  { to: '/app/scan', label: 'Scanner', icon: 'SC' },
  { to: '/app/history', label: 'History', icon: 'HS' },
  { to: '/app/profile', label: 'Profile', icon: 'PF' },
]

function getPathRank(pathname) {
  const tabIndex = tabs.findIndex((tab) => tab.to === pathname)
  if (tabIndex >= 0) {
    return tabIndex
  }

  if (pathname.startsWith('/app/report')) {
    return 2
  }

  if (pathname.startsWith('/app/treatment')) {
    return 3
  }

  return 0
}

export default function AppLayout() {
  const { isOnline } = useOffline()
  const location = useLocation()
  const [direction, setDirection] = useState('forward')
  const previousRankRef = useRef(getPathRank(location.pathname))

  useEffect(() => {
    const nextRank = getPathRank(location.pathname)
    const prevRank = previousRankRef.current
    setDirection(nextRank < prevRank ? 'backward' : 'forward')
    previousRankRef.current = nextRank

    setLastAppPath(location.pathname)
    clearPostAuthPath()
  }, [location.pathname])

  return (
    <div className="pg-shell">
      <header className="pg-topbar">
        <div className="pg-topbar-brand">PadiGuard AI</div>
        <div className="pg-topbar-subtitle">Climate-aware rice farming assistant</div>
        <OfflineIndicator isOnline={isOnline} />
      </header>

      <main className="pg-main-content">
        <div key={location.pathname} className={`pg-route-stage dir-${direction}`}>
          <Outlet />
        </div>
      </main>

      <nav className="pg-bottom-tabs" aria-label="Primary">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => `pg-tab ${isActive ? 'is-active' : ''}`}
          >
            <span className="pg-tab-icon-chip" aria-hidden="true">{tab.icon}</span>
            <span className="pg-tab-label">{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
