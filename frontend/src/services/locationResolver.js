const MAPBOX_TOKEN = String(import.meta.env.VITE_MAPBOX_TOKEN || '').trim()

const locationCache = new Map()

function normalizeLocationKey(value) {
  return String(value || '').trim().toLowerCase()
}

export async function geocodeLocation(locationText) {
  const query = String(locationText || '').trim()
  if (!query || !MAPBOX_TOKEN) {
    return null
  }

  const cacheKey = normalizeLocationKey(query)
  if (locationCache.has(cacheKey)) {
    return locationCache.get(cacheKey)
  }

  const endpoint = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
  )
  endpoint.searchParams.set('access_token', MAPBOX_TOKEN)
  endpoint.searchParams.set('limit', '1')
  endpoint.searchParams.set('autocomplete', 'false')
  endpoint.searchParams.set('types', 'place,locality,district,region,postcode')

  const response = await fetch(endpoint.toString(), {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error('Unable to resolve your saved location. Please update it in Settings.')
  }

  const payload = await response.json()
  const feature = Array.isArray(payload?.features) ? payload.features[0] : null
  const center = Array.isArray(feature?.center) ? feature.center : []
  const lng = Number(center[0])
  const lat = Number(center[1])

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }

  const result = {
    lat,
    lng,
    label: String(feature?.place_name || query).trim() || query,
    query,
  }

  locationCache.set(cacheKey, result)
  return result
}
