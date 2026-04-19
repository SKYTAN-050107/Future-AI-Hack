import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { clearPostAuthPath, setLastAppPath } from '../../utils/navigationState'
import BottomNav from '../BottomNav'
import ThemeToggle from '../ui/ThemeToggle'
import NotificationMenu from '../ui/NotificationMenu'

function getPathRank(pathname) {
  if (pathname === '/app') {
    return 0
  }

  if (pathname.startsWith('/app/map') || pathname.startsWith('/app/weather')) {
    return 1
  }

  if (
    pathname.startsWith('/app/scan')
    || pathname.startsWith('/app/report')
    || pathname.startsWith('/app/history')
    || pathname.startsWith('/app/chatbot')
  ) {
    return 2
  }

  if (pathname.startsWith('/app/inventory') || pathname.startsWith('/app/treatment') || pathname.startsWith('/app/crops')) {
    return 3
  }

  if (pathname.startsWith('/app/profile')) {
    return 4
  }

  return 0
}

export default function AppLayout() {
  const location = useLocation()
  const [direction, setDirection] = useState('forward')
  const previousRankRef = useRef(getPathRank(location.pathname))
  const isScannerRoute = location.pathname.startsWith('/app/scan')
  const isChatbotRoute = location.pathname.startsWith('/app/chatbot')
  const showTopActions = !isScannerRoute && !isChatbotRoute

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
      {showTopActions ? (
        <div className="pg-top-actions">
          <ThemeToggle />
          <NotificationMenu />
        </div>
      ) : null}
      <main className={`pg-main-content ${isScannerRoute ? 'pg-main-content-scanner' : ''}`}>
        <div
          key={location.pathname}
          className={`pg-route-stage dir-${direction} ${isScannerRoute ? 'pg-route-stage-static' : ''}`}
        >
          <Outlet />
        </div>
      </main>

      {!isScannerRoute ? <BottomNav /> : null}
    </div>
  )
}
