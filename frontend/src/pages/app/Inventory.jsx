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

const CATEGORY_OPTIONS = ['Pesticides', 'Fungicides', 'Fertilizers']

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
  const lc = (category || '').toLowerCase()
  if (lc.includes('pesticide')) return IconBug
  if (lc.includes('fungicide')) return IconShieldLeaf
  return IconSprout
}

function getCategoryColor(category) {
  const lc = (category || '').toLowerCase()
  if (lc.includes('pesticide')) return { bg: 'rgba(239, 68, 68, 0.12)', border: 'rgba(239, 68, 68, 0.25)', color: '#DC2626', darkColor: '#FCA5A5' }
  if (lc.includes('fungicide')) return { bg: 'rgba(99, 102, 241, 0.12)', border: 'rgba(99, 102, 241, 0.25)', color: '#4F46E5', darkColor: '#A5B4FC' }
  return { bg: 'rgba(16, 185, 129, 0.12)', border: 'rgba(16, 185, 129, 0.25)', color: '#059669', darkColor: '#6EE7B7' }
}

function fuzzyMatchCategory(category, query) {
  if (!query.trim()) return true
  const cat = (category || '').toLowerCase()
  const q = query.trim().toLowerCase()
  if (cat.includes(q)) return true
  // token-based: every word in query must appear in category
  return q.split(/\s+/).every(token => cat.includes(token))
}

