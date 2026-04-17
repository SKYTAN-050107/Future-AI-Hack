import { useEffect, useMemo, useState } from 'react'
import {
  IconBug,
  IconChevronRight,
  IconPlus,
  IconShieldLeaf,
  IconSprout,
} from '../../components/icons/UiIcons'
import SectionHeader from '../../components/ui/SectionHeader'
import {
  createInventoryItem,
  deleteInventoryItem,
  getInventory,
  updateInventoryItem,
} from '../../api/inventory'
import { useSessionContext } from '../../hooks/useSessionContext'

const FILTERS = ['All', 'Pesticides', 'Fungicides', 'Fertilizers']

function normalizeInventoryItem(rawItem) {
  const liters = Number(rawItem?.liters)
  const unitCostRm = Number(rawItem?.unit_cost_rm)

  return {
    id: String(rawItem?.id || ''),
    name: String(rawItem?.name || 'Unnamed Item'),
    description: String(rawItem?.description || '').trim(),
    category: String(rawItem?.category || 'Uncategorized'),
    liters: Number.isFinite(liters) ? liters : 0,
    unitCostRm: Number.isFinite(unitCostRm) ? unitCostRm : 0,
  }
}

function formatLastUpdated(value) {
  if (!value) {
    return 'Unknown'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown'
  }

  return new Intl.DateTimeFormat('en-MY', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

function getStockTone(liters) {
  if (liters < 2) {
    return 'critical'
  }

  if (liters <= 5) {
    return 'warning'
  }

  return 'healthy'
}

function getCategoryIcon(category) {
  if (category === 'Pesticides') {
    return IconBug
  }

  if (category === 'Fungicides') {
    return IconShieldLeaf
  }

  return IconSprout
}

function parseInventoryResponse(response) {
  const nextItems = Array.isArray(response?.items)
    ? response.items.map(normalizeInventoryItem)
    : []

  return {
    nextItems,
    updatedLabel: formatLastUpdated(response?.last_updated_iso),
  }
}

export default function Inventory() {
  const { user } = useSessionContext()
  const [activeFilter, setActiveFilter] = useState('All')
  const [items, setItems] = useState([])
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState('Unknown')
  const [error, setError] = useState('')
  const [isCreatingItem, setIsCreatingItem] = useState(false)
  const [isUpdatingItem, setIsUpdatingItem] = useState(false)
  const [isRemovingItem, setIsRemovingItem] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState('')
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false)

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) || null,
    [items, selectedItemId],
  )

  const isActionBusy = isCreatingItem || isUpdatingItem || isRemovingItem

  useEffect(() => {
    if (!selectedItemId) {
      return
    }

    const stillExists = items.some((item) => item.id === selectedItemId)
    if (!stillExists) {
      setSelectedItemId('')
    }
  }, [items, selectedItemId])

  async function refreshInventory(userId) {
    const listResponse = await getInventory({ userId })
    console.log('[Inventory API] refreshed list response', listResponse)

    const { nextItems, updatedLabel } = parseInventoryResponse(listResponse)
    setItems(nextItems)
    setLastUpdatedLabel(updatedLabel)
  }

  useEffect(() => {
    let active = true
    const userId = String(user?.uid || '').trim()

    if (!userId) {
      setItems([])
      setLastUpdatedLabel('Unknown')
      setError('Sign in to load inventory.')
      return undefined
    }

    setError('')
    getInventory({ userId })
      .then((response) => {
        if (!active) {
          return
        }

        console.log('[Inventory API] list response', response)

        const { nextItems, updatedLabel } = parseInventoryResponse(response)
        setItems(nextItems)
        setLastUpdatedLabel(updatedLabel)
      })
      .catch((loadError) => {
        if (!active) {
          return
        }

        setItems([])
        setLastUpdatedLabel('Unknown')
        setError(loadError?.message || 'Unable to load inventory')
      })

    return () => {
      active = false
    }
  }, [user?.uid])

  async function handleAddInventory() {
    const userId = String(user?.uid || '').trim()
    if (!userId) {
      setError('Sign in to add inventory.')
      return
    }

    const name = window.prompt('Inventory name')
    if (name === null) {
      return
    }

    const quantityRaw = window.prompt('Quantity (number)')
    if (quantityRaw === null) {
      return
    }

    const usage = window.prompt('Usage (e.g. fertilizer, pesticide)')
    if (usage === null) {
      return
    }

    const unit = window.prompt('Unit (e.g. liters, kg)')
    if (unit === null) {
      return
    }

    const costPerUnitRaw = window.prompt('Cost per unit (RM)', '0')
    if (costPerUnitRaw === null) {
      return
    }

    const quantity = Number(quantityRaw)
    if (!Number.isFinite(quantity) || quantity < 0) {
      setError('Quantity must be a non-negative number.')
      return
    }

    const costPerUnitRm = Number(costPerUnitRaw)
    if (!Number.isFinite(costPerUnitRm) || costPerUnitRm < 0) {
      setError('Cost per unit must be a non-negative number.')
      return
    }

    setIsCreatingItem(true)
    setError('')
    setIsActionMenuOpen(false)

    try {
      const createResponse = await createInventoryItem({
        userId,
        name,
        quantity,
        usage,
        unit,
        costPerUnitRm,
      })
      console.log('[Inventory API] create response', createResponse)
      await refreshInventory(userId)
    } catch (createError) {
      setError(createError?.message || 'Unable to add inventory item')
    } finally {
      setIsCreatingItem(false)
    }
  }

  async function handleEditInventory() {
    const userId = String(user?.uid || '').trim()
    if (!userId) {
      setError('Sign in to edit inventory.')
      return
    }

    if (!selectedItem) {
      setError('Select an inventory item to edit.')
      return
    }

    const quantityRaw = window.prompt(
      `New quantity for ${selectedItem.name} (liters)`,
      String(selectedItem.liters),
    )

    if (quantityRaw === null) {
      return
    }

    const descriptionRaw = window.prompt(
      `Description for ${selectedItem.name}`,
      selectedItem.description || '',
    )

    if (descriptionRaw === null) {
      return
    }

    const liters = Number(quantityRaw)
    if (!Number.isFinite(liters) || liters < 0) {
      setError('Quantity must be a non-negative number.')
      return
    }

    const description = String(descriptionRaw).trim()

    const unitCostRaw = window.prompt(
      `Cost per liter for ${selectedItem.name} (RM)`,
      String(selectedItem.unitCostRm || 0),
    )

    if (unitCostRaw === null) {
      return
    }

    const unitCostRm = Number(unitCostRaw)
    if (!Number.isFinite(unitCostRm) || unitCostRm < 0) {
      setError('Cost per unit must be a non-negative number.')
      return
    }

    setIsUpdatingItem(true)
    setError('')
    setIsActionMenuOpen(false)

    try {
      const updateResponse = await updateInventoryItem(selectedItem.id, {
        userId,
        liters,
        description,
        unitCostRm,
      })
      console.log('[Inventory API] update response', updateResponse)
      await refreshInventory(userId)
    } catch (updateError) {
      setError(updateError?.message || 'Unable to edit inventory item')
    } finally {
      setIsUpdatingItem(false)
    }
  }

  async function handleRemoveInventory() {
    const userId = String(user?.uid || '').trim()
    if (!userId) {
      setError('Sign in to remove inventory.')
      return
    }

    if (!selectedItem) {
      setError('Select an inventory item to remove.')
      return
    }

    const confirmed = window.confirm(`Remove ${selectedItem.name} from inventory?`)
    if (!confirmed) {
      return
    }

    setIsRemovingItem(true)
    setError('')
    setIsActionMenuOpen(false)

    try {
      const deleteResponse = await deleteInventoryItem(selectedItem.id, { userId })
      console.log('[Inventory API] delete response', deleteResponse)
      await refreshInventory(userId)
      setSelectedItemId('')
    } catch (removeError) {
      setError(removeError?.message || 'Unable to remove inventory item')
    } finally {
      setIsRemovingItem(false)
    }
  }

  const lowStockCount = useMemo(
    () => items.filter((item) => item.liters < 5).length,
    [items],
  )

  const visibleItems = useMemo(
    () => (activeFilter === 'All'
      ? items
      : items.filter((item) => item.category === activeFilter)),
    [activeFilter, items],
  )

  return (
    <section className="pg-page pg-inventory-page" aria-label="Chemical inventory">
      <SectionHeader title="Inventory" align="center" />

      {error ? (
        <article className="pg-card">
          <p>{error}</p>
        </article>
      ) : null}

      <div className="pg-inventory-stat-row" aria-label="Inventory quick statistics">
        <span className="pg-inventory-stat-chip">Total Items: {items.length}</span>
        <span className="pg-inventory-stat-chip pg-inventory-stat-chip-alert">Low Stock: {lowStockCount}</span>
        <span className="pg-inventory-stat-chip">Last Updated: {lastUpdatedLabel}</span>
      </div>

      <div className="pg-inventory-filter-row" role="tablist" aria-label="Filter inventory category">
        {FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            className={`pg-inventory-filter-pill ${filter === activeFilter ? 'is-active' : ''}`}
            onClick={() => setActiveFilter(filter)}
            role="tab"
            aria-selected={filter === activeFilter}
          >
            {filter}
          </button>
        ))}
      </div>

      <p className="pg-inventory-selected-note" aria-live="polite">
        {selectedItem
          ? `Selected: ${selectedItem.name}. Use View more to edit or remove it.`
          : 'Select an item, then tap View more to edit or remove it.'}
      </p>

      <div className="pg-inventory-list" aria-live="polite">
        {visibleItems.length === 0 ? (
          <article className="pg-card">
            <p>{error ? 'Inventory unavailable.' : 'No inventory items found.'}</p>
          </article>
        ) : null}

        {visibleItems.map((item) => {
          const stockTone = getStockTone(item.liters)
          const ItemIcon = getCategoryIcon(item.category)
          const isLowStock = item.liters < 5

          return (
            <button
              key={item.id}
              type="button"
              className={`pg-inventory-item ${selectedItemId === item.id ? 'is-selected' : ''}`}
              aria-label={`${item.name}, ${item.liters.toFixed(1)} liters`}
              aria-pressed={selectedItemId === item.id}
              onClick={() => {
                setSelectedItemId(item.id)
                setError('')
              }}
            >
              <span className="pg-inventory-item-icon" aria-hidden="true">
                <ItemIcon className="pg-icon" />
              </span>

              <div className="pg-inventory-item-content">
                <div className="pg-inventory-item-header">
                  <p className="pg-inventory-item-name">{item.name}</p>
                  <span className={`pg-inventory-status-badge ${isLowStock ? 'is-low' : 'is-ok'}`}>
                    {isLowStock ? 'Low Stock' : 'In Stock'}
                  </span>
                </div>

                {item.description ? (
                  <p className="pg-inventory-item-description">{item.description}</p>
                ) : null}

                <div className="pg-inventory-progress" role="img" aria-label={`Stock ${item.liters.toFixed(1)} liters out of 10`}>
                  <span
                    className={`pg-inventory-progress-fill is-${stockTone}`}
                    style={{ width: `${Math.min(100, (item.liters / 10) * 100)}%` }}
                  />
                </div>

                <div className="pg-inventory-item-meta">
                  <span>{item.liters.toFixed(1)} Liters</span>
                  <span>{item.category}</span>
                  <span>RM {item.unitCostRm.toFixed(2)}/L</span>
                </div>
              </div>

              <IconChevronRight className="pg-icon pg-inventory-chevron" />
            </button>
          )
        })}
      </div>

      <div className={`pg-inventory-fab-stack ${isActionMenuOpen ? 'is-open' : ''}`}>
        <div
          id="pg-inventory-fab-actions"
          className="pg-inventory-fab-actions"
          aria-hidden={!isActionMenuOpen}
        >
          <button
            type="button"
            className="pg-inventory-fab-action"
            onClick={handleAddInventory}
            disabled={isActionBusy}
          >
            Add
          </button>
          <button
            type="button"
            className="pg-inventory-fab-action"
            onClick={handleEditInventory}
            disabled={isActionBusy || !selectedItem}
          >
            Edit
          </button>
          <button
            type="button"
            className="pg-inventory-fab-action is-danger"
            onClick={handleRemoveInventory}
            disabled={isActionBusy || !selectedItem}
          >
            Remove
          </button>
        </div>

        <button
          type="button"
          className="pg-inventory-add-fab pg-inventory-add-fab-main"
          aria-label="View more inventory actions"
          aria-expanded={isActionMenuOpen}
          aria-controls="pg-inventory-fab-actions"
          onClick={() => setIsActionMenuOpen((open) => !open)}
          disabled={isActionBusy}
        >
          <span className="pg-inventory-add-fab-label"></span>
          <IconPlus className={`pg-icon pg-inventory-fab-toggle-icon ${isActionMenuOpen ? 'is-open' : ''}`} />
        </button>
      </div>
    </section>
  )
}
