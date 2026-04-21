import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconCloud, IconSun } from '../../components/icons/UiIcons'
import SectionHeader from '../../components/ui/SectionHeader'
import { sendAssistantMessage } from '../../api/assistant'
import { getCrops } from '../../api/crops'
import { getCachedDashboardSummary, getDashboardSummary } from '../../api/dashboard'
import { getWeatherOutlook } from '../../api/weather'
import { useSessionContext } from '../../hooks/useSessionContext'
import { useGrids } from '../../hooks/useGrids'
import { useScanHistory } from '../../hooks/useScanHistory'
import { useFarmLocationCoordinates } from '../../hooks/useFarmLocationCoordinates'
import { getTreatmentRoiSnapshot, getTreatmentFormSnapshot, TREATMENT_ROI_CACHE_UPDATED_EVENT } from '../../utils/treatmentRoiCache'

const ZONE_REVIEW_CACHE_TTL_MS = 5 * 60 * 1000
const zoneQuickReviewCache = new Map()

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

function buildZoneReviewCacheKey({ userId, zone, lat, lng }) {
  const safeUserId = String(userId || '').trim() || 'na'
  const safeZone = String(zone || '').trim() || 'na'
  const safeLat = Number.isFinite(Number(lat)) ? Number(lat).toFixed(4) : 'na'
  const safeLng = Number.isFinite(Number(lng)) ? Number(lng).toFixed(4) : 'na'
  return `${safeUserId}:${safeZone}:${safeLat}:${safeLng}`
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    maximumFractionDigits: 0,
  }).format(safeNumber(value))
}

