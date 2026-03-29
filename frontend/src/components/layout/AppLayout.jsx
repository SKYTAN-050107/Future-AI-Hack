import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { clearPostAuthPath, setLastAppPath } from '../../utils/navigationState'
import { IconHome, IconMap, IconAgent, IconList, IconUser } from '../icons/UiIcons'

const tabs = [
  { to: '/app', label: 'Home', Icon: IconHome },
  { to: '/app/map', label: 'Map', Icon: IconMap },
  { to: '/app/scan', label: 'Chat', Icon: IconAgent },
  { to: '/app/history', label: 'History', Icon: IconList },
  { to: '/app/profile', label: 'Profile', Icon: IconUser },
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
  const location = useLocation()
  const [direction, setDirection] = useState('forward')
  const previousRankRef = useRef(getPathRank(location.pathname))
  const isScannerRoute = location.pathname.startsWith('/app/scan')

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
      <main className={`pg-main-content ${isScannerRoute ? 'pg-main-content-chat' : ''}`}>
        <div
          key={location.pathname}
          className={`pg-route-stage dir-${direction} ${isScannerRoute ? 'pg-route-stage-static' : ''}`}
        >
          <Outlet />
        </div>
      </main>

      <nav className="pg-bottom-tabs" aria-label="Primary">
        {tabs.map((tab) => {
          const TabIcon = tab.Icon
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) => `pg-tab ${isActive ? 'is-active' : ''}`}
            >
              <span className="pg-tab-icon-wrap" aria-hidden="true">
                <TabIcon className="pg-icon" />
              </span>
              <span className="pg-tab-label">{tab.label}</span>
            </NavLink>
          )
        })}
      </nav>
    </div>
  )
}
