const TREATMENT_ROI_CACHE_KEY = 'padiguard_treatment_roi_snapshot_v1'
const TREATMENT_FORM_CACHE_KEY = 'padiguard_treatment_form_snapshot_v1'
export const TREATMENT_ROI_CACHE_UPDATED_EVENT = 'padiguard:treatment-roi-cache-updated'

function toFiniteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readSnapshot() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(TREATMENT_ROI_CACHE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function writeSnapshot(snapshot) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(TREATMENT_ROI_CACHE_KEY, JSON.stringify(snapshot))
    window.dispatchEvent(new CustomEvent(TREATMENT_ROI_CACHE_UPDATED_EVENT, { detail: snapshot }))
  } catch {
    // Ignore storage write failures (quota/private mode) and continue without cache sync.
  }
}

function readFormSnapshot() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(TREATMENT_FORM_CACHE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function writeFormSnapshot(snapshot) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(TREATMENT_FORM_CACHE_KEY, JSON.stringify(snapshot))
  } catch {
    // Ignore storage write failures (quota/private mode) and continue without cache sync.
  }
}

export function saveTreatmentRoiSnapshot({ userId, plan }) {
  const safeUserId = String(userId || '').trim()
  if (!safeUserId || !plan || typeof plan !== 'object') {
    return
  }

  const expectedGain = toFiniteNumber(plan.expected_gain_rm)
  const treatmentCost = toFiniteNumber(plan.estimated_cost_rm)
  const profit = toFiniteNumber(plan.profit_rm)
  const roiPercent = toFiniteNumber(plan.roi_percent)

  if (expectedGain === null || treatmentCost === null) {
    return
  }

  const snapshot = {
    userId: safeUserId,
    updatedAt: new Date().toISOString(),
    financialSummary: {
      roiPercent: roiPercent ?? 0,
      projectedRoiValueRm: profit ?? (expectedGain - treatmentCost),
      projectedYieldGainRm: expectedGain,
      treatmentCostRm: treatmentCost,
    },
  }

  writeSnapshot(snapshot)
}

export function getTreatmentRoiSnapshot(userId) {
  const safeUserId = String(userId || '').trim()
  if (!safeUserId) {
    return null
  }

  const snapshot = readSnapshot()
  if (!snapshot || String(snapshot.userId || '').trim() !== safeUserId) {
    return null
  }

  const financialSummary = snapshot.financialSummary
  if (!financialSummary || typeof financialSummary !== 'object') {
    return null
  }

  return financialSummary
}

export function saveTreatmentFormSnapshot({ userId, cropId, values, plan }) {
  const safeUserId = String(userId || '').trim()
  const safeCropId = String(cropId || '').trim()
  if (!safeUserId || !safeCropId || !values || typeof values !== 'object') {
    return
  }

  const existing = readFormSnapshot()
  const sameUser = String(existing?.userId || '').trim() === safeUserId
  const existingFormsByCrop = sameUser && typeof existing?.formsByCrop === 'object'
    ? existing.formsByCrop
    : {}
  const existingValues = typeof existingFormsByCrop[safeCropId] === 'object' && existingFormsByCrop[safeCropId]
    ? existingFormsByCrop[safeCropId]
    : {}

  const nextFormValues = {
    yieldKg: toFiniteNumber(values.yieldKg) ?? 0,
    actualSoldKg: toFiniteNumber(values.actualSoldKg) ?? 0,
    laborCostRm: toFiniteNumber(values.laborCostRm) ?? 0,
    otherCostsRm: toFiniteNumber(values.otherCostsRm) ?? 0,
    sellingChannel: String(values.sellingChannel || 'middleman').trim().toLowerCase() || 'middleman',
    marketCondition: String(values.marketCondition || 'normal').trim().toLowerCase() || 'normal',
    manualPriceOverride: String(values.manualPriceOverride ?? ''),
    hasManualYieldInput: Boolean(values.hasManualYieldInput),
    hasManualActualSoldInput: Boolean(values.hasManualActualSoldInput),
    plan: plan && typeof plan === 'object' ? plan : null,
  }

  if (typeof values.actualSoldKgInput === 'string') {
    nextFormValues.actualSoldKgInput = values.actualSoldKgInput
  } else if (typeof existingValues.actualSoldKgInput === 'string') {
    nextFormValues.actualSoldKgInput = existingValues.actualSoldKgInput
  }

  if (typeof values.laborCostRmInput === 'string') {
    nextFormValues.laborCostRmInput = values.laborCostRmInput
  } else if (typeof existingValues.laborCostRmInput === 'string') {
    nextFormValues.laborCostRmInput = existingValues.laborCostRmInput
  }

  if (typeof values.otherCostsRmInput === 'string') {
    nextFormValues.otherCostsRmInput = values.otherCostsRmInput
  } else if (typeof existingValues.otherCostsRmInput === 'string') {
    nextFormValues.otherCostsRmInput = existingValues.otherCostsRmInput
  }

  writeFormSnapshot({
    userId: safeUserId,
    selectedCropId: safeCropId,
    updatedAt: new Date().toISOString(),
    formsByCrop: {
      ...existingFormsByCrop,
      [safeCropId]: nextFormValues,
    },
  })
}

export function getTreatmentFormSnapshot(userId, cropId) {
  const safeUserId = String(userId || '').trim()
  if (!safeUserId) {
    return null
  }

  const snapshot = readFormSnapshot()
  if (!snapshot || String(snapshot.userId || '').trim() !== safeUserId) {
    return null
  }

  const selectedCropId = String(snapshot.selectedCropId || '').trim() || null
  const formsByCrop = typeof snapshot.formsByCrop === 'object' && snapshot.formsByCrop
    ? snapshot.formsByCrop
    : {}
  const requestedCropId = String(cropId || '').trim()
  const resolvedCropId = requestedCropId || selectedCropId || ''
  const values = resolvedCropId && typeof formsByCrop[resolvedCropId] === 'object'
    ? formsByCrop[resolvedCropId]
    : null

  return {
    selectedCropId,
    values,
  }
}
