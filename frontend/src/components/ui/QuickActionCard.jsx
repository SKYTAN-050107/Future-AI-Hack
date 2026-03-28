export default function QuickActionCard({ title, description, cta, onClick, urgent = false, primaryCta = false }) {
  return (
    <article className={`pg-action-card ${urgent ? 'is-urgent' : ''}`}>
      <h3>{title}</h3>
      <p>{description}</p>
      <button
        type="button"
        className={`pg-btn pg-btn-inline ${primaryCta ? 'pg-btn-primary' : 'pg-btn-ghost'}`}
        onClick={onClick}
      >
        {cta}
      </button>
    </article>
  )
}
