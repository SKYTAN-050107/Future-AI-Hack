const YIELD_FORECAST_CACHE_PREFIX = 'padiguard_yield_forecast_cache_v1'
const MAX_CACHED_FORECASTS = 10

export const YIELD_FORECAST_CACHE_TTL_MS = 45 * 60 * 1000

function cloneSerializable(value) {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value

  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function toRoundedNumber(value, fractionDigits, fallback = null) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  const factor = 10 ** fractionDigits
  return Math.round(parsed * factor) / factor
}

function buildPayloadSignature(payload) {
  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const normalized = {
    user_id: normalizeText(payload.user_id),
    grid_id: normalizeText(payload.grid_id),
    crop_type: normalizeText(payload.crop_type),
    disease: normalizeText(payload.disease),
    severity: normalizeText(payload.severity),
    severity_score: toRoundedNumber(payload.severity_score, 3),
    survival_prob: toRoundedNumber(payload.survival_prob, 3),
    farm_size: toRoundedNumber(payload.farm_size, 3),
    growth_stage: normalizeText(payload.growth_stage),
    lat: toRoundedNumber(payload.lat, 4),
    lng: toRoundedNumber(payload.lng, 4),
  }

  return JSON.stringify(normalized)
}

function buildStorageKey(userId) {
  const safeUserId = String(userId || '').trim()
  return safeUserId ? `${YIELD_FORECAST_CACHE_PREFIX}:${safeUserId}` : ''
}

function readUserCache(userId) {
  if (typeof window === 'undefined') {
    return []
  }

  const storageKey = buildStorageKey(userId)
  if (!storageKey) {
    return []
  }

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.entries)) {
      return []
    }

    return parsed.entries
      .filter((entry) => entry && typeof entry === 'object')
      .filter((entry) => typeof entry.signature === 'string' && entry.signature)
      .filter((entry) => Number.isFinite(Number(entry.fetchedAt)))
      .filter((entry) => entry.forecast && typeof entry.forecast === 'object')
      .sort((left, right) => Number(right.fetchedAt) - Number(left.fetchedAt))
  } catch {
    return []
  }
}

function writeUserCache(userId, entries) {
  if (typeof window === 'undefined') {
    return
  }

  const storageKey = buildStorageKey(userId)
  if (!storageKey) {
    return
  }

  try {
    const nextEntries = Array.isArray(entries)
      ? entries.slice(0, MAX_CACHED_FORECASTS)
      : []

    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        updatedAt: Date.now(),
        entries: nextEntries,
      }),
    )
  } catch {
    // Ignore storage failures (quota/private mode) and continue without persistent cache.
  }
}

export function getYieldForecastCache({ userId, payload, ttlMs = YIELD_FORECAST_CACHE_TTL_MS, includeStale = true }) {
  const safeUserId = String(userId || '').trim()
  if (!safeUserId) {
    return null
  }

  const signature = buildPayloadSignature(payload)
  if (!signature) {
    return null
  }

  const cachedEntry = readUserCache(safeUserId).find((entry) => entry.signature === signature)
  if (!cachedEntry) {
    return null
  }

  const fetchedAt = Number(cachedEntry.fetchedAt)
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) {
    return null
  }

  const maxAgeMs = Math.max(0, Number(ttlMs) || 0)
  const ageMs = Math.max(0, Date.now() - fetchedAt)
  const isFresh = ageMs <= maxAgeMs

  if (!includeStale && !isFresh) {
    return null
  }

  return {
    signature,
    fetchedAt,
    ageMs,
    isFresh,
    forecast: cloneSerializable(cachedEntry.forecast),
  }
}

export function saveYieldForecastCache({ userId, payload, forecast }) {
  const safeUserId = String(userId || '').trim()
  if (!safeUserId || !forecast || typeof forecast !== 'object') {
    return null
  }

  const signature = buildPayloadSignature(payload)
  if (!signature) {
    return null
  }

  const existing = readUserCache(safeUserId)
  const now = Date.now()
  const normalizedForecast = cloneSerializable(forecast)

  const nextEntries = [
    {
      signature,
      fetchedAt: now,
      forecast: normalizedForecast,
    },
    ...existing.filter((entry) => entry.signature !== signature),
  ].slice(0, MAX_CACHED_FORECASTS)

  writeUserCache(safeUserId, nextEntries)

  return {
    signature,
    fetchedAt: now,
    forecast: normalizedForecast,
  }
}

export function clearYieldForecastCache(userId) {
  if (typeof window === 'undefined') {
    return
  }

  const storageKey = buildStorageKey(userId)
  if (!storageKey) {
    return
  }

  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    // Ignore storage failures and continue.
  }
}
