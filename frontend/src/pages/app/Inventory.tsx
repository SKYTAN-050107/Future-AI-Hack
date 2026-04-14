import { useMemo, useState } from 'react'
import {
  IconBug,
  IconChevronRight,
  IconPlus,
  IconShieldLeaf,
  IconSprout,
} from '../../components/icons/UiIcons'
import SectionHeader from '../../components/ui/SectionHeader'

const FILTERS = ['All', 'Pesticides', 'Fungicides', 'Fertilizers']

const INVENTORY_ITEMS = [
  { id: 'amistar-top-325sc', name: 'Amistar Top 325SC', category: 'Fungicides', liters: 6.4 },
  { id: 'nativo-75wg', name: 'Nativo 75WG', category: 'Fungicides', liters: 1.8 },
  { id: 'score-250ec', name: 'Score 250EC', category: 'Fungicides', liters: 7.0 },
  { id: 'regent-03g', name: 'Regent 0.3G', category: 'Pesticides', liters: 7.2 },
  { id: 'virtako-40wg', name: 'Virtako 40WG', category: 'Pesticides', liters: 4.3 },
  { id: 'urea-46', name: 'Urea 46', category: 'Fertilizers', liters: 8.9 },
  { id: 'npk-151515', name: 'NPK 15-15-15', category: 'Fertilizers', liters: 6.1 },
  { id: 'foliar-znb', name: 'Foliar Booster ZnB', category: 'Fertilizers', liters: 5.4 },
]

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
  const [activeFilter, setActiveFilter] = useState('All')

  const lowStockCount = useMemo(
    () => INVENTORY_ITEMS.filter((item) => item.liters < 5).length,
    [],
  )

  const visibleItems = useMemo(
    () => (activeFilter === 'All'
      ? INVENTORY_ITEMS
      : INVENTORY_ITEMS.filter((item) => item.category === activeFilter)),
    [activeFilter],
  )

  return (
    <section className="pg-page pg-inventory-page" aria-label="Chemical inventory">
      <SectionHeader title="Inventory" align="center" />

      <div className="pg-inventory-stat-row" aria-label="Inventory quick statistics">
        <span className="pg-inventory-stat-chip">Total Items: {INVENTORY_ITEMS.length}</span>
        <span className="pg-inventory-stat-chip pg-inventory-stat-chip-alert">Low Stock: {lowStockCount}</span>
        <span className="pg-inventory-stat-chip">Last Updated: Today</span>
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

      <button type="button" className="pg-inventory-add-fab" aria-label="Add inventory item">
        <IconPlus className="pg-icon" />
      </button>
    </section>
  )
}
