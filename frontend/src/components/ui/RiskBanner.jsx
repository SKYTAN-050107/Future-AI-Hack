const levelLabels = {
  caution: 'Heads up',
  warning: 'Warning',
  info: 'Note',
}

export default function RiskBanner({ level = 'caution', title, detail }) {
  const label = levelLabels[level] ?? 'Heads up'
  return (
    <article className={`pg-risk-banner level-${level}`}>
      <div>
        <p className="pg-risk-level">{label}</p>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      <span className="pg-risk-pulse" aria-hidden="true" />
    </article>
  )
}
