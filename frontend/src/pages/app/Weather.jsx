import { useEffect, useMemo, useState, useCallback } from 'react'
import BackButton from '../../components/navigation/BackButton'
import SectionHeader from '../../components/ui/SectionHeader'
import { getWeatherOutlook, getMeteorologistAdvisory } from '../../api/weather'
import { useSessionContext } from '../../hooks/useSessionContext'
import { useGrids } from '../../hooks/useGrids'
import { useFarmLocationCoordinates } from '../../hooks/useFarmLocationCoordinates'

/* ── Helpers ──────────────────────────────────────────────── */

const CONDITION_ICONS = {
  Clear: '☀️',
  'Mostly Clear': '🌤️',
  'Partly Cloudy': '⛅',
  'Mostly Cloudy': '🌥️',
  Cloudy: '☁️',
  Fog: '🌫️',
  'Light Fog': '🌫️',
  Drizzle: '🌦️',
  Rain: '🌧️',
  'Light Rain': '🌦️',
  'Heavy Rain': '⛈️',
  Snow: '❄️',
  'Light Snow': '🌨️',
  'Heavy Snow': '❄️',
  Thunderstorm: '⛈️',
  Unknown: '🌡️',
}

function conditionIcon(condition) {
  return CONDITION_ICONS[condition] || '🌡️'
}

function weatherHeroVariant(condition) {
  const value = String(condition || '').trim().toLowerCase()

  if (value === 'clear' || value === 'mostly clear') return 'is-clear'
  if (value === 'partly cloudy') return 'is-partly-cloudy'
  if (value === 'cloudy' || value === 'mostly cloudy') return 'is-cloudy'
  if (value === 'fog' || value === 'light fog') return 'is-fog'
  if (value === 'drizzle') return 'is-drizzle'
  if (value === 'rain' || value === 'light rain') return 'is-rain'
  if (value === 'heavy rain') return 'is-heavy-rain'
  if (value === 'thunderstorm') return 'is-thunderstorm'
  if (value === 'snow' || value === 'light snow') return 'is-snow'
  if (value === 'heavy snow') return 'is-snow-heavy'
  return 'is-unknown'
}

function normalizeForecastEntry(entry, index) {
  const day = String(entry?.day || '').trim()
  const condition = String(entry?.condition || '').trim()
  const sprayWindow = String(entry?.sprayWindow || '').trim()

  return {
    day: day || `Day ${index + 1}`,
    condition: condition || 'Unknown',
    rainChance: Number.isFinite(Number(entry?.rainChance)) ? Number(entry.rainChance) : 0,
    wind: String(entry?.wind || '-'),
    sprayWindow: sprayWindow || 'Delay spraying',
    safe: Boolean(entry?.safe),
    temperature_high: Number.isFinite(Number(entry?.temperature_high)) ? Number(entry.temperature_high) : null,
    temperature_low: Number.isFinite(Number(entry?.temperature_low)) ? Number(entry.temperature_low) : null,
    hourly: Array.isArray(entry?.hourly) ? entry.hourly : [],
  }
}

const ADVISORY_CACHE_TTL_MS = 15 * 60 * 1000

function buildAdvisoryCacheKey(lat, lng, cropType) {
  const safeLat = Number.isFinite(Number(lat)) ? Number(lat).toFixed(4) : 'na'
  const safeLng = Number.isFinite(Number(lng)) ? Number(lng).toFixed(4) : 'na'
  const safeCrop = String(cropType || 'Rice').trim().toLowerCase().replace(/\s+/g, '-')
  return `padiguard:weather:meteorologist:${safeLat}:${safeLng}:${safeCrop}`
}

function readAdvisoryCache(cacheKey) {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(cacheKey)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.advisory !== 'string' || typeof parsed.fetchedAt !== 'number') {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

function writeAdvisoryCache(cacheKey, advisory) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(cacheKey, JSON.stringify({ advisory, fetchedAt: Date.now() }))
  } catch {
    // Ignore storage failures and keep the advisory in-memory only.
  }
}

