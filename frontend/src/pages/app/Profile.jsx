import { useNavigate } from 'react-router-dom'
import { useSessionContext } from '../../hooks/useSessionContext'
import SectionHeader from '../../components/ui/SectionHeader'
import { IconUser, IconMap, IconSprout, IconChart } from '../../components/icons/UiIcons'

export default function Profile() {
  const navigate = useNavigate()
  const { logout, user, profile } = useSessionContext()

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Farmer'
  const email = user?.email || 'Not signed in'
  const farmName = profile?.onboarding?.farmName || 'My Farm'
  const variety = profile?.onboarding?.variety || 'Not set'
  const location = profile?.onboarding?.location || 'Not set'
  const language = profile?.onboarding?.language || 'BM'

  return (
    <section className="pg-page">
      <SectionHeader
        title="Profile"
        align="center"
      />

      <div className="pg-profile-hero">
        <div className="pg-profile-avatar" aria-hidden="true">
          <IconUser className="pg-icon" />
        </div>
        <h2 className="pg-profile-name">{displayName}</h2>
        <p className="pg-profile-email">{email}</p>
      </div>

      <article className="pg-card">
        <h2>Farm Details</h2>
        <div className="pg-profile-details">
          <div className="pg-profile-detail-row">
            <IconSprout className="pg-icon" />
            <div>
              <span className="pg-profile-detail-label">Farm Name</span>
              <span className="pg-profile-detail-value">{farmName}</span>
            </div>
          </div>
          <div className="pg-profile-detail-row">
            <IconMap className="pg-icon" />
            <div>
              <span className="pg-profile-detail-label">Location</span>
              <span className="pg-profile-detail-value">{location}</span>
            </div>
          </div>
          <div className="pg-profile-detail-row">
            <IconChart className="pg-icon" />
            <div>
              <span className="pg-profile-detail-label">Rice Variety</span>
              <span className="pg-profile-detail-value">{variety}</span>
            </div>
          </div>
          <div className="pg-profile-detail-row">
            <IconUser className="pg-icon" />
            <div>
              <span className="pg-profile-detail-label">Language</span>
              <span className="pg-profile-detail-value">{language === 'BM' ? 'Bahasa Melayu' : language}</span>
            </div>
          </div>
        </div>
      </article>

      <article className="pg-card">
        <h2>Account</h2>
        <div className="pg-cta-row">
          <button type="button" className="pg-btn pg-btn-ghost" onClick={() => {
            navigate('/onboarding', { state: { fromProfile: true } })
          }}>
            Edit farm setup
          </button>
          <button type="button" className="pg-btn pg-btn-primary" onClick={async () => {
            await logout()
            navigate('/auth', { replace: true })
          }}>
            Sign out
          </button>
        </div>
      </article>
    </section>
  )
}
