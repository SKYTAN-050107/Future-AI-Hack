import { gateway } from './gateway'

export async function getDashboardSummary(input) {
  const response = await gateway.getDashboardSummary(input)
  return response
}