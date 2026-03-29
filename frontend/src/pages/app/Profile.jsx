import { useNavigate } from 'react-router-dom'
import { useSessionContext } from '../../hooks/useSessionContext'
import SectionHeader from '../../components/ui/SectionHeader'

export default function Profile() {
  const navigate = useNavigate()
  const { logout } = useSessionContext()

  return (
    <section className="pg-page">
      <SectionHeader
        title="My Profile"
        align="center"
      />
      <article className="pg-card">
        <h2>Account</h2>
        <div className="pg-cta-row">
          <button type="button" className="pg-btn pg-btn-ghost" onClick={() => {
            navigate('/onboarding', { state: { fromProfile: true } })
          }}>
            Edit farm setup
          </button>
          <button type="button" className="pg-btn pg-btn-primary" onClick={() => {
            logout()
            navigate('/auth')
          }}>
            Sign out
          </button>
        </div>
      </article>
    </section>
  )
}
