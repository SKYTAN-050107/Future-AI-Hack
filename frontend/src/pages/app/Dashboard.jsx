import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import SectionHeader from '../../components/ui/SectionHeader'
import MetricTile from '../../components/ui/MetricTile'
import RiskBanner from '../../components/ui/RiskBanner'
import QuickActionCard from '../../components/ui/QuickActionCard'
import SkeletonBlock from '../../components/feedback/SkeletonBlock'
import { getWeatherOutlook } from '../../api/weather'

export default function Dashboard() {
  const navigate = useNavigate()
  const [weather, setWeather] = useState(null)

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
        eyebrow="Today"
        title="Farm Overview"
        subtitle="See health summary, weather timing, and next recommended action first."
      />

      <RiskBanner
        level="caution"
        title={weather ? `Spraying risk in 18 hours (${weather.rain_probability}%)` : 'Loading weather advisory...'}
        detail={weather ? weather.advisory : 'Checking latest weather model for spray timing guidance.'}
      />

      {!weather ? (
        <article className="pg-card pg-skeleton-card">
          <SkeletonBlock width="46%" height={13} />
          <SkeletonBlock width="100%" height={11} />
          <SkeletonBlock width="80%" height={11} />
        </article>
      ) : null}

      <div className="pg-tile-grid">
        <MetricTile label="Healthy Zones" value="84%" helper="17 of 20 sectors" />
        <MetricTile label="Active Threat" value="Leaf Blast" tone="danger" helper="Zone C and D" />
        <MetricTile
          label="Spray Window"
          value={weather ? 'Ready' : 'Loading'}
          helper={weather ? weather.best_spray_window : 'Computing from weather feed'}
        />
      </div>

      <div className="pg-grid pg-grid-actions">
        <QuickActionCard
          title="Open Scanner"
          description="Capture padi leaf image and receive disease severity in under 5 seconds."
          cta="Start Scan"
          onClick={() => navigate('/app/scan')}
        />
        <QuickActionCard
          title="View Treatment ROI"
          description="Compare treatment cost with expected yield recovery before spending."
          cta="Review Plan"
          onClick={() => navigate('/app/treatment')}
        />
        <QuickActionCard
          title="Weather Timing Alert"
          description="Strong rain cells detected tomorrow. Move spray schedule earlier."
          cta="See Priority"
          urgent
          onClick={() => navigate('/app/report')}
        />
      </div>
    </section>
  )
}
