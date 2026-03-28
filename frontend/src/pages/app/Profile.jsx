import { useNavigate } from 'react-router-dom'
import { useSessionContext } from '../../hooks/useSessionContext'

export default function Profile() {
  const navigate = useNavigate()
  const { logout, resetOnboarding } = useSessionContext()

  return (
    <section className="pg-page">
      <h1 className="pg-page-title">Profile</h1>
      <p className="pg-page-copy">Theme, language, and notification settings will be added next.</p>
      <article className="pg-card">
        <h2>Session Actions</h2>
        <div className="pg-cta-row">
          <button className="pg-btn pg-btn-ghost" onClick={() => {
            resetOnboarding()
            navigate('/onboarding')
          }}>
            Re-run Onboarding
          </button>
          <button className="pg-btn pg-btn-primary" onClick={() => {
            logout()
            navigate('/auth')
          }}>
            Sign Out
          </button>
        </div>
      </article>
    </section>
  )
}
