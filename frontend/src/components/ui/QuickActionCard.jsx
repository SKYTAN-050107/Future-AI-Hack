export default function QuickActionCard({ title, description, cta, onClick, urgent = false }) {
  return (
    <article className={`pg-action-card ${urgent ? 'is-urgent' : ''}`}>
      <h3>{title}</h3>
      <p>{description}</p>
      <button className="pg-btn pg-btn-ghost pg-btn-inline" onClick={onClick}>
        {cta}
      </button>
    </article>
  )
}
