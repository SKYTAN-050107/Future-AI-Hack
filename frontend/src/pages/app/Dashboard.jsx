import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import SectionHeader from '../../components/ui/SectionHeader'
import MetricTile from '../../components/ui/MetricTile'
import RiskBanner from '../../components/ui/RiskBanner'
import QuickActionCard from '../../components/ui/QuickActionCard'
import SkeletonBlock from '../../components/feedback/SkeletonBlock'
import { getWeatherOutlook } from '../../api/weather'
import { useScanHistory } from '../../hooks/useScanHistory'

export default function Dashboard() {
  const navigate = useNavigate()
  const [weather, setWeather] = useState(null)
  const { latestReport } = useScanHistory()

  const problemLabel = latestReport?.disease || 'No recent scan'
  const problemHelper = latestReport
    ? `${latestReport.gridId || latestReport.zone || 'Unlinked zone'} · ${Number(latestReport.severity || 0)}%`
    : 'Run scanner to update'

  useEffect(() => {
    let active = true

    getWeatherOutlook().then((response) => {
      if (active) {
        setWeather(response)
      }
    })

    return () => {
      active = false
    }
  }, [])

  return (
    <section className="pg-page">
      <SectionHeader
        title="Home"
        align="center"
      />

      <RiskBanner
        level="caution"
        title={weather ? `Rain may affect spraying (${weather.rain_probability}% chance)` : 'Checking weather…'}
        detail={weather ? weather.advisory : 'Getting the latest forecast for spray timing.'}
      />

      {!weather ? (
        <article className="pg-card pg-skeleton-card">
          <SkeletonBlock width="46%" height={13} />
          <SkeletonBlock width="100%" height={11} />
          <SkeletonBlock width="80%" height={11} />
        </article>
      ) : null}

      <div className="pg-tile-grid">
        <MetricTile label="Zones OK" value="84%" helper="17 of 20 areas" />
        <MetricTile label="Problem" value={problemLabel} tone="danger" helper={problemHelper} />
        <MetricTile
          label="Spray window"
          value={weather ? 'OK' : '…'}
          helper={weather ? weather.best_spray_window : 'From weather'}
        />
      </div>

      <div className="pg-grid pg-grid-actions">
        <QuickActionCard
          title="Check leaves"
          description="Take a photo to see if disease is present and how strong it looks."
          cta="Start leaf check"
          primaryCta
          onClick={() => navigate('/app/scan')}
        />
        <QuickActionCard
          title="Spray plan & cost"
          description="See suggested spray, cost, and return before you buy."
          cta="Open plan"
          onClick={() => navigate('/app/treatment')}
        />
        <QuickActionCard
          title="Rain & spray timing"
          description="Heavy rain may come soon. See what it means for your next spray."
          cta="Read summary"
          urgent
          onClick={() => navigate('/app/report')}
        />
      </div>
    </section>
  )
}
