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
  const method = String(options?.method || 'GET').toUpperCase()

  console.debug('[API request]', { method, path })
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    })
  } catch {
    throw new Error('Cannot reach diagnosis backend on current origin. Ensure backend proxy is running and retry.')
  }

  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const message = (
      (typeof payload?.error === 'string' ? payload.error : null)
      || payload?.error?.message
      || (typeof payload?.detail === 'string' ? payload.detail : null)
      || payload?.detail?.error
      || `Request failed (${response.status})`
    )
    console.error('[API error]', { method, path, status: response.status, message, payload })
    throw new Error(message)
  }

  console.debug('[API response]', { method, path, status: response.status, payload })

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
        user_id: input?.userId || null,
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
        user_id: input?.userId || null,
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
    const userId = String(input?.userId || '').trim()
    const cropId = String(input?.cropId || '').trim()

    if (!userId) {
      throw new Error('userId is required for treatment plan')
    }

    const body = {
      user_id: userId,
      crop_id: cropId || null,
      disease: String(input?.disease || 'Crop disease risk').trim() || 'Crop disease risk',
      crop_type: String(input?.cropType || input?.cropName || '').trim() || null,
      treatment_plan: String(input?.treatmentPlan || 'recommended treatment').trim() || null,
      farm_size_hectares: toFiniteNumber(input?.farmSizeHectares),
      survival_prob: toFiniteNumber(input?.survivalProb) ?? 1,
      lat: toFiniteNumber(input?.lat),
      lng: toFiniteNumber(input?.lng),
      weatherContext: input?.weatherContext || null,
      treatment_cost_rm: toFiniteNumber(input?.treatmentCostRm),
      selling_channel: String(input?.sellingChannel || 'middleman').trim().toLowerCase(),
      market_condition: String(input?.marketCondition || 'normal').trim().toLowerCase(),
      manual_price_override: toFiniteNumber(input?.manualPriceOverride),
      yield_kg: toFiniteNumber(input?.yieldKg),
      actual_sold_kg: toFiniteNumber(input?.actualSoldKg),
      labor_cost_rm: toFiniteNumber(input?.laborCostRm),
      other_costs_rm: toFiniteNumber(input?.otherCostsRm),
    }

    if (!cropId) {
      const disease = String(input?.disease || '').trim()
      const cropType = String(input?.cropType || '').trim()
      const treatmentPlan = String(input?.treatmentPlan || '').trim()
      const farmSizeHectares = toFiniteNumber(input?.farmSizeHectares)
      const survivalProb = toFiniteNumber(input?.survivalProb)

      if (!disease || !cropType || !treatmentPlan) {
        throw new Error('disease, cropType, and treatmentPlan are required when cropId is not provided')
      }

      if (farmSizeHectares === null || farmSizeHectares <= 0) {
        throw new Error('farmSizeHectares must be greater than 0 when cropId is not provided')
      }

      if (survivalProb === null || survivalProb < 0 || survivalProb > 1) {
        throw new Error('survivalProb must be between 0 and 1')
      }
    }

    return requestJson('/api/treatment', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  getCrops: async ({ userId }) => {
    const safeUserId = String(userId || '').trim()
    if (!safeUserId) {
      throw new Error('userId is required for crops lookup')
    }

    return requestJson(`/api/crops${buildQueryString({ user_id: safeUserId })}`, {
      method: 'GET',
    })
  },

  getCropById: async (cropId, { userId }) => {
    const safeCropId = String(cropId || '').trim()
    const safeUserId = String(userId || '').trim()

    if (!safeCropId || !safeUserId) {
      throw new Error('cropId and userId are required for crop lookup')
    }

    return requestJson(`/api/crops/${encodeURIComponent(safeCropId)}${buildQueryString({ user_id: safeUserId })}`, {
      method: 'GET',
    })
  },

  createCrop: async (payload) => {
    const userId = String(payload?.userId || '').trim()
    const name = String(payload?.name || '').trim()
    const expectedYieldKg = toFiniteNumber(payload?.expectedYieldKg)

    if (!userId || !name || expectedYieldKg === null || expectedYieldKg < 0) {
      throw new Error('userId, name, and expectedYieldKg are required to create a crop')
    }

    const usage = Array.isArray(payload?.cropInventoryUsage)
      ? payload.cropInventoryUsage
      : []

    return requestJson('/api/crops', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId,
        name,
        expected_yield_kg: expectedYieldKg,
        area_hectares: toFiniteNumber(payload?.areaHectares) ?? 0,
        planting_date: String(payload?.plantingDate || '').trim() || null,
        status: String(payload?.status || 'growing').trim().toLowerCase(),
        labor_cost_rm: toFiniteNumber(payload?.laborCostRm) ?? 0,
        other_costs_rm: toFiniteNumber(payload?.otherCostsRm) ?? 0,
        crop_inventory_usage: usage.map((item) => ({
          inventory_id: String(item?.inventoryId || '').trim(),
          quantity_used: toFiniteNumber(item?.quantityUsed) ?? 0,
        })).filter((item) => item.inventory_id),
      }),
    })
  },

  updateCrop: async (cropId, payload) => {
    const safeCropId = String(cropId || '').trim()
    const userId = String(payload?.userId || '').trim()
    if (!safeCropId || !userId) {
      throw new Error('cropId and userId are required to update a crop')
    }

    const usage = Array.isArray(payload?.cropInventoryUsage)
      ? payload.cropInventoryUsage
      : null

    return requestJson(`/api/crops/${encodeURIComponent(safeCropId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        user_id: userId,
        name: payload?.name,
        expected_yield_kg: toFiniteNumber(payload?.expectedYieldKg),
        area_hectares: toFiniteNumber(payload?.areaHectares),
        planting_date: payload?.plantingDate ?? undefined,
        status: payload?.status ? String(payload.status).trim().toLowerCase() : undefined,
        labor_cost_rm: toFiniteNumber(payload?.laborCostRm),
        other_costs_rm: toFiniteNumber(payload?.otherCostsRm),
        crop_inventory_usage: usage
          ? usage.map((item) => ({
            inventory_id: String(item?.inventoryId || '').trim(),
            quantity_used: toFiniteNumber(item?.quantityUsed) ?? 0,
          })).filter((item) => item.inventory_id)
          : undefined,
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

  updateInventoryItem: async (itemId, { userId, liters, description, unitCostRm }) => {
    const safeItemId = String(itemId || '').trim()
    const safeUserId = String(userId || '').trim()
    const safeLiters = toFiniteNumber(liters)
    const hasDescription = description !== undefined && description !== null
    const safeDescription = hasDescription ? String(description).trim() : null

    if (!safeItemId || !safeUserId) {
      throw new Error('itemId and userId are required for inventory updates')
    }

    if (safeLiters === null || safeLiters < 0) {
      throw new Error('liters must be a non-negative number')
    }

    const body = {
      user_id: safeUserId,
      liters: safeLiters,
    }

    if (hasDescription) {
      body.description = safeDescription
    }

    const safeUnitCost = toFiniteNumber(unitCostRm)
    if (safeUnitCost !== null && safeUnitCost >= 0) {
      body.unit_cost_rm = safeUnitCost
    }

    return requestJson(`/api/inventory/${encodeURIComponent(safeItemId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  },

  deleteInventoryItem: async (itemId, { userId }) => {
    const safeItemId = String(itemId || '').trim()
    const safeUserId = String(userId || '').trim()

    if (!safeItemId || !safeUserId) {
      throw new Error('itemId and userId are required for inventory removal')
    }

    return requestJson(`/api/inventory/${encodeURIComponent(safeItemId)}${buildQueryString({ user_id: safeUserId })}`, {
      method: 'DELETE',
    })
  },

  createInventoryItem: async ({ userId, name, quantity, usage, unit, costPerUnitRm }) => {
    const safeUserId = String(userId || '').trim()
    const safeName = String(name || '').trim()
    const safeUsage = String(usage || '').trim()
    const safeUnit = String(unit || '').trim()
    const safeQuantity = toFiniteNumber(quantity)

    if (!safeUserId || !safeName || !safeUsage || !safeUnit) {
      throw new Error('userId, name, usage, and unit are required for inventory creation')
    }

    if (safeQuantity === null || safeQuantity < 0) {
      throw new Error('quantity must be a non-negative number')
    }

    const safeCostPerUnit = toFiniteNumber(costPerUnitRm)

    return requestJson('/api/inventory', {
      method: 'POST',
      body: JSON.stringify({
        user_id: safeUserId,
        name: safeName,
        quantity: safeQuantity,
        usage: safeUsage,
        unit: safeUnit,
        cost_per_unit_rm: safeCostPerUnit !== null && safeCostPerUnit >= 0 ? safeCostPerUnit : 0,
      }),
    })
  },

  getDashboardSummary: async (input) => {
    const userId = String(input?.userId || '').trim()
    const cropType = String(input?.cropType || 'Mixed crop').trim() || 'Mixed crop'
    const treatmentPlan = String(input?.treatmentPlan || 'recommended treatment').trim() || 'recommended treatment'
    const farmSizeInput = toFiniteNumber(input?.farmSizeHectares)
    const survivalInput = toFiniteNumber(input?.survivalProb)

    if (!userId) {
      throw new Error('userId is required for dashboard summary')
    }

    const farmSizeHectares = farmSizeInput !== null && farmSizeInput > 0 ? farmSizeInput : 1
    const survivalProb = survivalInput !== null && survivalInput >= 0 && survivalInput <= 1 ? survivalInput : 1

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

  getMeteorologistAdvisory: async ({ lat, lng, cropType }) => {
    const safeLat = toFiniteNumber(lat)
    const safeLng = toFiniteNumber(lng)

    if (safeLat === null || safeLng === null) {
      throw new Error('lat and lng are required for meteorologist advisory')
    }

    return requestJson('/swarm-api/runAction', {
      method: 'POST',
      body: JSON.stringify({
        key: '/flow/meteorologist_flow',
        input: {
          lat: safeLat,
          lng: safeLng,
          crop_type: String(cropType || 'Rice').trim(),
        },
      }),
    })
  },
}
