import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { IconCamera, IconClipboard, IconHome, IconMap, IconUser } from './icons/UiIcons'

const navItems = [
  { type: 'tab', to: '/app', label: 'Home', Icon: IconHome, end: true },
  { type: 'tab', to: '/app/map', label: 'Map', Icon: IconMap },
  { type: 'gap' },
  { type: 'tab', to: '/app/inventory', label: 'Inventory', Icon: IconClipboard },
  { type: 'tab', to: '/app/profile', label: 'Profile', Icon: IconUser },
]

export default function BottomNav() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <nav className="pg-bottom-nav" aria-label="Primary">
      <div className="pg-bottom-nav-grid">
        {navItems.map((item, index) => {
          if (item.type === 'gap') {
            return <span key={`gap-${index}`} className="pg-bottom-nav-gap" aria-hidden="true" />
          }

          const TabIcon = item.Icon

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `pg-bottom-nav-tab ${isActive ? 'is-active' : ''}`}
              aria-current={location.pathname === item.to ? 'page' : undefined}
            >
              <span className="pg-bottom-nav-icon-wrap" aria-hidden="true">
                <TabIcon className="pg-icon" />
              </span>
              <span className="pg-bottom-nav-label">{item.label}</span>
            </NavLink>
          )
        })}

        <button
          type="button"
          className="pg-scan-fab"
          onClick={() => navigate('/app/scan')}
          aria-label="Open scanner"
        >
          <IconCamera className="pg-icon" />
        </button>
      </div>
    </nav>
  )
}
