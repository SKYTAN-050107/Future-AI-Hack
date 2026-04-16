import { gateway } from './gateway'

export async function getInventory(input) {
  const response = await gateway.getInventory(input)
  return response
}

export async function updateInventoryItem(itemId, payload) {
  const response = await gateway.updateInventoryItem(itemId, payload)
  return response
}