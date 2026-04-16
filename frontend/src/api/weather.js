import { gateway } from './gateway'

export async function getWeatherOutlook(input) {
  const response = await gateway.getWeatherOutlook(input)
  return response
}
