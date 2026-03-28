import { gateway } from './gateway'

export async function getTreatmentPlan(input) {
  const response = await gateway.getTreatmentPlan(input)
  return response
}
