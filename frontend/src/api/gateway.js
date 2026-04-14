const delay = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms))
const DEFAULT_BACKEND_URL = 'http://localhost:8000'
const BACKEND_URL = String(import.meta.env.VITE_DIAGNOSIS_API_URL || DEFAULT_BACKEND_URL).replace(/\/+$/, '')

async function withMock(payload) {
  await delay()
  return { ...payload, __source: 'mock' }
}

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

export const gateway = {
  health: async () => requestJson('/health', { method: 'GET' }),

  getFleetSummary: async () => withMock({
    total_batteries: 0,
    avg_soh: 0,
    avg_rul: 0,
    active_alerts: 0,
  }),

  getFleetAlerts: async () => withMock({ alerts: [] }),

  uploadCsv: async (file) => withMock({
    uploaded: Boolean(file),
    filename: file?.name || null,
    rows: 0,
  }),

  getBattery: async (id) => withMock({
    cell_id: id,
    SOH: [],
    RUL: [],
    points: [],
  }),

  getBatteryRisk: async () => withMock({ breakdown: [] }),

  getBatteryScorecard: async (id) => withMock({
    cell_id: id,
    soc_score: 0,
    soh_score: 0,
    recommended_policy_tier: '-',
    maintenance_flag: false,
  }),

  getInsuranceQuote: async (id) => withMock({
    cell_id: id,
    policy_tier: '-',
    base_insured_amount: '-',
    recommended_insured_amount: '-',
    premium_rate_percent: 0,
    estimated_annual_premium: '-',
    notes: 'Mock quote data',
  }),

  getInsurancePackages: async () => withMock({ packages: [] }),

  getWeatherOutlook: async () => withMock({
    rain_probability: 76,
    best_spray_window: 'Today 3:00 PM - 5:00 PM',
    advisory: 'Avoid spraying tomorrow morning due to high rain intensity.',
  }),

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

  getTreatmentPlan: async () => withMock({
    recommendation: 'Apply tricyclazole at 0.6 kg/ha before evening rain window.',
    estimated_cost_rm: 110,
    expected_gain_rm: 640,
    roi_x: 5.8,
    organic_alternative: 'Neem extract for low-severity sectors with follow-up scan in 48h.',
  }),
}
