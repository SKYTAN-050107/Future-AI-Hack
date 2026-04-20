import { gateway } from './gateway'

let _cachedTreatmentPlanSnapshot = null

function cloneSerializable(value) {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value

  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

export function getCachedTreatmentPlan(userId) {
  const safeUserId = String(userId || '').trim()
  if (!safeUserId || !_cachedTreatmentPlanSnapshot) {
    return null
  }

  if (String(_cachedTreatmentPlanSnapshot.userId || '').trim() !== safeUserId) {
    return null
  }

  return {
    userId: safeUserId,
    input: cloneSerializable(_cachedTreatmentPlanSnapshot.input),
    plan: cloneSerializable(_cachedTreatmentPlanSnapshot.plan),
    updatedAt: Number(_cachedTreatmentPlanSnapshot.updatedAt) || Date.now(),
    refreshedAt: Number(_cachedTreatmentPlanSnapshot.refreshedAt) || 0,
  }
}

export function setCachedTreatmentPlan({ userId, input, plan, refreshedAt }) {
  const safeUserId = String(userId || '').trim()
  if (!safeUserId || !input || typeof input !== 'object' || !plan || typeof plan !== 'object') {
    return null
  }

  _cachedTreatmentPlanSnapshot = {
    userId: safeUserId,
    input: cloneSerializable(input),
    plan: cloneSerializable(plan),
    updatedAt: Date.now(),
    refreshedAt: Number(refreshedAt) || 0,
  }

  return getCachedTreatmentPlan(safeUserId)
}

export function clearCachedTreatmentPlan(userId) {
  const safeUserId = String(userId || '').trim()
  if (!safeUserId) {
    _cachedTreatmentPlanSnapshot = null
    return
  }

  if (String(_cachedTreatmentPlanSnapshot?.userId || '').trim() === safeUserId) {
    _cachedTreatmentPlanSnapshot = null
  }
}

export async function getTreatmentPlan(input) {
  const response = await gateway.getTreatmentPlan(input)
  return response
}
