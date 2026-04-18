import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconCloud, IconSun } from '../../components/icons/UiIcons'
import SectionHeader from '../../components/ui/SectionHeader'
import { sendAssistantMessage } from '../../api/assistant'
import { getCrops } from '../../api/crops'
import { getDashboardSummary } from '../../api/dashboard'
import { getWeatherOutlook } from '../../api/weather'
import { useSessionContext } from '../../hooks/useSessionContext'
import { useGrids } from '../../hooks/useGrids'
import { useScanHistory } from '../../hooks/useScanHistory'
import { useFarmLocationCoordinates } from '../../hooks/useFarmLocationCoordinates'

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

function buildZoneHealthSummaryFromGrids(grids) {
  const safeGrids = Array.isArray(grids) ? grids : []
  if (safeGrids.length === 0) {
    return {
      totalAreaHectares: 0,
      healthy: 0,
      atRisk: 0,
      infected: 0,
      zonesNeedingAttention: 0,
    }
  }

  const totalAreaHectares = safeGrids.reduce((sum, grid) => {
    const area = Number(grid?.areaHectares)
    return Number.isFinite(area) && area > 0 ? sum + area : sum
  }, 0)

  const useAreaWeights = totalAreaHectares > 0
  let healthyWeight = 0
  let atRiskWeight = 0
  let infectedWeight = 0
  let zonesNeedingAttention = 0

  safeGrids.forEach((grid) => {
    const area = Number(grid?.areaHectares)
    const weight = useAreaWeights ? (Number.isFinite(area) && area > 0 ? area : 0) : 1
    const state = String(grid?.healthState || grid?.healthStatus || 'Healthy').trim().toLowerCase()

    if (state === 'infected') {
      infectedWeight += weight
      zonesNeedingAttention += 1
      return
    }

    if (state === 'at-risk' || state === 'at_risk' || state === 'risk' || state === 'warning') {
      atRiskWeight += weight
      zonesNeedingAttention += 1
      return
    }

    healthyWeight += weight
  })

  const denominator = useAreaWeights
    ? totalAreaHectares
    : safeGrids.length

  if (denominator <= 0) {
    return {
      totalAreaHectares,
      healthy: 0,
      atRisk: 0,
      infected: 0,
      zonesNeedingAttention,
    }
  }

  const healthy = Math.max(0, Math.min(100, Math.round((healthyWeight / denominator) * 100)))
  const atRisk = Math.max(0, Math.min(100, Math.round((atRiskWeight / denominator) * 100)))
  const infected = Math.max(0, 100 - healthy - atRisk)

  return {
    totalAreaHectares,
    healthy,
    atRisk,
    infected,
    zonesNeedingAttention,
  }
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, profile } = useSessionContext()
  const { grids } = useGrids()
  const { latestReport } = useScanHistory()
  const [summary, setSummary] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [weatherData, setWeatherData] = useState(null)
  const [weatherError, setWeatherError] = useState('')
  const [isWeatherLoading, setIsWeatherLoading] = useState(false)
  const [selectedZoneName, setSelectedZoneName] = useState('')
  const [zoneQuickReview, setZoneQuickReview] = useState('')
  const [zoneQuickReviewError, setZoneQuickReviewError] = useState('')
  const [isZoneQuickReviewLoading, setIsZoneQuickReviewLoading] = useState(false)
  const [cropCount, setCropCount] = useState(0)
  const [isCropLoading, setIsCropLoading] = useState(false)

  const firstGridWithCentroid = useMemo(
    () => grids.find((grid) => Number.isFinite(grid?.centroid?.lat) && Number.isFinite(grid?.centroid?.lng)),
    [grids],
  )

  const farmLocation = String(profile?.onboarding?.location || '').trim()
  const { coordinates, locationResolutionError } = useFarmLocationCoordinates({
    locationText: farmLocation,
    savedLat: profile?.onboarding?.locationLat,
    savedLng: profile?.onboarding?.locationLng,
    gridLat: firstGridWithCentroid?.centroid?.lat,
    gridLng: firstGridWithCentroid?.centroid?.lng,
  })

  const lat = Number(coordinates?.lat)
  const lng = Number(coordinates?.lng)
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)

  const totalAreaHectares = useMemo(
    () => grids.reduce((sum, grid) => {
      const area = Number(grid?.areaHectares)
      return Number.isFinite(area) ? sum + area : sum
    }, 0),
    [grids],
  )

  const zoneHealthSummary = useMemo(
    () => buildZoneHealthSummaryFromGrids(grids),
    [grids],
  )

  const zoneOptions = useMemo(() => {
    const seen = new Set()
    const options = []

    grids.forEach((grid) => {
      const name = String(grid?.gridId || grid?.id || '').trim()
      if (!name || seen.has(name)) {
        return
      }

      seen.add(name)
      options.push(name)
    })

    return options
  }, [grids])

  const requestBuild = useMemo(() => {
    const userId = String(user?.uid || '').trim()
    if (!userId) {
      return { payload: null, error: 'Sign in to load dashboard summary.' }
    }

    const cropType = String(
      latestReport?.cropType
      || latestReport?.crop_type
      || profile?.onboarding?.variety
      || 'Mixed crop',
    ).trim() || 'Mixed crop'
    const treatmentPlan = String(
      latestReport?.treatmentPlan
      || latestReport?.treatment_plan
      || 'recommended treatment',
    ).trim() || 'recommended treatment'
    const survivalProb = deriveSurvivalProbability(latestReport)
    const farmSizeHectares = Number.isFinite(totalAreaHectares) && totalAreaHectares > 0
      ? totalAreaHectares
      : 1

    if (!hasCoords) {
      if (locationResolutionError) {
        return { payload: null, error: locationResolutionError }
      }

      if (farmLocation) {
        return { payload: null, error: 'Resolving your saved farm location...' }
      }

      return { payload: null, error: 'Set your farm location in Settings or draw a farm grid to load dashboard summary.' }
    }

    return {
      payload: {
        userId,
        cropType,
        treatmentPlan,
        farmSizeHectares,
        survivalProb: survivalProb ?? 1,
        lat,
        lng,
      },
      error: '',
    }
  }, [farmLocation, hasCoords, lat, lng, latestReport, locationResolutionError, profile?.onboarding?.variety, totalAreaHectares, user?.uid])

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

  useEffect(() => {
    let active = true
    const userId = String(user?.uid || '').trim()

    if (!userId) {
      setWeatherData(null)
      setWeatherError('Sign in to load weather outlook.')
      setIsWeatherLoading(false)
      return undefined
    }

    if (!hasCoords) {
      setWeatherData(null)
      if (locationResolutionError) {
        setWeatherError(locationResolutionError)
      } else if (!farmLocation) {
        setWeatherError('Set your farm location in Settings or add a farm grid centroid to load weather outlook.')
      } else {
        setWeatherError('')
      }
      setIsWeatherLoading(false)
      return undefined
    }

    setIsWeatherLoading(true)
    setWeatherError('')

    getWeatherOutlook({ lat, lng, days: 1 })
      .then((response) => {
        if (!active) {
          return
        }

        setWeatherData(response)
      })
      .catch((error) => {
        if (!active) {
          return
        }

        setWeatherData(null)
        setWeatherError(error?.message || 'Unable to load weather outlook')
      })
      .finally(() => {
        if (active) {
          setIsWeatherLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [farmLocation, hasCoords, lat, lng, locationResolutionError, user?.uid])

  useEffect(() => {
    if (zoneOptions.length === 0) {
      setSelectedZoneName('')
      return
    }

    setSelectedZoneName((current) => (
      zoneOptions.includes(current) ? current : zoneOptions[0]
    ))
  }, [zoneOptions])

  useEffect(() => {
    let active = true
    const userId = String(user?.uid || '').trim()

    if (!userId) {
      setCropCount(0)
      setIsCropLoading(false)
      return undefined
    }

    setIsCropLoading(true)
    getCrops({ userId })
      .then((response) => {
        if (!active) {
          return
        }

        const count = Array.isArray(response?.items) ? response.items.length : 0
        setCropCount(count)
      })
      .catch(() => {
        if (active) {
          setCropCount(0)
        }
      })
      .finally(() => {
        if (active) {
          setIsCropLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [user?.uid])

  useEffect(() => {
    const userId = String(user?.uid || '').trim()
    if (!selectedZoneName || !userId) {
      setZoneQuickReview('')
      setZoneQuickReviewError('')
      setIsZoneQuickReviewLoading(false)
      return
    }

    let active = true
    setIsZoneQuickReviewLoading(true)
    setZoneQuickReview('')
    setZoneQuickReviewError('')

    sendAssistantMessage({
      userPrompt: '[ZONE_REVIEW] Provide one very short quick review for this zone in one sentence.',
      userId,
      zone: selectedZoneName,
      location: farmLocation,
      lat,
      lng,
    })
      .then((response) => {
        if (!active) {
          return
        }
        setZoneQuickReview(String(response?.assistant_reply || '').trim())
      })
      .catch((error) => {
        if (!active) {
          return
        }
        setZoneQuickReviewError(error?.message || 'Unable to generate quick zone review.')
      })
      .finally(() => {
        if (active) {
          setIsZoneQuickReviewLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [selectedZoneName, user?.uid])

  const weatherSnapshot = weatherData || {}
  const financialSummary = summary?.financialSummary || {}
  const weatherServiceWarning = String(weatherSnapshot.serviceWarning || '').trim()

  const hourlyForecast6h = useMemo(() => {
    const firstDay = Array.isArray(weatherSnapshot?.forecast)
      ? weatherSnapshot.forecast[0]
      : null

    const hourly = Array.isArray(firstDay?.hourly)
      ? firstDay.hourly
      : []

    return hourly.slice(0, 6)
  }, [weatherSnapshot])

  if (!summary && !loadError) {
    return (
      <section className="pg-page pg-dashboard-page" aria-label="Financial and climate command center">
        <SectionHeader title="Home" align="center" />
        <article className="pg-card">
          <p>Loading dashboard summary...</p>
        </article>
      </section>
    )
  }

  const rainInHours = safeNumber(weatherSnapshot.rainInHours, -1)
  const safeToSpray = typeof weatherSnapshot?.safeToSpray === 'boolean'
    ? weatherSnapshot.safeToSpray
    : rainInHours < 0 || rainInHours >= 4
  const WeatherIcon = safeToSpray ? IconSun : IconCloud

  return (
    <section className="pg-page pg-dashboard-page" aria-label="Financial and climate command center">
      <SectionHeader title="Home" align="center" />

      {loadError ? (
        <article className="pg-card">
          <p>{loadError}</p>
        </article>
      ) : null}

      {!isCropLoading && cropCount === 0 ? (
        <article className="pg-card" style={{ marginBottom: 16 }}>
          <h2>Add your first crop</h2>
          <p>Farm setup is complete. Add a crop profile now to unlock crop-level ROI and inventory planning.</p>
          <button type="button" className="pg-btn pg-btn-primary" onClick={() => navigate('/app/crops')}>
            Manage Crops
          </button>
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
            <span>{weatherSnapshot.condition || 'N/A'}</span>
          </div>

          <p className="pg-weather-wind">
            Wind {safeNumber(weatherSnapshot.windKmh)} km/h {weatherSnapshot.windDirection || '-'}
          </p>

          {weatherServiceWarning ? (
            <p style={{ marginTop: 8, fontSize: 12, lineHeight: 1.4, color: 'var(--pg-warning, #ffb454)' }}>
              {weatherServiceWarning}
            </p>
          ) : null}

          <div style={{ marginTop: 8 }}>
            <small style={{ opacity: 0.85, display: 'block', marginBottom: 6 }}>Next 6h</small>
            {isWeatherLoading ? (
              <small>Loading 6-hour forecast...</small>
            ) : weatherError ? (
              <small>{weatherError}</small>
            ) : hourlyForecast6h.length === 0 ? (
              <small>No hourly forecast available.</small>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 6,
                }}
              >
                {hourlyForecast6h.map((slot, index) => (
                  <div
                    key={`${slot.time || 'slot'}-${index}`}
                    style={{
                      border: '1px solid rgba(255,255,255,0.2)',
                      borderRadius: 10,
                      padding: '6px 8px',
                      fontSize: 11,
                      lineHeight: 1.2,
                    }}
                  >
                    <strong style={{ display: 'block' }}>{slot.time || '--'}</strong>
                    <span>{safeNumber(slot.temperature_c)} deg C</span>
                    <br />
                    <span>Rain {safeNumber(slot.rain_chance)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <span className={`pg-weather-badge ${safeToSpray ? 'is-clear' : 'is-delay'}`}>
            {safeToSpray ? 'CLEAR' : 'DELAY'}
          </span>
        </button>

        <article className="pg-dashboard-card pg-zone-card" aria-label="Zone health summary">
          <header className="pg-dashboard-card-header">
            <span className="pg-dashboard-card-title">Zone Health Summary</span>
          </header>

          <label htmlFor="pg-dashboard-zone-select" className="pg-field-label" style={{ marginBottom: 8 }}>
            Area quick review
          </label>
          <select
            id="pg-dashboard-zone-select"
            className="pg-input"
            value={selectedZoneName}
            onChange={(event) => setSelectedZoneName(event.target.value)}
            disabled={zoneOptions.length === 0}
            style={{ marginBottom: 10 }}
          >
            {zoneOptions.length === 0 ? (
              <option value="">No area available</option>
            ) : (
              zoneOptions.map((zoneName) => (
                <option key={zoneName} value={zoneName}>{zoneName}</option>
              ))
            )}
          </select>

          <p className="pg-zone-area">Total Area Scanned: {safeNumber(zoneHealthSummary.totalAreaHectares).toFixed(1)} ha</p>

          <div
            className="pg-zone-stack"
            role="img"
            aria-label={`Healthy ${safeNumber(zoneHealthSummary.healthy)} percent, At-Risk ${safeNumber(zoneHealthSummary.atRisk)} percent, Infected ${safeNumber(zoneHealthSummary.infected)} percent`}
          >
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

          <p className="pg-zone-alert" style={{ marginTop: 8 }}>
            {isZoneQuickReviewLoading
              ? 'Generating quick AI review...'
              : zoneQuickReviewError
                ? zoneQuickReviewError
                : zoneQuickReview || 'Select an area to generate a quick AI review.'}
          </p>

          <button
            type="button"
            className="pg-btn pg-btn-inline"
            onClick={() => navigate('/app/map')}
            style={{ marginTop: 8 }}
          >
            Open map
          </button>
        </article>

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
            <p className="pg-finance-kicker">Total Expected ROI</p>
            <h2>{formatCurrency(financialSummary.projectedRoiValueRm)}</h2>
            <p className="pg-finance-percent">
              {`${safeNumber(financialSummary.roiPercent) >= 0 ? '+' : ''}${safeNumber(financialSummary.roiPercent).toFixed(2)}% account-wide`}
            </p>
          </div>

          <div className="pg-finance-breakdown" aria-label="Cost versus benefit">
            <div>
              <span>Total Expected Revenue</span>
              <strong>{formatCurrency(financialSummary.projectedYieldGainRm)}</strong>
            </div>
            <div>
              <span>Total Treatment Cost</span>
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