function toMillis(value) {
  if (!value) {
    return 0
  }

  if (typeof value?.toMillis === 'function') {
    return value.toMillis()
  }

  if (value instanceof Date) {
    return value.getTime()
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function resolveZoneKey(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeSeverityScore(value) {
  const raw = Number(value)
  if (!Number.isFinite(raw)) {
    return null
  }

  const normalized = raw >= 0 && raw <= 1 ? raw * 100 : raw
  return Math.max(0, Math.min(100, normalized))
}

function resolveHealthBucketFromState(grid) {
  const state = String(grid?.healthState || grid?.healthStatus || 'Healthy').trim().toLowerCase()

  if (state === 'infected') {
    return 'infected'
  }

  if (state === 'at-risk' || state === 'at_risk' || state === 'risk' || state === 'warning') {
    return 'atRisk'
  }

  return 'healthy'
}

function resolveHealthBucketFromSeverity(grid, severityOverride = null) {
  const severityCandidates = [
    severityOverride,
    grid?.spreadSeverityScore,
    grid?.severityScore,
    grid?.severity,
    grid?.riskScore,
  ]

  const severityScore = severityCandidates
    .map((value) => normalizeSeverityScore(value))
    .find((value) => Number.isFinite(value))

  if (!Number.isFinite(severityScore)) {
    return null
  }

  if (severityScore >= 70) {
    return 'infected'
  }

  if (severityScore >= 40) {
    return 'atRisk'
  }

  return 'healthy'
}

function resolveZoneHealthBucket(grid, severityOverride = null) {
  const rank = {
    healthy: 0,
    atRisk: 1,
    infected: 2,
  }

  const bucketFromState = resolveHealthBucketFromState(grid)
  const bucketFromSeverity = resolveHealthBucketFromSeverity(grid, severityOverride)

  if (!bucketFromSeverity) {
    return bucketFromState
  }

  return rank[bucketFromSeverity] >= rank[bucketFromState]
    ? bucketFromSeverity
    : bucketFromState
}

function buildLatestSeverityByZone(reports, userId) {
  const safeReports = Array.isArray(reports) ? reports : []
  const safeUserId = String(userId || '').trim()

  if (!safeUserId || safeReports.length === 0) {
    return new Map()
  }

  const latestByZone = new Map()

  safeReports.forEach((report) => {
    const reportOwner = String(report?.ownerUid || report?.userId || report?.uid || '').trim()
    if (reportOwner !== safeUserId) {
      return
    }

    const zoneKey = resolveZoneKey(report?.gridId || report?.zone)
    if (!zoneKey) {
      return
    }

    const severityScore = [
      report?.severityScore,
      report?.severity_score,
      report?.severity,
    ]
      .map((value) => normalizeSeverityScore(value))
      .find((value) => Number.isFinite(value))

    if (!Number.isFinite(severityScore)) {
      return
    }

    const reportTimestamp = Math.max(
      toMillis(report?.createdAt),
      toMillis(report?.lastUpdated),
      toMillis(report?.updatedAt),
      toMillis(report?.captureCapturedAt),
    )

    const existing = latestByZone.get(zoneKey)
    if (!existing || reportTimestamp >= existing.timestamp) {
      latestByZone.set(zoneKey, {
        severityScore,
        timestamp: reportTimestamp,
      })
    }
  })

  return latestByZone
}

function buildZoneHealthSummaryFromGrids(grids, latestSeverityByZone = new Map()) {
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
    const zoneKey = resolveZoneKey(grid?.gridId || grid?.id)
    const severityOverride = zoneKey
      ? latestSeverityByZone.get(zoneKey)?.severityScore
      : null
    const bucket = resolveZoneHealthBucket(grid, severityOverride)

    if (bucket === 'infected') {
      infectedWeight += weight
      zonesNeedingAttention += 1
      return
    }

    if (bucket === 'atRisk') {
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

/* ── Skeleton placeholder components ──────────────────── */

function SkeletonLine({ className = '' }) {
  return <div className={`pg-skeleton pg-skeleton-text ${className}`} />
}

function WeatherCardSkeleton() {
  return (
    <>
      <header className="pg-dashboard-card-header">
        <span className="pg-dashboard-card-title">Weather Intelligence</span>
        <div className="pg-skeleton" style={{ width: 22, height: 22, borderRadius: '50%' }} />
      </header>
      <div className="pg-weather-primary">
        <div className="pg-skeleton pg-skeleton-heading" style={{ width: '45%' }} />
        <SkeletonLine className="is-short" />
      </div>
      <SkeletonLine className="is-wide" />
      <div style={{ marginTop: 8 }}>
        <small style={{ opacity: 0.85, display: 'block', marginBottom: 6 }}>Next 6h</small>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 6,
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="pg-skeleton pg-skeleton-box"
              style={{ height: 52, borderRadius: 10 }}
            />
          ))}
        </div>
      </div>
      <div className="pg-skeleton pg-skeleton-badge" style={{ marginTop: 'auto' }} />
    </>
  )
}

function ZoneCardSkeleton() {
  return (
    <>
      <header className="pg-dashboard-card-header">
        <span className="pg-dashboard-card-title">Zone Health Summary</span>
      </header>
      <SkeletonLine className="is-wide" />
      <div className="pg-skeleton pg-skeleton-box" style={{ height: 36 }} />
      <SkeletonLine />
      <div className="pg-skeleton pg-skeleton-bar" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        <SkeletonLine className="is-short" />
        <SkeletonLine className="is-short" />
        <SkeletonLine className="is-short" />
      </div>
      <SkeletonLine className="is-wide" />
      <SkeletonLine />
    </>
  )
}

function FinanceCardSkeleton() {
  return (
    <>
      <header className="pg-dashboard-card-header">
        <span className="pg-dashboard-card-title">Financial Command Center</span>
      </header>
      <div className="pg-finance-hero">
        <SkeletonLine className="is-short" />
        <div className="pg-skeleton pg-skeleton-heading" style={{ width: '65%', height: '2em' }} />
        <SkeletonLine />
      </div>
      <div className="pg-finance-breakdown" aria-label="Cost versus benefit">
        <div className="pg-skeleton pg-skeleton-box" />
        <div className="pg-skeleton pg-skeleton-box" />
      </div>
      <div className="pg-skeleton pg-skeleton-badge" style={{ marginTop: 'auto' }} />
    </>
  )
}

/* ── Main Dashboard ───────────────────────────────────── */

export default function Dashboard() {
  const navigate = useNavigate()
  const { user, profile } = useSessionContext()
  const { grids } = useGrids()
  const { reports, latestReport } = useScanHistory()
  const [summary, setSummary] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [isDashboardLoading, setIsDashboardLoading] = useState(true)
  const [weatherData, setWeatherData] = useState(null)
  const [weatherError, setWeatherError] = useState('')
  const [isWeatherLoading, setIsWeatherLoading] = useState(true)
  const [selectedZoneName, setSelectedZoneName] = useState('')
  const [zoneQuickReview, setZoneQuickReview] = useState('')
  const [zoneQuickReviewError, setZoneQuickReviewError] = useState('')
  const [isZoneQuickReviewLoading, setIsZoneQuickReviewLoading] = useState(false)
  const [cropCount, setCropCount] = useState(0)
  const [isCropLoading, setIsCropLoading] = useState(true)
  const [savedFinancialSummary, setSavedFinancialSummary] = useState(null)
  const [savedTreatmentPlan, setSavedTreatmentPlan] = useState(null)

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

  const latestSeverityByZone = useMemo(
    () => buildLatestSeverityByZone(reports, user?.uid),
    [reports, user?.uid],
  )

  const zoneHealthSummary = useMemo(
    () => buildZoneHealthSummaryFromGrids(grids, latestSeverityByZone),
    [grids, latestSeverityByZone],
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
      setIsDashboardLoading(false)
      return undefined
    }

    // Show cached data immediately for instant re-navigation
    const cached = getCachedDashboardSummary(requestBuild.payload)
    if (cached) {
      setSummary(cached)
      setIsDashboardLoading(false)
      setLoadError('')
    } else {
      setIsDashboardLoading(true)
      setLoadError('')
    }

    getDashboardSummary(requestBuild.payload)
      .then((response) => {
        if (!active) {
          return
        }
        setSummary(response)
        setIsDashboardLoading(false)
      })
      .catch((error) => {
        if (!active) {
          return
        }
        if (!cached) {
          setSummary(null)
        }
        setLoadError(error?.message || 'Unable to load dashboard summary')
        setIsDashboardLoading(false)
      })

    return () => {
      active = false
    }
  }, [requestBuild.error, requestBuild.payload])

  useEffect(() => {
    let active = true

    if (!requestBuild.payload) {
      setWeatherData(null)
      setWeatherError(requestBuild.error)
      setIsWeatherLoading(false)
      return undefined
    }

    setIsWeatherLoading(true)
    setWeatherError('')

    getWeatherOutlook({
      lat: requestBuild.payload.lat,
      lng: requestBuild.payload.lng,
      days: 7,
    })
      .then((response) => {
        if (!active) {
          return
        }

        setWeatherData(response || null)
        setWeatherError('')
        setIsWeatherLoading(false)
      })
      .catch((error) => {
        if (!active) {
          return
        }

        setWeatherData(null)
        setWeatherError(error?.message || 'Unable to load weather outlook')
        setIsWeatherLoading(false)
      })

    return () => {
      active = false
    }
  }, [requestBuild.error, requestBuild.payload])

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
    const safeUserId = String(user?.uid || '').trim()
    if (!safeUserId) {
      setSavedFinancialSummary(null)
      setSavedTreatmentPlan(null)
      return undefined
    }

    const refreshSnapshot = () => {
      setSavedFinancialSummary(getTreatmentRoiSnapshot(safeUserId))
      const formSnapshot = getTreatmentFormSnapshot(safeUserId)
      const planFromCache = formSnapshot?.values?.plan ?? null
      setSavedTreatmentPlan(planFromCache && typeof planFromCache === 'object' ? planFromCache : null)
    }

    refreshSnapshot()

    const handleCacheUpdated = () => {
      refreshSnapshot()
    }

    window.addEventListener(TREATMENT_ROI_CACHE_UPDATED_EVENT, handleCacheUpdated)

    return () => {
      window.removeEventListener(TREATMENT_ROI_CACHE_UPDATED_EVENT, handleCacheUpdated)
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
    const cacheKey = buildZoneReviewCacheKey({
      userId,
      zone: selectedZoneName,
      lat,
      lng,
    })
    const cachedReview = zoneQuickReviewCache.get(cacheKey)
    const isCachedReviewFresh = cachedReview && (Date.now() - cachedReview.fetchedAt) < ZONE_REVIEW_CACHE_TTL_MS

    if (isCachedReviewFresh) {
      setZoneQuickReview(cachedReview.value)
      setZoneQuickReviewError('')
      setIsZoneQuickReviewLoading(false)
      return () => {
        active = false
      }
    }

    setIsZoneQuickReviewLoading(true)
    setZoneQuickReview('')
    setZoneQuickReviewError('')

    const quickReviewPrompt = [
      '[ZONE_REVIEW] You are an agriculture assistant.',
      `Give one short agriculture-only review for zone ${selectedZoneName}.`,
      'Mention crop health risk level and one immediate farm action.',
      'Keep it to one sentence.',
    ].join(' ')

    sendAssistantMessage({
      userPrompt: quickReviewPrompt,
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
        const reply = String(response?.assistant_reply || '').trim()
        zoneQuickReviewCache.set(cacheKey, {
          value: reply,
          fetchedAt: Date.now(),
        })
        setZoneQuickReview(reply)
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
  }, [farmLocation, lat, lng, selectedZoneName, user?.uid])

  const weatherSnapshot = weatherData || {}
  const financialSummary = savedFinancialSummary || summary?.financialSummary || {}
  const weatherServiceWarning = String(weatherSnapshot.serviceWarning || '').trim()
  const hasFinancialData = !!(savedFinancialSummary || summary?.financialSummary)

  const hourlyForecast6h = useMemo(() => {
    const firstDay = Array.isArray(weatherSnapshot?.forecast)
      ? weatherSnapshot.forecast[0]
      : null

    const hourly = Array.isArray(firstDay?.hourly)
      ? firstDay.hourly
      : []

    return hourly.slice(0, 6)
  }, [weatherSnapshot])

  // Derived weather values – safe to compute even when data is absent
  const rainInHours = safeNumber(weatherSnapshot.rainInHours, -1)
  const safeToSpray = typeof weatherSnapshot?.safeToSpray === 'boolean'
    ? weatherSnapshot.safeToSpray
    : rainInHours < 0 || rainInHours >= 4
  const WeatherIcon = safeToSpray ? IconSun : IconCloud
  const hasWeatherData = !!weatherData

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
        {/* ── Weather Widget ──────────────────────────── */}
        <button
          type="button"
          className="pg-dashboard-card pg-weather-card"
          onClick={() => navigate('/app/weather')}
          aria-label="Open 7-day weather intelligence"
        >
          {isWeatherLoading && !hasWeatherData ? (
            <WeatherCardSkeleton />
          ) : (
            <>
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
            </>
          )}
        </button>

        {/* ── Zone Health Widget ──────────────────────── */}
        <article className="pg-dashboard-card pg-zone-card" aria-label="Zone health summary">
          {isDashboardLoading && !summary ? (
            <ZoneCardSkeleton />
          ) : (
            <>
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
            </>
          )}
        </article>

        {/* ── Financial / ROI Widget ──────────────────── */}
        <article className="pg-dashboard-card pg-finance-card" aria-label="Financial command center">
          {isDashboardLoading && !hasFinancialData ? (
            <FinanceCardSkeleton />
          ) : (
            <>
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

              {savedTreatmentPlan ? (
                <div className="pg-finance-treatment-summary">
                  <p className="pg-finance-summary-label">Last treatment recommendation</p>
                  <p className="pg-finance-summary-text">{String(savedTreatmentPlan.recommendation || '').slice(0, 100)}{String(savedTreatmentPlan.recommendation || '').length > 100 ? '…' : ''}</p>
                </div>
              ) : (
                <div className="pg-finance-treatment-summary">
                  <p className="pg-finance-summary-label">No treatment plan computed yet</p>
                  <p className="pg-finance-summary-text">Run the ROI calculator to see your treatment recommendation here.</p>
                </div>
              )}

              {safeNumber(financialSummary.lowStockLiters, 999) < 5 ? (
                <p className="pg-finance-alert">
                  Low stock alert: {financialSummary.lowStockItem || 'Item'} only {safeNumber(financialSummary.lowStockLiters).toFixed(1)}L left.
                </p>
              ) : null}

              <div className="pg-finance-cta-group">
                <button
                  type="button"
                  className="pg-btn pg-btn-primary pg-finance-cta-btn"
                  onClick={() => navigate('/app/treatment-plan')}
                >
                  Treatment Plan
                </button>
                <button
                  type="button"
                  className="pg-btn pg-btn-primary pg-finance-cta-btn"
                  onClick={() => navigate('/app/treatment')}
                >
                  ROI Deep Dive
                </button>
                <button
                  type="button"
                  className="pg-btn pg-btn-primary pg-finance-cta-btn"
                  onClick={() => navigate('/app/yield-prediction')}
                >
                  Yield Prediction
                </button>
              </div>
            </>
          )}
        </article>
      </div>
    </section>
  )
}
