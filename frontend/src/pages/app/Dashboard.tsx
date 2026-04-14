import { useNavigate } from 'react-router-dom'
import { IconCloud, IconSun } from '../../components/icons/UiIcons'

const weatherSnapshot = {
  condition: 'Passing Rain',
  temperatureC: 29,
  windKmh: 12,
  windDirection: 'SW',
  rainInHours: 2.5,
}

const zoneHealthSummary = {
  totalAreaHectares: 38.6,
  healthy: 71,
  atRisk: 19,
  infected: 10,
  zonesNeedingAttention: 2,
}

const financialSummary = {
  roiPercent: 18.7,
  projectedRoiValueRm: 2430,
  projectedYieldGainRm: 3720,
  treatmentCostRm: 1290,
  lowStockItem: 'Nativo 75WG',
  lowStockLiters: 3.4,
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    maximumFractionDigits: 0,
  }).format(value)
}

export default function Dashboard() {
  const navigate = useNavigate()
  const safeToSpray = weatherSnapshot.rainInHours >= 4
  const WeatherIcon = safeToSpray ? IconSun : IconCloud

  return (
    <section className="pg-dashboard-page" aria-label="Financial and climate command center">
      <div className="pg-dashboard-grid">
        <button
          type="button"
          className="pg-dashboard-card pg-weather-card"
          onClick={() => navigate('/app/weather')}
          aria-label="Open 7-day weather intelligence"
        >
          <header className="pg-dashboard-card-header">
            <span className="pg-dashboard-card-title">Weather Intelligence</span>
            <WeatherIcon className="pg-icon" />
          </header>

          <div className="pg-weather-primary">
            <strong>{weatherSnapshot.temperatureC} deg C</strong>
            <span>{weatherSnapshot.condition}</span>
          </div>

          <p className="pg-weather-wind">
            Wind {weatherSnapshot.windKmh} km/h {weatherSnapshot.windDirection}
          </p>

          <span className={`pg-weather-badge ${safeToSpray ? 'is-clear' : 'is-delay'}`}>
            {safeToSpray ? 'CLEAR' : 'DELAY'}
          </span>
        </button>

        <button
          type="button"
          className="pg-dashboard-card pg-zone-card"
          onClick={() => navigate('/app/map')}
          aria-label="Open zone health map"
        >
          <header className="pg-dashboard-card-header">
            <span className="pg-dashboard-card-title">Zone Health Summary</span>
          </header>

          <p className="pg-zone-area">Total Area Scanned: {zoneHealthSummary.totalAreaHectares} ha</p>

          <div className="pg-zone-stack" role="img" aria-label="Healthy 71 percent, At-Risk 19 percent, Infected 10 percent">
            <span className="is-healthy" style={{ width: `${zoneHealthSummary.healthy}%` }} />
            <span className="is-at-risk" style={{ width: `${zoneHealthSummary.atRisk}%` }} />
            <span className="is-infected" style={{ width: `${zoneHealthSummary.infected}%` }} />
          </div>

          <div className="pg-zone-legend" aria-hidden="true">
            <span className="is-healthy">Healthy {zoneHealthSummary.healthy}%</span>
            <span className="is-at-risk">At-Risk {zoneHealthSummary.atRisk}%</span>
            <span className="is-infected">Infected {zoneHealthSummary.infected}%</span>
          </div>

          <p className="pg-zone-alert">{zoneHealthSummary.zonesNeedingAttention} Zones Require Attention</p>
        </button>

        <button
          type="button"
          className="pg-dashboard-card pg-finance-card"
          onClick={() => navigate('/app/treatment')}
          aria-label="Open treatment plan and ROI"
        >
          <header className="pg-dashboard-card-header">
            <span className="pg-dashboard-card-title">Financial Command Center</span>
          </header>

          <div className="pg-finance-hero">
            <p className="pg-finance-kicker">Projected ROI</p>
            <h2>{formatCurrency(financialSummary.projectedRoiValueRm)}</h2>
            <p className="pg-finance-percent">+{financialSummary.roiPercent}% this cycle</p>
          </div>

          <div className="pg-finance-breakdown" aria-label="Cost versus benefit">
            <div>
              <span>Potential Yield Gain</span>
              <strong>{formatCurrency(financialSummary.projectedYieldGainRm)}</strong>
            </div>
            <div>
              <span>Treatment Cost</span>
              <strong>{formatCurrency(financialSummary.treatmentCostRm)}</strong>
            </div>
          </div>

          {financialSummary.lowStockLiters < 5 ? (
            <p className="pg-finance-alert">
              Low stock alert: {financialSummary.lowStockItem} only {financialSummary.lowStockLiters.toFixed(1)}L left.
            </p>
          ) : null}

          <span className="pg-finance-cta">View Treatment Plan</span>
        </button>
      </div>
    </section>
  )
}