function advisoryAgeMinutes(fetchedAt) {
  if (!Number.isFinite(Number(fetchedAt)) || Number(fetchedAt) <= 0) return null
  return Math.max(0, Math.floor((Date.now() - Number(fetchedAt)) / 60000))
}

function advisoryCacheRemainingMinutes(fetchedAt) {
  if (!Number.isFinite(Number(fetchedAt)) || Number(fetchedAt) <= 0) return null
  return Math.max(0, Math.ceil((ADVISORY_CACHE_TTL_MS - (Date.now() - Number(fetchedAt))) / 60000))
}

/* ── Chevron SVG ──────────────────────────────────────────── */

function ChevronDown({ className }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 8 10 12 14 8" />
    </svg>
  )
}

/* ── Day Card ─────────────────────────────────────────────── */

function DayCard({ entry }) {
  const [open, setOpen] = useState(false)
  const hasHourly = entry.hourly.length > 0
  const icon = conditionIcon(entry.condition)

  return (
    <article className="pg-weather-day-card" id={`weather-day-${entry.day.toLowerCase().replace(/\s+/g, '-')}`}>
      <div
        className="pg-weather-day-header"
        onClick={() => hasHourly && setOpen((v) => !v)}
        role={hasHourly ? 'button' : undefined}
        tabIndex={hasHourly ? 0 : undefined}
        onKeyDown={(e) => {
          if (hasHourly && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            setOpen((v) => !v)
          }
        }}
        aria-expanded={hasHourly ? open : undefined}
      >
        <span className="pg-weather-day-name">{entry.day}</span>

        <span className="pg-weather-day-summary">
          <span className="pg-weather-day-summary-icon">{icon}</span>
          {entry.condition} · Rain {entry.rainChance}%
        </span>

        {entry.temperature_high !== null && entry.temperature_low !== null ? (
          <span className="pg-weather-day-temps">
            {entry.temperature_high}° <span>/ {entry.temperature_low}°</span>
          </span>
        ) : null}

        <span className={`pg-weather-day-badge ${entry.safe ? 'is-clear' : 'is-delay'}`}>
          {entry.safe ? 'CLEAR' : 'DELAY'}
        </span>

        {hasHourly ? (
          <span className={`pg-weather-day-toggle ${open ? 'is-open' : ''}`}>
            <ChevronDown />
          </span>
        ) : null}
      </div>

      {/* Spray window info */}
      <div className="pg-weather-day-meta">
        <span>🕐</span>
        <span className="pg-weather-day-spray-window">Spray: {entry.sprayWindow}</span>
        <span>· Wind {entry.wind}</span>
      </div>

      {/* Hourly expansion */}
      {open && hasHourly ? (
        <div className="pg-weather-hourly-panel">
          {entry.hourly.map((h, i) => (
            <div key={i} className="pg-weather-hourly-row">
              <span className="pg-weather-hourly-time">{h.time}</span>
              <span className={`pg-weather-hourly-spray-dot ${h.safe_to_spray ? 'is-safe' : 'is-unsafe'}`} title={h.safe_to_spray ? 'Safe to spray' : 'Unsafe'} />
              <span className="pg-weather-hourly-temp">{h.temperature_c}°</span>
              <span className="pg-weather-hourly-condition">{conditionIcon(h.condition)} {h.condition}</span>
              <span className="pg-weather-hourly-rain">💧 {h.rain_chance}%</span>
              <span className="pg-weather-hourly-wind">{h.wind_kmh} km/h</span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}

/* ── Main Weather Page ────────────────────────────────────── */

export default function Weather() {
  const { user, profile } = useSessionContext()
  const { grids } = useGrids()

  // Weather data state
  const [weatherData, setWeatherData] = useState(null)
  const [sevenDayForecast, setSevenDayForecast] = useState([])
  const [error, setError] = useState('')

  // AI advisory state
  const [advisory, setAdvisory] = useState('')
  const [advisoryLoading, setAdvisoryLoading] = useState(false)
  const [advisoryError, setAdvisoryError] = useState('')
  const [advisoryFetchedAt, setAdvisoryFetchedAt] = useState(0)

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
  const advisoryCacheKey = useMemo(
    () => (hasCoords ? buildAdvisoryCacheKey(lat, lng, 'Rice') : ''),
    [hasCoords, lat, lng],
  )

  useEffect(() => {
    setAdvisory('')
    setAdvisoryError('')
    setAdvisoryFetchedAt(0)
  }, [advisoryCacheKey])

  // Fetch weather data
  useEffect(() => {
    let active = true
    const userId = String(user?.uid || '').trim()
    if (!userId) {
      setSevenDayForecast([])
      setWeatherData(null)
      setError('Sign in to load weather outlook.')
      return undefined
    }

    if (!hasCoords) {
      setSevenDayForecast([])
      setWeatherData(null)
      if (locationResolutionError) {
        setError(locationResolutionError)
      } else if (!farmLocation) {
        setError('Set your farm location in Settings or add a farm grid centroid to load weather outlook.')
      } else {
        setError('')
      }
      return undefined
    }

    setError('')
    getWeatherOutlook({ lat, lng, days: 7 })
      .then((response) => {
        if (!active) return

        console.log('[Weather API] outlook response', response)

        setWeatherData(response)
        const forecast = Array.isArray(response?.forecast)
          ? response.forecast.map((entry, index) => normalizeForecastEntry(entry, index))
          : []
        setSevenDayForecast(forecast)
      })
      .catch((loadError) => {
        if (!active) return
        setSevenDayForecast([])
        setWeatherData(null)
        setError(loadError?.message || 'Unable to load weather forecast')
      })

    return () => { active = false }
  }, [farmLocation, hasCoords, lat, lng, locationResolutionError, user?.uid])

  // Fetch AI advisory
  const fetchAdvisory = useCallback(() => {
    if (!hasCoords) return

    const cachedAdvisory = advisoryCacheKey ? readAdvisoryCache(advisoryCacheKey) : null
    if (cachedAdvisory && (Date.now() - cachedAdvisory.fetchedAt) < ADVISORY_CACHE_TTL_MS) {
      setAdvisory(cachedAdvisory.advisory)
      setAdvisoryFetchedAt(cachedAdvisory.fetchedAt)
      setAdvisoryError('')
      return
    }

    setAdvisoryLoading(true)
    setAdvisoryError('')

    getMeteorologistAdvisory({ lat, lng, cropType: 'Rice' })
      .then((response) => {
        console.log('[Weather API] meteorologist advisory response', response)
        const text = typeof response?.result === 'string'
          ? response.result
          : typeof response === 'string'
            ? response
            : JSON.stringify(response?.result || response, null, 2)
        setAdvisory(text)
        setAdvisoryFetchedAt(Date.now())
        if (advisoryCacheKey) {
          writeAdvisoryCache(advisoryCacheKey, text)
        }
      })
      .catch((err) => {
        if (cachedAdvisory?.advisory) {
          setAdvisory(cachedAdvisory.advisory)
          setAdvisoryFetchedAt(cachedAdvisory.fetchedAt)
          setAdvisoryError('')
          return
        }

        setAdvisoryError(err?.message || 'Unable to load AI advisory. Ensure swarm server is running.')
      })
      .finally(() => {
        setAdvisoryLoading(false)
      })
  }, [advisoryCacheKey, hasCoords, lat, lng])

  // Auto-fetch advisory once we have coords and weather data
  useEffect(() => {
    if (hasCoords && weatherData) {
      fetchAdvisory()
    }
  }, [hasCoords, weatherData, fetchAdvisory])

  /* ── Today snapshot from the response root ─────────────── */
  const today = weatherData || {}
  const safeToSpray = Boolean(today.safeToSpray)
  const serviceWarning = String(today.serviceWarning || '').trim()
  const advisoryAge = advisoryAgeMinutes(advisoryFetchedAt)
  const advisoryCooldown = advisoryCacheRemainingMinutes(advisoryFetchedAt)
  const heroVariant = weatherHeroVariant(today.condition)

  return (
    <section className="pg-page pg-weather-page">
      <SectionHeader
        title="7-Day Climate View"
        align="center"
        leadingAction={<BackButton fallback="/app" label="Back to dashboard" />}
      />

      {/* Error state */}
      {error ? (
        <article className="pg-card">
          <p>{error}</p>
        </article>
      ) : null}

      {/* Loading state */}
      {!error && !weatherData ? (
        <article className="pg-card">
          <p>Loading weather forecast...</p>
        </article>
      ) : null}

      {/* ── Today Hero Card ─────────────────────────────── */}
      {weatherData ? (
        <div className={`pg-weather-hero ${heroVariant}`} id="weather-hero-today">
          <div className="pg-weather-hero-top">
            <div>
              <div className="pg-weather-hero-temp">{today.temperatureC}°C</div>
              <p className="pg-weather-hero-condition">
                {conditionIcon(today.condition)} {today.condition}
              </p>
            </div>
            <span className="pg-weather-hero-icon">{safeToSpray ? '☀️' : '🌧️'}</span>
          </div>

          <div className="pg-weather-hero-details">
            <div className="pg-weather-hero-stat">
              <span className="pg-weather-hero-stat-label">Rain</span>
              <span className="pg-weather-hero-stat-value">{today.rain_probability}%</span>
            </div>
            <div className="pg-weather-hero-stat">
              <span className="pg-weather-hero-stat-label">Wind</span>
              <span className="pg-weather-hero-stat-value">{today.windKmh} km/h {today.windDirection}</span>
            </div>
            <div className="pg-weather-hero-stat">
              <span className="pg-weather-hero-stat-label">Rain In</span>
              <span className="pg-weather-hero-stat-value">
                {today.rainInHours != null ? `${today.rainInHours}h` : 'None'}
              </span>
            </div>
          </div>

          <div className="pg-weather-hero-spray">
            <p className="pg-weather-hero-advisory">{today.advisory}</p>
            <span className={`pg-weather-badge ${safeToSpray ? 'is-clear' : 'is-delay'}`}>
              {safeToSpray ? 'SAFE TO SPRAY' : 'DELAY SPRAY'}
            </span>
          </div>

          {serviceWarning ? (
            <p className="pg-weather-service-warning">
              {serviceWarning}
            </p>
          ) : null}

          {today.best_spray_window ? (
            <div className="pg-weather-day-meta pg-weather-best-window-meta">
              <span>🕐</span>
              <span className="pg-weather-day-spray-window">Best Window: {today.best_spray_window}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── AI Meteorologist Advisory ───────────────────── */}
      {weatherData ? (
        <div className="pg-weather-ai-card" id="weather-ai-advisory">
          <div className="pg-weather-ai-header">
            <h3 className="pg-weather-ai-title">
              🌦️ Meteorologist AI Advisory
            </h3>
            <button
              className="pg-weather-ai-refresh"
              onClick={fetchAdvisory}
              disabled={advisoryLoading}
              aria-label="Refresh AI advisory"
            >
              {advisoryLoading ? 'Analyzing…' : 'Refresh'}
            </button>
          </div>

          <p className="pg-weather-ai-cache-note">
            AI advisory is cached locally for 15 minutes to reduce repeated calls.
            {advisoryAge !== null ? ` Last updated ${advisoryAge} minute(s) ago.` : ''}
            {advisoryCooldown !== null ? ` Refreshes reuse the cache for about ${advisoryCooldown} more minute(s).` : ''}
          </p>

          {advisoryLoading && !advisory ? (
            <div className="pg-weather-ai-loading">
              <span className="pg-weather-ai-spinner" />
              <span>Meteorologist is analyzing weather patterns...</span>
            </div>
          ) : null}

          {advisoryError && !advisory ? (
            <p className="pg-weather-ai-error">{advisoryError}</p>
          ) : null}

          {advisory ? (
            <p className="pg-weather-ai-body">{advisory}</p>
          ) : null}
        </div>
      ) : null}

      {/* ── 7-Day Forecast ──────────────────────────────── */}
      {sevenDayForecast.length > 0 ? (
        <>
          <h3 className="pg-weather-section-title">7-Day Forecast</h3>
          <div className="pg-weather-forecast-list">
            {sevenDayForecast.map((entry) => (
              <DayCard key={entry.day} entry={entry} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  )
}
