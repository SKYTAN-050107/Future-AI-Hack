import { useEffect, useMemo, useState } from 'react'
import BackButton from '../../components/navigation/BackButton'
import SectionHeader from '../../components/ui/SectionHeader'
import { getWeatherOutlook } from '../../api/weather'
import { useSessionContext } from '../../hooks/useSessionContext'
import { useGrids } from '../../hooks/useGrids'

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
  }
}

export default function Weather() {
  const { user } = useSessionContext()
  const { grids } = useGrids()
  const [sevenDayForecast, setSevenDayForecast] = useState([])
  const [error, setError] = useState('')

  const firstGridWithCentroid = useMemo(
    () => grids.find((grid) => Number.isFinite(grid?.centroid?.lat) && Number.isFinite(grid?.centroid?.lng)),
    [grids],
  )

  useEffect(() => {
    let active = true
    const userId = String(user?.uid || '').trim()
    if (!userId) {
      setSevenDayForecast([])
      setError('Sign in to load weather outlook.')
      return undefined
    }

    const lat = Number(firstGridWithCentroid?.centroid?.lat)
    const lng = Number(firstGridWithCentroid?.centroid?.lng)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setSevenDayForecast([])
      setError('Set at least one farm grid with centroid to load weather outlook.')
      return undefined
    }

    setError('')
    getWeatherOutlook({
      lat,
      lng,
      days: 7,
    })
      .then((response) => {
        if (!active) {
          return
        }

        const forecast = Array.isArray(response?.forecast)
          ? response.forecast.map((entry, index) => normalizeForecastEntry(entry, index))
          : []
        setSevenDayForecast(forecast)
      })
      .catch((loadError) => {
        if (!active) {
          return
        }

        setSevenDayForecast([])
        setError(loadError?.message || 'Unable to load weather forecast')
      })

    return () => {
      active = false
    }
  }, [firstGridWithCentroid?.centroid?.lat, firstGridWithCentroid?.centroid?.lng, user?.uid])

  return (
    <section className="pg-page">
      <SectionHeader
        title="7-Day Climate View"
        align="center"
        leadingAction={<BackButton fallback="/app" label="Back to dashboard" />}
      />

      {error ? (
        <article className="pg-card">
          <p>{error}</p>
        </article>
      ) : null}

      {!error && sevenDayForecast.length === 0 ? (
        <article className="pg-card">
          <p>Loading weather forecast...</p>
        </article>
      ) : null}

      {sevenDayForecast.map((entry) => (
        <article key={entry.day} className="pg-card">
          <h2>{entry.day}</h2>
          <p>{entry.condition} - Rain chance {entry.rainChance}% - Wind {entry.wind}</p>
          <p>
            Spray window: {entry.sprayWindow}{' '}
            <strong style={{ color: entry.safe ? 'var(--primary)' : 'var(--danger)' }}>
              {entry.safe ? 'CLEAR' : 'DELAY'}
            </strong>
          </p>
        </article>
      ))}
    </section>
  )
}
