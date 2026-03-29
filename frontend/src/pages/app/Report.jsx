import SectionHeader from '../../components/ui/SectionHeader'
import MetricTile from '../../components/ui/MetricTile'
import BackButton from '../../components/navigation/BackButton'

export default function Report() {
  return (
    <section className="pg-page">
      <SectionHeader
        eyebrow="Report"
        title="What the scan shows"
        subtitle="Problem level, spread risk, and how sure the read is."
        leadingAction={<BackButton fallback="/app/scan" label="Back to scanner" />}
      />

      <article className="pg-severity-card">
        <h2>Leaf blast found</h2>
        <p>Medium level in Zone C. Acting within 24 hours usually helps.</p>
        <div className="pg-severity-meter" role="img" aria-label="Problem level 64 percent">
          <span style={{ width: '64%' }} />
        </div>
      </article>

      <div className="pg-tile-grid">
        <MetricTile label="Problem level" value="64%" tone="danger" helper="Medium" />
        <MetricTile label="Spread risk" value="High" tone="danger" helper="Wind & damp air" />
        <MetricTile label="How sure" value="92%" helper="Read quality" />
      </div>

      <article className="pg-card">
        <h2>What to do next</h2>
        <p>Open the spray plan to compare cost and amount before you buy and apply.</p>
      </article>
    </section>
  )
}
