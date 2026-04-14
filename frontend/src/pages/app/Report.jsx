import SectionHeader from '../../components/ui/SectionHeader'
import MetricTile from '../../components/ui/MetricTile'
import BackButton from '../../components/navigation/BackButton'
import { useScanHistory } from '../../hooks/useScanHistory'

function severityTone(value) {
  if (value >= 60) {
    return 'danger'
  }

  if (value >= 30) {
    return 'warning'
  }

  return 'default'
}

function severityLabel(value) {
  if (value >= 70) {
    return 'High'
  }

  if (value >= 40) {
    return 'Medium'
  }

  return 'Low'
}

export default function Report() {
  const { latestReport } = useScanHistory()
  const severity = Number(latestReport?.severity || 0)
  const confidence = Number(latestReport?.confidence || 0)
  const disease = latestReport?.disease || 'No recent scan'
  const spreadRisk = latestReport?.spreadRisk || latestReport?.spread_risk || 'Unknown'
  const zone = latestReport?.gridId || latestReport?.zone || 'Unlinked zone'

  return (
    <section className="pg-page">
      <SectionHeader
        title="Report"
        align="left"
        leadingAction={<BackButton fallback="/app/scan" label="Back to scanner" />}
      />

      <article className="pg-severity-card">
        <h2>{disease}</h2>
        <p>{severityLabel(severity)} level in {zone}. Acting within 24 hours usually helps.</p>
        <div className="pg-severity-meter" role="img" aria-label={`Problem level ${severity} percent`}>
          <span style={{ width: `${severity}%` }} />
        </div>
      </article>

      <div className="pg-tile-grid">
        <MetricTile
          label="Problem level"
          value={`${severity}%`}
          tone={severityTone(severity)}
          helper={severityLabel(severity)}
        />
        <MetricTile label="Spread risk" value={spreadRisk} tone="danger" helper="Wind & damp air" />
        <MetricTile label="How sure" value={`${confidence}%`} helper="Read quality" />
      </div>

      <article className="pg-card">
        <h2>What to do next</h2>
        <p>Open the spray plan to compare cost and amount before you buy and apply.</p>
      </article>
    </section>
  )
}
