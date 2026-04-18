import { gateway } from './gateway'

const WEATHER_OUTLOOK_CACHE_TTL_MS = 15 * 60 * 1000
const weatherOutlookCache = new Map()

function toFiniteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeForecastDays(days) {
  const parsedDays = Number(days)
  if (!Number.isFinite(parsedDays)) return 7
  return Math.max(1, Math.min(10, Math.trunc(parsedDays)))
}

function buildWeatherCacheKey(lat, lng) {
  const safeLat = Number.isFinite(Number(lat)) ? Number(lat).toFixed(4) : 'na'
  const safeLng = Number.isFinite(Number(lng)) ? Number(lng).toFixed(4) : 'na'
  return `${safeLat}:${safeLng}`
}

function sliceWeatherResponse(response, days) {
  if (!response || !Array.isArray(response.forecast)) {
    return response
  }

  return {
    ...response,
    forecast: response.forecast.slice(0, days),
  }
}

export async function getWeatherOutlook(input) {
  const safeLat = toFiniteNumber(input?.lat)
  const safeLng = toFiniteNumber(input?.lng)
  if (safeLat === null || safeLng === null) {
    throw new Error('lat and lng are required for weather outlook')
  }

  const requestedDays = normalizeForecastDays(input?.days)
  const cacheKey = buildWeatherCacheKey(safeLat, safeLng)
  const cached = weatherOutlookCache.get(cacheKey)
  const isFresh = cached && cached.fetchedAt && (Date.now() - cached.fetchedAt) < WEATHER_OUTLOOK_CACHE_TTL_MS

  if (isFresh && cached.response) {
    return sliceWeatherResponse(cached.response, requestedDays)
  }

  if (cached?.promise) {
    const response = await cached.promise
    return sliceWeatherResponse(response, requestedDays)
  }

  const fetchDays = Math.max(requestedDays, 7)
  const promise = gateway.getWeatherOutlook({ lat: safeLat, lng: safeLng, days: fetchDays })
    .then((response) => {
      weatherOutlookCache.set(cacheKey, {
        response,
        fetchedAt: Date.now(),
      })

      return response
    })
    .catch((error) => {
      const existing = weatherOutlookCache.get(cacheKey)
      if (existing?.response) {
        return existing.response
      }

      weatherOutlookCache.delete(cacheKey)
      throw error
    })

  weatherOutlookCache.set(cacheKey, {
    promise,
    fetchedAt: Date.now(),
  })

  const response = await promise
  return sliceWeatherResponse(response, requestedDays)
}

export async function getMeteorologistAdvisory(input) {
  const response = await gateway.getMeteorologistAdvisory(input)
  return response
}
