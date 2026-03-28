import { gateway } from './gateway'

export async function scanDisease(payload) {
  const response = await gateway.scanDisease(payload)
  return response
}
