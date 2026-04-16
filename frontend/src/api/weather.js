import { gateway } from './gateway'

export async function getWeatherOutlook(input) {
  const response = await gateway.getWeatherOutlook(input)
  return response
}

export async function getMeteorologistAdvisory(input) {
  const response = await gateway.getMeteorologistAdvisory(input)
  return response
}