function matchesFilter(itemCategory, filter) {
  if (filter === 'All') return true
  const itemLc = (itemCategory || '').toLowerCase()
  const filterLc = filter.toLowerCase()
  return itemLc === filterLc || itemLc.includes(filterLc.replace(/s$/, ''))
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
  const [categorySearch, setCategorySearch] = useState('')
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
  const [addCategory, setAddCategory] = useState('Pesticides')
  const [addCustomCategory, setAddCustomCategory] = useState('')
  const [addDesc, setAddDesc] = useState('')
  const [addUnit, setAddUnit] = useState('liters')
  const [addCost, setAddCost] = useState('')

  // Edit form state
  const [editName, setEditName] = useState('')
  const [editLiters, setEditLiters] = useState('')
  const [editCategory, setEditCategory] = useState('Pesticides')
  const [editCustomCategory, setEditCustomCategory] = useState('')
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

    const resolvedCategory = addCategory === 'Other'
      ? (addCustomCategory.trim() || 'Uncategorized')
      : addCategory

    try {
      await createInventoryItem({
        userId,
        name: addName || 'Unnamed Item',
        quantity,
        usage: resolvedCategory,
        unit: addUnit || 'liters',
        costPerUnitRm,
        description: addDesc.trim() || '',
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
    setEditName(item.name || '')
    setEditLiters(String(item.liters))
    setEditDesc(item.description || '')
    setEditCost(String(item.unitCostRm || 0))
    // Set category dropdown
    if (CATEGORY_OPTIONS.includes(item.category)) {
      setEditCategory(item.category)
      setEditCustomCategory('')
    } else {
      setEditCategory('Other')
      setEditCustomCategory(item.category || '')
    }
    setError('')
  }

  function closeEditModal() {
    setEditModalItem(null)
  }

  function closeAddModal() {
    setIsAddingItem(false)
    setAddName('')
    setAddLiters('')
    setAddCategory('Pesticides')
    setAddCustomCategory('')
    setAddDesc('')
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

    const resolvedEditCategory = editCategory === 'Other'
      ? (editCustomCategory.trim() || 'Uncategorized')
      : editCategory

    setIsUpdatingItem(true)
    setError('')

    try {
      await updateInventoryItem(editModalItem.id, {
        userId,
        name: editName.trim() || editModalItem.name,
        liters,
        description: editDesc,
        unitCostRm,
        category: resolvedEditCategory,
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

  const totalValue = useMemo(
    () => items.reduce((sum, item) => sum + item.liters * item.unitCostRm, 0),
    [items],
  )

  const visibleItems = useMemo(
    () => items
      .filter((item) => activeFilter === 'All' || matchesFilter(item.category, activeFilter))
      .filter((item) => fuzzyMatchCategory(item.category, categorySearch)),
    [activeFilter, categorySearch, items],
  )

  const FILTERS = useMemo(() => {
    const base = ['All', 'Pesticides', 'Fungicides', 'Fertilizers']
    // Add any extra categories that exist in items but aren't in the base list
    const extra = items
      .map(i => i.category)
      .filter(cat => cat && !base.some(b => matchesFilter(cat, b)))
      .filter((cat, idx, arr) => arr.indexOf(cat) === idx)
    return [...base, ...extra]
  }, [items])

  return (
    <section className="pg-page pg-inv" aria-label="Chemical inventory">
      <SectionHeader title="Inventory" align="center" />

      {error && !editModalItem && !isAddingItem ? (
        <div className="pg-inv-error">
          <p>{error}</p>
        </div>
      ) : null}

      {/* ── Summary Cards ── */}
      <div className="pg-inv-summary">
        <div className="pg-inv-summary-card">
          <span className="pg-inv-summary-value">{items.length}</span>
          <span className="pg-inv-summary-label">Total Items</span>
        </div>
        <div className={`pg-inv-summary-card ${lowStockCount > 0 ? 'is-alert' : ''}`}>
          <span className="pg-inv-summary-value">{lowStockCount}</span>
          <span className="pg-inv-summary-label">Low Stock</span>
        </div>
        <div className="pg-inv-summary-card">
          <span className="pg-inv-summary-value">RM {totalValue.toFixed(0)}</span>
          <span className="pg-inv-summary-label">Total Value</span>
        </div>
      </div>

      {/* ── Category Search ── */}
      <div className="pg-inv-search-wrap">
        <input
          className="pg-input pg-inv-search"
          type="search"
          placeholder="Search category..."
          value={categorySearch}
          onChange={(e) => setCategorySearch(e.target.value)}
          aria-label="Search inventory by category"
        />
        <span className="pg-inv-search-count" aria-live="polite">({visibleItems.length})</span>
      </div>

      {/* ── Filter Pills ── */}
      <div className="pg-inv-filters" role="tablist" aria-label="Filter inventory category">
        {FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            className={`pg-inv-filter ${filter === activeFilter ? 'is-active' : ''}`}
            onClick={() => setActiveFilter(filter)}
            role="tab"
            aria-selected={filter === activeFilter}
          >
            {filter}
            {filter !== 'All' && (
              <span className="pg-inv-filter-count">
                {items.filter((item) => matchesFilter(item.category, filter)).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Item List ── */}
      <div className="pg-inv-list" aria-live="polite">
        {visibleItems.length === 0 ? (
          <div className="pg-inv-empty">
            <IconSprout className="pg-icon" style={{ width: 40, height: 40, opacity: 0.3 }} />
            <p>{error ? 'Inventory unavailable.' : 'No items in this category.'}</p>
            {!error && (
              <button type="button" className="pg-inv-empty-action" onClick={() => setIsAddingItem(true)}>
                <IconPlus className="pg-icon" style={{ width: 16, height: 16 }} />
                Add your first item
              </button>
            )}
          </div>
        ) : null}

        {visibleItems.map((item) => {
          const stockTone = getStockTone(item.liters)
          const ItemIcon = getCategoryIcon(item.category)
          const catColor = getCategoryColor(item.category)
          const isLowStock = item.liters < 5
          const stockPercent = Math.min(100, (item.liters / 10) * 100)

          return (
            <button
              key={item.id}
              type="button"
              className="pg-inv-card"
              aria-label={`${item.name}, ${item.liters.toFixed(1)} liters`}
              onClick={() => openEditModal(item)}
            >
              <div className="pg-inv-card-icon" style={{ background: catColor.bg, borderColor: catColor.border }}>
                <ItemIcon className="pg-icon" />
              </div>

              <div className="pg-inv-card-body">
                <div className="pg-inv-card-top">
                  <h3 className="pg-inv-card-name">{item.name}</h3>
                  <span className={`pg-inv-badge ${isLowStock ? 'is-low' : 'is-ok'}`}>
                    {isLowStock ? 'Low' : 'In Stock'}
                  </span>
                </div>

                {item.description ? (
                  <p className="pg-inv-card-desc">{item.description}</p>
                ) : null}

                <div className="pg-inv-card-bar">
                  <div
                    className={`pg-inv-card-bar-fill is-${stockTone}`}
                    style={{ width: `${stockPercent}%` }}
                  />
                </div>

                <div className="pg-inv-card-meta">
                  <span className="pg-inv-card-qty">{item.liters.toFixed(1)} L</span>
                  <span className="pg-inv-card-cat">{item.category}</span>
                  <span className="pg-inv-card-cost">RM {item.unitCostRm.toFixed(2)}/L</span>
                </div>
              </div>

              <IconChevronRight className="pg-icon pg-inv-card-chevron" />
            </button>
          )
        })}
      </div>

      {/* ── Updated info ── */}
      <p className="pg-inv-updated">Last updated: {lastUpdatedLabel}</p>

      {/* ── FAB ── */}
      <button
        type="button"
        className="pg-inv-fab"
        aria-label="Add new inventory item"
        onClick={() => setIsAddingItem(true)}
        disabled={isActionBusy}
      >
        <IconPlus className="pg-icon" />
      </button>

      {/* ═══════════════════ Add Item Modal ═══════════════════ */}
      {isAddingItem && (
        <div className="pg-modal-backdrop" onClick={closeAddModal}>
          <div className="pg-modal-drawer pg-modal-drawer-themed" onClick={(e) => e.stopPropagation()}>
            <div className="pg-modal-close-bar" onClick={closeAddModal}></div>
            <h2 style={{ marginTop: 0, marginBottom: 16 }}>Add New Item</h2>
            {error && <p style={{ color: 'var(--danger)', marginBottom: 16 }}>{error}</p>}
            <form onSubmit={handleAddInventory}>
              <label className="pg-field-label">Item Name</label>
              <input required className="pg-input" type="text" value={addName} onChange={e => setAddName(e.target.value)} placeholder="e.g. NPK Fertilizer" />
              
              <label className="pg-field-label">Category</label>
              <select className="pg-input pg-select" value={addCategory} onChange={e => setAddCategory(e.target.value)}>
                {CATEGORY_OPTIONS.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
                <option value="Other">Other</option>
              </select>
              {addCategory === 'Other' && (
                <>
                  <label className="pg-field-label" style={{ marginTop: 8 }}>Custom Category</label>
                  <input required className="pg-input" type="text" value={addCustomCategory} onChange={e => setAddCustomCategory(e.target.value)} placeholder="Enter custom category" />
                </>
              )}
              
              <label className="pg-field-label">Quantity</label>
              <input required className="pg-input" type="number" step="0.1" min="0" value={addLiters} onChange={e => setAddLiters(e.target.value)} placeholder="e.g. 10.5" />
              
              <label className="pg-field-label">Unit Code</label>
              <input required className="pg-input" type="text" value={addUnit} onChange={e => setAddUnit(e.target.value)} placeholder="e.g. liters or kg" />
              
              <label className="pg-field-label">Cost Per Unit (RM)</label>
              <input required className="pg-input" type="number" step="0.01" min="0" value={addCost} onChange={e => setAddCost(e.target.value)} placeholder="e.g. 45.00" />
              
              <label className="pg-field-label">Description (Optional)</label>
              <input className="pg-input" type="text" value={addDesc} onChange={e => setAddDesc(e.target.value)} placeholder="e.g. Usage notes or details" />
              
              <div className="pg-cta-row" style={{ marginTop: 24 }}>
                <button type="submit" className="pg-btn pg-btn-primary" disabled={isCreatingItem}>
                  {isCreatingItem ? 'Adding...' : 'Add Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════ Edit/Details Modal ═══════════════════ */}
      {editModalItem && (
        <div className="pg-modal-backdrop" onClick={closeEditModal}>
          <div className="pg-modal-drawer pg-modal-drawer-themed" onClick={(e) => e.stopPropagation()}>
            <div className="pg-modal-close-bar" onClick={closeEditModal}></div>
            <h2 style={{ marginTop: 0, marginBottom: 16 }}>{editModalItem.name}</h2>
            {error && <p style={{ color: 'var(--danger)', marginBottom: 16 }}>{error}</p>}

            <form onSubmit={handleEditInventory}>
              <label className="pg-field-label">Item Name</label>
              <input required className="pg-input" type="text" value={editName} onChange={e => setEditName(e.target.value)} placeholder="e.g. NPK Fertilizer" />

              <label className="pg-field-label">Category</label>
              <select className="pg-input pg-select" value={editCategory} onChange={e => setEditCategory(e.target.value)}>
                {CATEGORY_OPTIONS.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
                <option value="Other">Other</option>
              </select>
              {editCategory === 'Other' && (
                <>
                  <label className="pg-field-label" style={{ marginTop: 8 }}>Custom Category</label>
                  <input required className="pg-input" type="text" value={editCustomCategory} onChange={e => setEditCustomCategory(e.target.value)} placeholder="Enter custom category" />
                </>
              )}

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
