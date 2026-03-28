export default function RiskBanner({ level = 'caution', title, detail }) {
  return (
    <article className={`pg-risk-banner level-${level}`}>
      <div>
        <p className="pg-risk-level">{level.toUpperCase()}</p>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      <span className="pg-risk-pulse" aria-hidden="true" />
    </article>
  )
}
