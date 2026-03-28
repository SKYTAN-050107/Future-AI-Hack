export default function MetricTile({ label, value, tone = 'normal', helper }) {
  return (
    <article className={`pg-tile pg-tile-${tone}`}>
      <p className="pg-tile-label">{label}</p>
      <p className="pg-tile-value">{value}</p>
      {helper ? <p className="pg-tile-helper">{helper}</p> : null}
    </article>
  )
}
