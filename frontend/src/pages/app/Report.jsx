import SectionHeader from '../../components/ui/SectionHeader'
import MetricTile from '../../components/ui/MetricTile'

export default function Report() {
  return (
    <section className="pg-page">
      <SectionHeader
        eyebrow="Diagnosis"
        title="Scan Report"
        subtitle="Plain-language disease output with severity and spread risk."
      />

      <article className="pg-severity-card">
        <h2>Blast Disease Detected</h2>
        <p>Moderate severity in Zone C. Early intervention recommended within 24 hours.</p>
        <div className="pg-severity-meter" role="img" aria-label="Severity 64 percent">
          <span style={{ width: '64%' }} />
        </div>
      </article>

      <div className="pg-tile-grid">
        <MetricTile label="Severity" value="64%" tone="danger" helper="Moderate" />
        <MetricTile label="Spread Risk" value="High" tone="danger" helper="Wind + humidity" />
        <MetricTile label="Confidence" value="92%" helper="Gemini classification" />
      </div>

      <article className="pg-card">
        <h2>Next Best Action</h2>
        <p>Open treatment plan to compare fungicide dosage options and ROI before application.</p>
      </article>
    </section>
  )
}
