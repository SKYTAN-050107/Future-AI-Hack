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
  
  // UI Action states
  const [isCreatingItem, setIsCreatingItem] = useState(false)
  const [isUpdatingItem, setIsUpdatingItem] = useState(false)
  const [isRemovingItem, setIsRemovingItem] = useState(false)

  // Modals state
  const [isAddingItem, setIsAddingItem] = useState(false)
  const [editModalItem, setEditModalItem] = useState(null)

  // Add Item form state
  const [addName, setAddName] = useState('')
  const [addLiters, setAddLiters] = useState('')
  const [addUsage, setAddUsage] = useState('')
  const [addUnit, setAddUnit] = useState('liters')
  const [addCost, setAddCost] = useState('')

  // Edit form state
  const [editLiters, setEditLiters] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editCost, setEditCost] = useState('')

  const isActionBusy = isCreatingItem || isUpdatingItem || isRemovingItem

  async function refreshInventory(userId) {
    const listResponse = await getInventory({ userId })
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
        if (!active) return
        const { nextItems, updatedLabel } = parseInventoryResponse(response)
        setItems(nextItems)
        setLastUpdatedLabel(updatedLabel)
      })
      .catch((loadError) => {
        if (!active) return
        setItems([])
        setLastUpdatedLabel('Unknown')
        setError(loadError?.message || 'Unable to load inventory')
      })

    return () => {
      active = false
    }
  }, [user?.uid])

  // ADD ITEM
  async function handleAddInventory(e) {
    e.preventDefault()
    const userId = String(user?.uid || '').trim()
    if (!userId) {
      setError('Sign in to add inventory.')
      return
    }

    const quantity = Number(addLiters)
    if (!Number.isFinite(quantity) || quantity < 0) {
      setError('Quantity must be a non-negative number.')
      return
    }

    const costPerUnitRm = Number(addCost || 0)
    if (!Number.isFinite(costPerUnitRm) || costPerUnitRm < 0) {
      setError('Cost per unit must be a non-negative number.')
      return
    }

    setIsCreatingItem(true)
    setError('')

    try {
      await createInventoryItem({
        userId,
        name: addName || 'Unnamed Item',
        quantity,
        usage: addUsage || 'general',
        unit: addUnit || 'liters',
        costPerUnitRm,
      })
      await refreshInventory(userId)
      closeAddModal()
    } catch (createError) {
      setError(createError?.message || 'Unable to add inventory item')
    } finally {
      setIsCreatingItem(false)
    }
  }

  // EDIT ITEM
  function openEditModal(item) {
    setEditModalItem(item)
    setEditLiters(String(item.liters))
    setEditDesc(item.description || '')
    setEditCost(String(item.unitCostRm || 0))
    setError('')
  }

  function closeEditModal() {
    setEditModalItem(null)
  }

  function closeAddModal() {
    setIsAddingItem(false)
    setAddName('')
    setAddLiters('')
    setAddUsage('')
    setAddUnit('liters')
    setAddCost('')
  }

  async function handleEditInventory(e) {
    e.preventDefault()
    const userId = String(user?.uid || '').trim()
    if (!userId) {
      setError('Sign in to edit inventory.')
      return
    }

    const liters = Number(editLiters)
    if (!Number.isFinite(liters) || liters < 0) {
      setError('Quantity must be a non-negative number.')
      return
    }

    const unitCostRm = Number(editCost)
    if (!Number.isFinite(unitCostRm) || unitCostRm < 0) {
      setError('Cost per unit must be a non-negative number.')
      return
    }

    setIsUpdatingItem(true)
    setError('')

    try {
      await updateInventoryItem(editModalItem.id, {
        userId,
        liters,
        description: editDesc,
        unitCostRm,
      })
      await refreshInventory(userId)
      closeEditModal()
    } catch (updateError) {
      setError(updateError?.message || 'Unable to edit inventory item')
    } finally {
      setIsUpdatingItem(false)
    }
  }

  // REMOVE ITEM
  async function handleRemoveInventory() {
    const userId = String(user?.uid || '').trim()
    if (!userId) return

    const confirmed = window.confirm(`Remove ${editModalItem.name} from inventory? This cannot be undone.`)
    if (!confirmed) return

    setIsRemovingItem(true)
    setError('')

    try {
      await deleteInventoryItem(editModalItem.id, { userId })
      await refreshInventory(userId)
      closeEditModal()
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

      {error && !editModalItem && !isAddingItem ? (
        <article className="pg-card" style={{ background: 'rgba(var(--danger-rgb), 0.1)', color: 'var(--danger)' }}>
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
        Select any item below to view details and edit stock.
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
              className="pg-inventory-item"
              aria-label={`${item.name}, ${item.liters.toFixed(1)} liters`}
              onClick={() => openEditModal(item)}
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

      {/* Floating Action Button purely for ADDING items */}
      <button
        type="button"
        className="pg-inventory-add-fab pg-inventory-add-fab-main"
        aria-label="Add new inventory item"
        onClick={() => setIsAddingItem(true)}
        disabled={isActionBusy}
        style={{ position: 'fixed', bottom: 90, right: 20, zIndex: 90 }}
      >
        <span className="pg-inventory-add-fab-label"></span>
        <IconPlus className="pg-icon" />
      </button>

      {/* ── Slide-up Modals ── */}

      {/* Add Item Modal */}
      {isAddingItem && (
        <div className="pg-modal-backdrop" onClick={closeAddModal}>
          <div className="pg-modal-drawer pg-modal-drawer-themed" onClick={(e) => e.stopPropagation()}>
            <div className="pg-modal-close-bar" onClick={closeAddModal}></div>
            <h2 style={{ marginTop: 0, marginBottom: 16 }}>Add New Item</h2>
            {error && <p style={{ color: 'var(--danger)', marginBottom: 16 }}>{error}</p>}
            <form onSubmit={handleAddInventory}>
              <label className="pg-field-label">Item Name</label>
              <input required className="pg-input" type="text" value={addName} onChange={e => setAddName(e.target.value)} placeholder="e.g. NPK Fertilizer" />
              
              <label className="pg-field-label">Quantity</label>
              <input required className="pg-input" type="number" step="0.1" min="0" value={addLiters} onChange={e => setAddLiters(e.target.value)} placeholder="e.g. 10.5" />
              
              <label className="pg-field-label">Category / Usage</label>
              <input required className="pg-input" type="text" value={addUsage} onChange={e => setAddUsage(e.target.value)} placeholder="e.g. fertilizer or pesticide" />
              
              <label className="pg-field-label">Unit Code</label>
              <input required className="pg-input" type="text" value={addUnit} onChange={e => setAddUnit(e.target.value)} placeholder="e.g. liters or kg" />
              
              <label className="pg-field-label">Cost Per Unit (RM)</label>
              <input required className="pg-input" type="number" step="0.01" min="0" value={addCost} onChange={e => setAddCost(e.target.value)} placeholder="e.g. 45.00" />
              
              <div className="pg-cta-row" style={{ marginTop: 24 }}>
                <button type="submit" className="pg-btn pg-btn-primary" disabled={isCreatingItem}>
                  {isCreatingItem ? 'Adding...' : 'Add Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit/Details Modal */}
      {editModalItem && (
        <div className="pg-modal-backdrop" onClick={closeEditModal}>
          <div className="pg-modal-drawer pg-modal-drawer-themed" onClick={(e) => e.stopPropagation()}>
            <div className="pg-modal-close-bar" onClick={closeEditModal}></div>
            <h2 style={{ marginTop: 0, marginBottom: 16 }}>{editModalItem.name}</h2>
            {error && <p style={{ color: 'var(--danger)', marginBottom: 16 }}>{error}</p>}

            <form onSubmit={handleEditInventory}>
              <p style={{ margin: '0 0 16px', opacity: 0.8, fontSize: '0.9rem' }}>
                Category: <strong>{editModalItem.category}</strong>
              </p>

              <label className="pg-field-label">Stock Quantity (Liters/Kg)</label>
              <input required className="pg-input" type="number" step="0.1" min="0" value={editLiters} onChange={e => setEditLiters(e.target.value)} />

              <label className="pg-field-label">Description (Optional)</label>
              <input className="pg-input" type="text" value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Usage notes" />
              
              <label className="pg-field-label">Cost Per Unit (RM)</label>
              <input required className="pg-input" type="number" step="0.01" min="0" value={editCost} onChange={e => setEditCost(e.target.value)} />

              <div className="pg-cta-row" style={{ marginTop: 40, flexDirection: 'column', gap: 12 }}>
                <button type="submit" className="pg-btn pg-btn-primary" style={{ width: '100%' }} disabled={isUpdatingItem || isRemovingItem}>
                  {isUpdatingItem ? 'Saving...' : 'Save Changes'}
                </button>
                <button 
                  type="button" 
                  className="pg-btn pg-btn-danger-soft"
                  style={{ width: '100%' }}
                  onClick={handleRemoveInventory} 
                  disabled={isUpdatingItem || isRemovingItem}
                >
                  {isRemovingItem ? 'Deleting...' : 'Delete Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
