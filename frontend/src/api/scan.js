import { gateway } from './gateway'

export async function scanDisease(payload) {
  const response = await gateway.scanDisease(payload)
  return response
}

export async function scanAndAskAssistant(payload) {
  const response = await gateway.scanAndAskAssistant(payload)
  return response
}
