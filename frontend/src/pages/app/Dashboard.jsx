import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconCloud, IconSun } from '../../components/icons/UiIcons'
import SectionHeader from '../../components/ui/SectionHeader'
import { getDashboardSummary } from '../../api/dashboard'
import { useSessionContext } from '../../hooks/useSessionContext'
import { useGrids } from '../../hooks/useGrids'
import { useScanHistory } from '../../hooks/useScanHistory'

function safeNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function deriveSurvivalProbability(report) {
  const explicitValue = Number(report?.survivalProb ?? report?.survival_prob)
  if (Number.isFinite(explicitValue)) {
    return Math.max(0, Math.min(1, explicitValue))
  }

  const severity = Number(report?.severity)
  if (!Number.isFinite(severity)) {
    return null
  }

  const inferred = 1 - (severity / 100)
  return Math.max(0.05, Math.min(0.95, inferred))
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    maximumFractionDigits: 0,
  }).format(safeNumber(value))
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, profile } = useSessionContext()
  const { grids } = useGrids()
  const { latestReport } = useScanHistory()
  const [summary, setSummary] = useState(null)
  const [loadError, setLoadError] = useState('')

  const firstGridWithCentroid = useMemo(
    () => grids.find((grid) => Number.isFinite(grid?.centroid?.lat) && Number.isFinite(grid?.centroid?.lng)),
    [grids],
  )

  const totalAreaHectares = useMemo(
    () => grids.reduce((sum, grid) => {
      const area = Number(grid?.areaHectares)
      return Number.isFinite(area) ? sum + area : sum
    }, 0),
    [grids],
  )

  const requestBuild = useMemo(() => {
    const userId = String(user?.uid || '').trim()
    if (!userId) {
      return { payload: null, error: 'Sign in to load dashboard summary.' }
    }

    if (!latestReport) {
      return { payload: null, error: 'No scan report available yet for summary insights.' }
    }

    const cropType = String(latestReport?.cropType || latestReport?.crop_type || profile?.onboarding?.variety || '').trim()
    const treatmentPlan = String(latestReport?.treatmentPlan || latestReport?.treatment_plan || '').trim()
    const survivalProb = deriveSurvivalProbability(latestReport)

    if (!cropType) {
      return { payload: null, error: 'Latest scan is missing crop type data for dashboard projection.' }
    }

    if (!treatmentPlan) {
      return { payload: null, error: 'Latest scan is missing treatment plan data for dashboard projection.' }
    }

    if (!Number.isFinite(totalAreaHectares) || totalAreaHectares <= 0) {
      return { payload: null, error: 'Farm area is required. Draw at least one grid to load dashboard summary.' }
    }

    if (survivalProb === null) {
      return { payload: null, error: 'Latest scan severity is required for dashboard projection.' }
    }

    return {
      payload: {
        userId,
        cropType,
        treatmentPlan,
        farmSizeHectares: totalAreaHectares,
        survivalProb,
        lat: firstGridWithCentroid?.centroid?.lat,
        lng: firstGridWithCentroid?.centroid?.lng,
      },
      error: '',
    }
  }, [firstGridWithCentroid?.centroid?.lat, firstGridWithCentroid?.centroid?.lng, latestReport, profile?.onboarding?.variety, totalAreaHectares, user?.uid])

  useEffect(() => {
    let active = true

    if (!requestBuild.payload) {
      setSummary(null)
      setLoadError(requestBuild.error)
      return undefined
    }

    setLoadError('')

    getDashboardSummary(requestBuild.payload)
      .then((response) => {
        if (!active) {
          return
        }
        setSummary(response)
      })
      .catch((error) => {
        if (!active) {
          return
        }
        setSummary(null)
        setLoadError(error?.message || 'Unable to load dashboard summary')
      })

    return () => {
      active = false
    }
  }, [requestBuild.error, requestBuild.payload])

  const weatherSnapshot = summary?.weatherSnapshot || {
    condition: 'Unavailable',
    temperatureC: 0,
    windKmh: 0,
    windDirection: '-',
    rainInHours: null,
  }

  const zoneHealthSummary = summary?.zoneHealthSummary || {
    totalAreaHectares: 0,
    healthy: 0,
    atRisk: 0,
    infected: 0,
    zonesNeedingAttention: 0,
  }

  const financialSummary = summary?.financialSummary || {
    roiPercent: 0,
    projectedRoiValueRm: 0,
    projectedYieldGainRm: 0,
    treatmentCostRm: 0,
    lowStockItem: null,
    lowStockLiters: null,
  }

  const rainInHours = safeNumber(weatherSnapshot.rainInHours, -1)
  const safeToSpray = rainInHours < 0 || rainInHours >= 4
  const WeatherIcon = safeToSpray ? IconSun : IconCloud

  return (
    <section className="pg-page pg-dashboard-page" aria-label="Financial and climate command center">
      <SectionHeader title="Home" align="center" />
      {loadError ? (
        <article className="pg-card">
          <p>{loadError}</p>
        </article>
      ) : null}
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
            <strong>{safeNumber(weatherSnapshot.temperatureC)} deg C</strong>
            <span>{weatherSnapshot.condition}</span>
          </div>

          <p className="pg-weather-wind">
            Wind {safeNumber(weatherSnapshot.windKmh)} km/h {weatherSnapshot.windDirection}
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

          <p className="pg-zone-area">Total Area Scanned: {safeNumber(zoneHealthSummary.totalAreaHectares).toFixed(1)} ha</p>

          <div className="pg-zone-stack" role="img" aria-label="Healthy 71 percent, At-Risk 19 percent, Infected 10 percent">
            <span className="is-healthy" style={{ width: `${safeNumber(zoneHealthSummary.healthy)}%` }} />
            <span className="is-at-risk" style={{ width: `${safeNumber(zoneHealthSummary.atRisk)}%` }} />
            <span className="is-infected" style={{ width: `${safeNumber(zoneHealthSummary.infected)}%` }} />
          </div>

          <div className="pg-zone-legend" aria-hidden="true">
            <span className="is-healthy">Healthy {safeNumber(zoneHealthSummary.healthy)}%</span>
            <span className="is-at-risk">At-Risk {safeNumber(zoneHealthSummary.atRisk)}%</span>
            <span className="is-infected">Infected {safeNumber(zoneHealthSummary.infected)}%</span>
          </div>

          <p className="pg-zone-alert">{safeNumber(zoneHealthSummary.zonesNeedingAttention)} Zones Require Attention</p>
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
            <p className="pg-finance-percent">+{safeNumber(financialSummary.roiPercent)}% this cycle</p>
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

          {safeNumber(financialSummary.lowStockLiters, 999) < 5 ? (
            <p className="pg-finance-alert">
              Low stock alert: {financialSummary.lowStockItem || 'Item'} only {safeNumber(financialSummary.lowStockLiters).toFixed(1)}L left.
            </p>
          ) : null}

          <span className="pg-finance-cta">View Treatment Plan</span>
        </button>
      </div>
    </section>
  )
}
