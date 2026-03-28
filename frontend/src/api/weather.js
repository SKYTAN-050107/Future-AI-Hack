import { gateway } from './gateway'

export async function getWeatherOutlook() {
  const response = await gateway.getWeatherOutlook()
  return response
}
