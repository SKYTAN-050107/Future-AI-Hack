import SectionHeader from '../../components/ui/SectionHeader'
import TimelineList from '../../components/ui/TimelineList'
import BackButton from '../../components/navigation/BackButton'
import { useScanHistory } from '../../hooks/useScanHistory'

export default function History() {
  const { reports, timelineItems, isLoading, error } = useScanHistory()

  const firstSeverity = Number(reports[0]?.severity || 0)
  const lastSeverity = Number(reports[reports.length - 1]?.severity || 0)
  const trendDelta = reports.length > 1 ? firstSeverity - lastSeverity : 0

  return (
    <section className="pg-page">
      <SectionHeader
        title="History"
        align="center"
        leadingAction={<BackButton fallback="/app/scan" label="Back to scanner" />}
      />

      <article className="pg-card">
        <h2>Trend</h2>
        <p>
          {isLoading
            ? 'Loading scan trend...'
            : reports.length <= 1
              ? 'Capture at least two scans to view trend movement.'
              : `Problem level changed by ${Math.abs(trendDelta)}% over recent checks (${trendDelta >= 0 ? 'improving' : 'worsening'}).`}
        </p>
        {error ? <p className="pg-muted">{error}</p> : null}
      </article>

      <TimelineList items={timelineItems} />
    </section>
  )
}
