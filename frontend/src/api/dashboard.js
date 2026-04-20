import { gateway } from './gateway'

// ── Dashboard Summary Cache ──────────────────────────────
let cachedSummary = null;
let cachedInputStr = null;

export function getCachedDashboardSummary(input) {
  const inputStr = JSON.stringify(input || {});
  if (cachedInputStr === inputStr && cachedSummary) {
    return cachedSummary;
  }
  return null;
}

export async function getDashboardSummary(input) {
  const response = await gateway.getDashboardSummary(input)
  cachedSummary = response;
  cachedInputStr = JSON.stringify(input || {});
  return response
}

// ── Crops Cache ──────────────────────────────────────────
// Module-level cache so crop data persists across page navigations.
let cachedCropsUserId = null;
let cachedCropsResponse = null;

export function getCachedCrops(userId) {
  const safeId = String(userId || '').trim();
  if (safeId && cachedCropsUserId === safeId && cachedCropsResponse) {
    return cachedCropsResponse;
  }
  return null;
}

export function clearCropsCache() {
  cachedCropsUserId = null;
  cachedCropsResponse = null;
}