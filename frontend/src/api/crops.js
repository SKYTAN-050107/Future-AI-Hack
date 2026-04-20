import { gateway } from './gateway'
import { getCachedCrops } from './dashboard'

// Module-level cache for crops – populated on first fetch, reused on re-navigation.
let _cropsCacheUserId = null
let _cropsCacheResponse = null

export async function getCrops(input) {
  const userId = String(input?.userId || '').trim()

  // Return module-level cache if available
  if (userId && _cropsCacheUserId === userId && _cropsCacheResponse) {
    return _cropsCacheResponse
  }

  // Also check the dashboard-level cache
  const dashboardCached = getCachedCrops(userId)
  if (dashboardCached) {
    _cropsCacheUserId = userId
    _cropsCacheResponse = dashboardCached
    return dashboardCached
  }

  const response = await gateway.getCrops(input)

  // Cache the response
  _cropsCacheUserId = userId
  _cropsCacheResponse = response

  return response
}

export async function getCropById(cropId, input) {
  const response = await gateway.getCropById(cropId, input)
  return response
}

export async function createCrop(payload) {
  const response = await gateway.createCrop(payload)
  // Invalidate cache when crops change
  _cropsCacheUserId = null
  _cropsCacheResponse = null
  return response
}

export async function updateCrop(cropId, payload) {
  const response = await gateway.updateCrop(cropId, payload)
  // Invalidate cache when crops change
  _cropsCacheUserId = null
  _cropsCacheResponse = null
  return response
}

export async function deleteCrop(cropId, payload) {
  const response = await gateway.deleteCrop(cropId, payload)
  // Invalidate cache when crops change
  _cropsCacheUserId = null
  _cropsCacheResponse = null
  return response
}
