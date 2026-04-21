let cachedSwarmActionKey = null
const SWARM_API_BASE_URL = String(import.meta.env.VITE_SWARM_API_BASE_URL || '').trim().replace(/\/+$/, '')

function resolveSwarmUrl(path) {
  if (/^https?:\/\//i.test(path)) {
    return path
  }

  if (!SWARM_API_BASE_URL) {
    return path
  }

  const suffix = path.startsWith('/swarm-api')
    ? path.slice('/swarm-api'.length)
    : path

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

  const actionsPayload = await requestSwarm('/swarm-api/actions', {
    method: 'GET',
  })

  const key = findSwarmActionKey(actionsPayload)
  if (!key) {
    throw new Error('swarm_orchestrator action was not found on swarm backend.')
  }

  cachedSwarmActionKey = key
  return key
}

export async function runSwarmOrchestrator(input) {
  const key = await resolveSwarmActionKey()

  const payload = await requestSwarm('/swarm-api/runAction', {
    method: 'POST',
    body: JSON.stringify({
      key,
      input,
    }),
  })

  return payload?.result || null
}
