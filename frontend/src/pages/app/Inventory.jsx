import { useEffect, useMemo, useState } from 'react'
import {
  IconBug,
  IconChevronRight,
  IconPlus,
  IconShieldLeaf,
  IconSprout,
} from '../../components/icons/UiIcons'
import SectionHeader from '../../components/ui/SectionHeader'
import { createInventoryItem, getInventory } from '../../api/inventory'
import { useSessionContext } from '../../hooks/useSessionContext'

const FILTERS = ['All', 'Pesticides', 'Fungicides', 'Fertilizers']

function normalizeInventoryItem(rawItem) {
  const liters = Number(rawItem?.liters)

  return {
    id: String(rawItem?.id || ''),
    name: String(rawItem?.name || 'Unnamed Item'),
    category: String(rawItem?.category || 'Uncategorized'),
    liters: Number.isFinite(liters) ? liters : 0,
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

export default function Inventory() {
  const { user } = useSessionContext()
  const [activeFilter, setActiveFilter] = useState('All')
  const [items, setItems] = useState([])
  const [lastUpdatedLabel, setLastUpdatedLabel] = useState('Unknown')
  const [error, setError] = useState('')
  const [isCreatingItem, setIsCreatingItem] = useState(false)

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

        const nextItems = Array.isArray(response?.items)
          ? response.items.map(normalizeInventoryItem)
          : []
        setItems(nextItems)
        setLastUpdatedLabel(formatLastUpdated(response?.last_updated_iso))
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

    const quantity = Number(quantityRaw)
    if (!Number.isFinite(quantity) || quantity < 0) {
      setError('Quantity must be a non-negative number.')
      return
    }

    setIsCreatingItem(true)
    setError('')

    try {
      const createResponse = await createInventoryItem({
        userId,
        name,
        quantity,
        usage,
        unit,
      })
      console.log('[Inventory API] create response', createResponse)

      const listResponse = await getInventory({ userId })
      console.log('[Inventory API] refreshed list response', listResponse)

      const nextItems = Array.isArray(listResponse?.items)
        ? listResponse.items.map(normalizeInventoryItem)
        : []

      setItems(nextItems)
      setLastUpdatedLabel(formatLastUpdated(listResponse?.last_updated_iso))
    } catch (createError) {
      setError(createError?.message || 'Unable to add inventory item')
    } finally {
      setIsCreatingItem(false)
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
              className="pg-inventory-item"
              aria-label={`${item.name}, ${item.liters.toFixed(1)} liters`}
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

                <div className="pg-inventory-progress" role="img" aria-label={`Stock ${item.liters.toFixed(1)} liters out of 10`}>
                  <span
                    className={`pg-inventory-progress-fill is-${stockTone}`}
                    style={{ width: `${Math.min(100, (item.liters / 10) * 100)}%` }}
                  />
                </div>

                <div className="pg-inventory-item-meta">
                  <span>{item.liters.toFixed(1)} Liters</span>
                  <span>{item.category}</span>
                </div>
              </div>

              <IconChevronRight className="pg-icon pg-inventory-chevron" />
            </button>
          )
        })}
      </div>

      <button
        type="button"
        className="pg-inventory-add-fab"
        aria-label="Add inventory item"
        onClick={handleAddInventory}
        disabled={isCreatingItem}
      >
        <IconPlus className="pg-icon" />
      </button>
    </section>
  )
}
