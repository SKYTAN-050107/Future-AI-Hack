import { gateway } from './gateway'

export async function sendAssistantMessage(input) {
  const response = await gateway.sendAssistantMessage(input)
  return response
}