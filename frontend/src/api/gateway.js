const DEFAULT_BACKEND_URL = 'http://localhost:8000'
const BACKEND_URL = String(import.meta.env.VITE_DIAGNOSIS_API_URL || DEFAULT_BACKEND_URL).replace(/\/+$/, '')

function normalizeBase64Image(value) {
  const input = String(value || '').trim()
  if (!input) {
    return ''
  }

  if (input.startsWith('data:') && input.includes(',')) {
    return input.split(',', 2)[1]
  }

  return input
}

async function requestJson(path, options = {}) {
  let response = null
  try {
    response = await fetch(`${BACKEND_URL}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    })
  } catch {
    throw new Error(`Cannot reach diagnosis backend at ${BACKEND_URL}. Start backend service and retry.`)
  }

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const message = payload?.detail || payload?.error?.message || `Request failed (${response.status})`
    throw new Error(message)
  }

  return payload
}

function toFiniteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function buildQueryString(params) {
  const query = new URLSearchParams()

  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      return
    }

    query.set(key, String(value))
  })

  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

export const gateway = {
  health: async () => requestJson('/health', { method: 'GET' }),

  getWeatherOutlook: async ({ lat, lng, days = 7 }) => {
    const safeLat = toFiniteNumber(lat)
    const safeLng = toFiniteNumber(lng)
    const safeDays = toFiniteNumber(days)

    if (safeLat === null || safeLng === null) {
      throw new Error('lat and lng are required for weather lookup')
    }

    return requestJson(`/api/weather${buildQueryString({ lat: safeLat, lng: safeLng, days: safeDays || 7 })}`, {
      method: 'GET',
    })
  },

  scanDisease: async (input) => {
    const base64Image = normalizeBase64Image(input?.base64Image)
    if (!base64Image) {
      throw new Error('base64Image is required for diagnosis scan')
    }

    return requestJson('/api/scan', {
      method: 'POST',
      body: JSON.stringify({
        source: input?.source || 'camera',
        grid_id: input?.gridId || null,
        base64_image: base64Image,
      }),
    })
  },

  scanAndAskAssistant: async (input) => {
    const base64Image = normalizeBase64Image(input?.base64Image)
    if (!base64Image) {
      throw new Error('base64Image is required for assistant diagnosis flow')
    }

    return requestJson('/api/assistant/scan', {
      method: 'POST',
      body: JSON.stringify({
        source: input?.source || 'camera',
        grid_id: input?.gridId || null,
        base64_image: base64Image,
        user_prompt: input?.userPrompt || 'I just took this photo. Please explain what disease this is and what I should do now.',
      }),
    })
  },

  sendAssistantMessage: async (input) => {
    const userPrompt = String(input?.userPrompt || '').trim()
    const userId = String(input?.userId || '').trim()

    if (!userPrompt) {
      throw new Error('userPrompt is required for assistant message')
    }

    if (!userId) {
      throw new Error('userId is required for assistant message')
    }

    return requestJson('/api/assistant/message', {
      method: 'POST',
      body: JSON.stringify({
        user_prompt: userPrompt,
        user_id: userId,
        zone: input?.zone || null,
      }),
    })
  },

  getTreatmentPlan: async (input) => {
    const disease = String(input?.disease || '').trim()
    const cropType = String(input?.cropType || '').trim()
    const treatmentPlan = String(input?.treatmentPlan || '').trim()
    const userId = String(input?.userId || '').trim()
    const farmSizeHectares = toFiniteNumber(input?.farmSizeHectares)
    const survivalProb = toFiniteNumber(input?.survivalProb)

    if (!disease || !cropType || !treatmentPlan || !userId) {
      throw new Error('disease, cropType, treatmentPlan, and userId are required for treatment plan')
    }

    if (farmSizeHectares === null || farmSizeHectares <= 0) {
      throw new Error('farmSizeHectares must be greater than 0')
    }

    if (survivalProb === null || survivalProb < 0 || survivalProb > 1) {
      throw new Error('survivalProb must be between 0 and 1')
    }

    return requestJson('/api/treatment', {
      method: 'POST',
      body: JSON.stringify({
        disease,
        zone: input?.zone || null,
        crop_type: cropType,
        treatment_plan: treatmentPlan,
        user_id: userId,
        farm_size_hectares: farmSizeHectares,
        survival_prob: survivalProb,
        lat: toFiniteNumber(input?.lat),
        lng: toFiniteNumber(input?.lng),
        weatherContext: input?.weatherContext || null,
        treatment_cost_rm: toFiniteNumber(input?.treatmentCostRm),
      }),
    })
  },

  getInventory: async ({ userId }) => {
    const safeUserId = String(userId || '').trim()
    if (!safeUserId) {
      throw new Error('userId is required for inventory lookup')
    }

    return requestJson(`/api/inventory${buildQueryString({ user_id: safeUserId })}`, {
      method: 'GET',
    })
  },

  updateInventoryItem: async (itemId, { userId, liters }) => {
    const safeItemId = String(itemId || '').trim()
    const safeUserId = String(userId || '').trim()
    const safeLiters = toFiniteNumber(liters)

    if (!safeItemId || !safeUserId) {
      throw new Error('itemId and userId are required for inventory updates')
    }

    if (safeLiters === null || safeLiters < 0) {
      throw new Error('liters must be a non-negative number')
    }

    return requestJson(`/api/inventory/${encodeURIComponent(safeItemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        user_id: safeUserId,
        liters: safeLiters,
      }),
    })
  },

  getDashboardSummary: async (input) => {
    const userId = String(input?.userId || '').trim()
    const cropType = String(input?.cropType || '').trim()
    const treatmentPlan = String(input?.treatmentPlan || '').trim()
    const farmSizeHectares = toFiniteNumber(input?.farmSizeHectares)
    const survivalProb = toFiniteNumber(input?.survivalProb)

    if (!userId || !cropType || !treatmentPlan) {
      throw new Error('userId, cropType, and treatmentPlan are required for dashboard summary')
    }

    if (farmSizeHectares === null || farmSizeHectares <= 0) {
      throw new Error('farmSizeHectares must be greater than 0')
    }

    if (survivalProb === null || survivalProb < 0 || survivalProb > 1) {
      throw new Error('survivalProb must be between 0 and 1')
    }

    return requestJson('/api/dashboard/summary', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        crop_type: cropType,
        treatment_plan: treatmentPlan,
        farm_size_hectares: farmSizeHectares,
        survival_prob: survivalProb,
        lat: toFiniteNumber(input?.lat),
        lng: toFiniteNumber(input?.lng),
      }),
    })
  },
}
