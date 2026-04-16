import { gateway } from './gateway'

export async function getInventory(input) {
  const response = await gateway.getInventory(input)
  return response
}

export async function updateInventoryItem(itemId, payload) {
  const response = await gateway.updateInventoryItem(itemId, payload)
  return response
}

export async function createInventoryItem(payload) {
  const response = await gateway.createInventoryItem(payload)
  return response
}