import { gateway } from './gateway'

export async function getCrops(input) {
  const response = await gateway.getCrops(input)
  return response
}

export async function getCropById(cropId, input) {
  const response = await gateway.getCropById(cropId, input)
  return response
}

export async function createCrop(payload) {
  const response = await gateway.createCrop(payload)
  return response
}

export async function updateCrop(cropId, payload) {
  const response = await gateway.updateCrop(cropId, payload)
  return response
}
