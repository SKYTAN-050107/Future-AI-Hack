let cachedSwarmActionKey = null
let cachedSwarmRoutePrefix = null
const SWARM_API_BASE_URL = String(import.meta.env.VITE_SWARM_API_BASE_URL || '').trim().replace(/\/+$/, '')
const SWARM_ROUTE_PREFIXES = ['/swarm-api', '/api']

function preferredSwarmRoutePrefixes() {
  if (cachedSwarmRoutePrefix) {
    return [cachedSwarmRoutePrefix, ...SWARM_ROUTE_PREFIXES.filter((prefix) => prefix !== cachedSwarmRoutePrefix)]
  }

  if (SWARM_API_BASE_URL) {
    return ['/api', '/swarm-api']
  }

  return ['/swarm-api', '/api']
}

function resolveSwarmUrl(path) {
  if (/^https?:\/\//i.test(path)) {
    return path
  }

  const normalizedPath = path.startsWith('/swarm-api/')
    ? `/api/${path.slice('/swarm-api/'.length)}`
    : path

  if (!SWARM_API_BASE_URL) {
    return normalizedPath
  }

  const suffix = /\/api$/i.test(SWARM_API_BASE_URL) && normalizedPath.startsWith('/api/')
    ? normalizedPath.slice('/api'.length)
    : normalizedPath

  return `${SWARM_API_BASE_URL}${suffix}`
}

async function requestSwarm(path, options = {}) {
  let response = null
  const requestUrl = resolveSwarmUrl(path)
  try {
    response = await fetch(requestUrl, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    })
  } catch {
    throw new Error('Cannot reach swarm backend on current origin. Ensure swarm service is running and retry.')
  }

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const message = payload?.detail || payload?.error?.message || payload?.message || `Swarm request failed (${response.status})`
    throw new Error(message)
  }

  return payload
}

function findSwarmActionKey(actionsPayload) {
  if (!actionsPayload || typeof actionsPayload !== 'object') {
    return null
  }

  const keys = Object.keys(actionsPayload)
  if (!Array.isArray(keys) || keys.length === 0) {
    return null
  }

  const preferred = keys.find((key) => key === '/flow/swarm_orchestrator')
  if (preferred) {
    return preferred
  }

  const fallback = keys.find((key) => key.includes('swarm_orchestrator'))
  return fallback || null
}

async function resolveSwarmActionKey() {
  if (cachedSwarmActionKey) {
    return cachedSwarmActionKey
  }

  const routePrefixes = preferredSwarmRoutePrefixes()
  let foundKey = null
  let foundPrefix = null

  for (const routePrefix of routePrefixes) {
    const actionsPayload = await requestSwarm(`${routePrefix}/actions`, {
      method: 'GET',
    }).catch(() => null)

    const key = findSwarmActionKey(actionsPayload)
    if (key) {
      foundKey = key
      foundPrefix = routePrefix
      break
    }
  }

  if (!foundKey) {
    throw new Error('swarm_orchestrator action was not found on swarm backend.')
  }

  cachedSwarmActionKey = foundKey
  cachedSwarmRoutePrefix = foundPrefix
  return foundKey
}

export async function runSwarmOrchestrator(input) {
  const key = await resolveSwarmActionKey()
  const routePrefix = cachedSwarmRoutePrefix || preferredSwarmRoutePrefixes()[0]

  const payload = await requestSwarm(`${routePrefix}/runAction`, {
    method: 'POST',
    body: JSON.stringify({
      key,
      input,
    }),
  })

  return payload?.result || null
}
