import { useEffect, useMemo, useState } from 'react'
import SectionHeader from '../../components/ui/SectionHeader'
import BackButton from '../../components/navigation/BackButton'
import { createCrop, getCrops, updateCrop } from '../../api/crops'
import { getInventory } from '../../api/inventory'
import { useSessionContext } from '../../hooks/useSessionContext'

function toSafeNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeInventoryItem(rawItem) {
  return {
    id: String(rawItem?.id || ''),
    name: String(rawItem?.name || 'Unnamed Item'),
    unit: String(rawItem?.unit || 'unit'),
    liters: toSafeNumber(rawItem?.liters, 0),
    unitCostRm: toSafeNumber(rawItem?.unit_cost_rm, 0),
  }
}

function normalizeCrop(rawCrop) {
  const usage = Array.isArray(rawCrop?.crop_inventory_usage)
    ? rawCrop.crop_inventory_usage
    : []

  return {
    id: String(rawCrop?.id || ''),
    name: String(rawCrop?.name || 'Unnamed Crop'),
    expectedYieldKg: toSafeNumber(rawCrop?.expected_yield_kg, 0),
    areaHectares: toSafeNumber(rawCrop?.area_hectares, 0),
    plantingDate: String(rawCrop?.planting_date || '').trim(),
    status: String(rawCrop?.status || 'growing').trim().toLowerCase() || 'growing',
    cropInventoryUsage: usage.map((item) => ({
      inventoryId: String(item?.inventory_id || '').trim(),
      quantityUsed: toSafeNumber(item?.quantity_used, 0),
    })).filter((item) => item.inventoryId),
    laborCostRm: toSafeNumber(rawCrop?.labor_cost_rm, 0),
    otherCostsRm: toSafeNumber(rawCrop?.other_costs_rm, 0),
    lastPriceRmPerKg: rawCrop?.last_price_rm_per_kg == null ? null : toSafeNumber(rawCrop?.last_price_rm_per_kg, 0),
    priceDate: String(rawCrop?.price_date || '').trim() || null,
  }
}

function buildUsageMap(crop) {
  const map = {}
  if (!crop) return map
  crop.cropInventoryUsage.forEach((line) => {
    map[line.inventoryId] = String(line.quantityUsed)
  })
  return map
}

const STATUS_META = {
  growing: { label: 'Growing', color: '#5D9B3F', bg: 'rgba(93,155,63,0.12)' },
  harvested: { label: 'Harvested', color: '#F57C00', bg: 'rgba(245,124,0,0.12)' },
}

export default function Crops() {
  const { user } = useSessionContext()
  const [crops, setCrops] = useState([])
  const [inventoryItems, setInventoryItems] = useState([])
  const [selectedCropId, setSelectedCropId] = useState('')
  const [name, setName] = useState('')
  const [expectedYieldKg, setExpectedYieldKg] = useState('')
  const [areaHectares, setAreaHectares] = useState('')
  const [plantingDate, setPlantingDate] = useState('')
  const [status, setStatus] = useState('growing')
  const [laborCostRm, setLaborCostRm] = useState('0')
  const [otherCostsRm, setOtherCostsRm] = useState('0')
  const [usageDraft, setUsageDraft] = useState({})
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('profile')

  const userId = String(user?.uid || '').trim()

  const selectedCrop = useMemo(
    () => crops.find((crop) => crop.id === selectedCropId) || null,
    [crops, selectedCropId],
  )

  const inventoryCostPreview = useMemo(
    () => inventoryItems.reduce((sum, item) => {
      const quantityUsed = toSafeNumber(usageDraft[item.id], 0)
      return sum + (quantityUsed * item.unitCostRm)
    }, 0),
    [inventoryItems, usageDraft],
  )

  const laborCostValue = toSafeNumber(laborCostRm, 0)
  const otherCostValue = toSafeNumber(otherCostsRm, 0)
  const totalCostPreview = inventoryCostPreview + laborCostValue + otherCostValue

  useEffect(() => {
    let active = true

    if (!userId) {
      setIsLoading(false)
      setError('Sign in to manage crops.')
      return undefined
    }

    setIsLoading(true)
    setError('')

    Promise.all([
      getCrops({ userId }),
      getInventory({ userId }),
    ])
      .then(([cropResponse, inventoryResponse]) => {
        if (!active) return

        const nextCrops = Array.isArray(cropResponse?.items)
          ? cropResponse.items.map(normalizeCrop)
          : []

        const nextInventory = Array.isArray(inventoryResponse?.items)
          ? inventoryResponse.items.map(normalizeInventoryItem)
          : []

        setCrops(nextCrops)
        setInventoryItems(nextInventory)

        if (nextCrops.length > 0) {
          const first = nextCrops[0]
          setSelectedCropId(first.id)
          setName(first.name)
          setExpectedYieldKg(String(first.expectedYieldKg))
          setAreaHectares(String(first.areaHectares))
          setPlantingDate(first.plantingDate || '')
          setStatus(first.status)
          setLaborCostRm(String(first.laborCostRm))
          setOtherCostsRm(String(first.otherCostsRm))
          setUsageDraft(buildUsageMap(first))
        } else {
          setSelectedCropId('')
          setUsageDraft({})
        }
      })
      .catch((loadError) => {
        if (!active) return
        setError(loadError?.message || 'Unable to load crops and inventory')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => { active = false }
  }, [userId])

  function hydrateDraft(crop) {
    if (!crop) {
      setName('')
      setExpectedYieldKg('')
      setAreaHectares('')
      setPlantingDate('')
      setStatus('growing')
      setLaborCostRm('0')
      setOtherCostsRm('0')
      setUsageDraft({})
      return
    }
    setName(crop.name)
    setExpectedYieldKg(String(crop.expectedYieldKg))
    setAreaHectares(String(crop.areaHectares))
    setPlantingDate(crop.plantingDate || '')
    setStatus(crop.status)
    setLaborCostRm(String(crop.laborCostRm))
    setOtherCostsRm(String(crop.otherCostsRm))
    setUsageDraft(buildUsageMap(crop))
  }

  function handleSelectCrop(nextCropId) {
    setSelectedCropId(nextCropId)
    const crop = crops.find((item) => item.id === nextCropId) || null
    hydrateDraft(crop)
    setError('')
    setSuccessMsg('')
  }

  function handleCreateDraft() {
    setSelectedCropId('')
    hydrateDraft(null)
    setError('')
    setSuccessMsg('')
    setActiveTab('profile')
  }

  async function handleSaveCrop() {
    if (!userId) {
      setError('Sign in to manage crops.')
      return
    }

    const cropName = name.trim()
    const safeExpectedYield = toSafeNumber(expectedYieldKg, -1)

    if (!cropName) {
      setError('Crop name is required.')
      return
    }

    if (safeExpectedYield < 0) {
      setError('Expected yield must be zero or more.')
      return
    }

    const cropInventoryUsage = Object.entries(usageDraft)
      .map(([inventoryId, quantityRaw]) => ({
        inventoryId,
        quantityUsed: Math.max(0, toSafeNumber(quantityRaw, 0)),
      }))
      .filter((item) => item.inventoryId && item.quantityUsed > 0)

    const payload = {
      userId,
      name: cropName,
      expectedYieldKg: safeExpectedYield,
      areaHectares: Math.max(0, toSafeNumber(areaHectares, 0)),
      plantingDate: plantingDate || null,
      status,
      laborCostRm: Math.max(0, toSafeNumber(laborCostRm, 0)),
      otherCostsRm: Math.max(0, toSafeNumber(otherCostsRm, 0)),
      cropInventoryUsage,
    }

    setIsSaving(true)
    setError('')
    setSuccessMsg('')

    try {
      if (selectedCropId) {
        await updateCrop(selectedCropId, payload)
      } else {
        await createCrop(payload)
      }

      const cropResponse = await getCrops({ userId })
      const nextCrops = Array.isArray(cropResponse?.items)
        ? cropResponse.items.map(normalizeCrop)
        : []

      setCrops(nextCrops)

      const targetCropId = selectedCropId || nextCrops[0]?.id || ''
      setSelectedCropId(targetCropId)
      const targetCrop = nextCrops.find((item) => item.id === targetCropId) || null
      hydrateDraft(targetCrop)
      setSuccessMsg(selectedCropId ? 'Crop updated successfully!' : 'Crop created successfully!')
    } catch (saveError) {
      setError(saveError?.message || 'Unable to save crop profile')
    } finally {
      setIsSaving(false)
    }
  }

  const isNewCrop = !selectedCropId
  const statusMeta = STATUS_META[status] || STATUS_META.growing

  return (
    <section className="pg-page" aria-label="Manage crops">
      <SectionHeader
        title="Manage Crops"
        align="center"
        leadingAction={<BackButton fallback="/app/profile" label="Back to profile" />}
      />

      {/* ── Crop Picker bar ── */}
      {!isLoading && (
        <article className="pg-card" style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
              Active Crop
            </span>

            <div style={{ flex: 1, position: 'relative', minWidth: 160 }}>
              <select
                className="pg-input"
                value={selectedCropId}
                onChange={(e) => handleSelectCrop(e.target.value)}
                style={{ margin: 0, paddingRight: 36, appearance: 'none', fontWeight: 600 }}
                aria-label="Select crop"
              >
                {crops.length === 0
                  ? <option value="">No crops yet</option>
                  : crops.map((crop) => (
                    <option key={crop.id} value={crop.id}>{crop.name}</option>
                  ))
                }
              </select>
              {/* chevron icon */}
              <svg
                aria-hidden="true"
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-secondary)' }}
                width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            {selectedCrop && (
              <span style={{
                fontSize: '0.78rem', fontWeight: 700, padding: '4px 10px',
                borderRadius: 99, color: statusMeta.color, background: statusMeta.bg,
              }}>
                {statusMeta.label}
              </span>
            )}

            <button
              type="button"
              className="pg-btn pg-btn-ghost pg-btn-inline"
              onClick={handleCreateDraft}
              style={{ whiteSpace: 'nowrap' }}
            >
              + New Crop
            </button>
          </div>

          {/* Quick stats row */}
          {selectedCrop && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8,
              marginTop: 12,
            }}>
              <StatChip label="Yield" value={`${selectedCrop.expectedYieldKg.toFixed(1)} kg`} />
              <StatChip label="Area" value={`${selectedCrop.areaHectares.toFixed(2)} ha`} />
              <StatChip
                label="Market price"
                value={selectedCrop.lastPriceRmPerKg != null
                  ? `RM ${selectedCrop.lastPriceRmPerKg.toFixed(2)}/kg`
                  : '—'}
              />
            </div>
          )}

          {!selectedCrop && !isNewCrop && (
            <p style={{ margin: '10px 0 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Create your first crop profile to enable crop-linked ROI.
            </p>
          )}

          {isNewCrop && (
            <p style={{ margin: '10px 0 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Fill in the details below to create a new crop.
            </p>
          )}
        </article>
      )}

      {/* ── Alerts ── */}
      {error && (
        <article className="pg-card" style={{ borderColor: 'var(--danger)', background: 'rgba(229,57,53,0.06)', padding: '12px 16px' }}>
          <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.9rem', fontWeight: 600 }}>⚠ {error}</p>
        </article>
      )}
      {successMsg && (
        <article className="pg-card" style={{ borderColor: '#5D9B3F', background: 'rgba(93,155,63,0.08)', padding: '12px 16px' }}>
          <p style={{ margin: 0, color: '#5D9B3F', fontSize: '0.9rem', fontWeight: 600 }}>✓ {successMsg}</p>
        </article>
      )}

      {isLoading && (
        <article className="pg-card">
          <p>Loading crops and inventory…</p>
        </article>
      )}

      {/* ── Main editor ── */}
      {!isLoading && (
        <article className="pg-card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Tab bar */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
          }}>
            {[
              { key: 'profile', label: 'Crop Details', icon: '🌱' },
              { key: 'inventory', label: `Inputs (${inventoryItems.length})`, icon: '📦' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                style={{
                  flex: 1,
                  padding: '14px 12px',
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
                  color: activeTab === tab.key ? 'var(--primary)' : 'var(--text-secondary)',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  transition: 'color 0.15s, border-color 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
                aria-selected={activeTab === tab.key}
              >
                <span aria-hidden="true">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ padding: '20px 16px' }}>
            {/* ── Tab: Crop Details ── */}
            {activeTab === 'profile' && (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
                  {/* Crop name — full width */}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="pg-field-label" htmlFor="pg-crop-name">Crop name</label>
                    <input
                      id="pg-crop-name"
                      className="pg-input"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Rice, Tomato, Chili…"
                    />
                  </div>

                  <div>
                    <label className="pg-field-label" htmlFor="pg-crop-yield">Expected yield (kg)</label>
                    <input
                      id="pg-crop-yield"
                      className="pg-input"
                      type="number"
                      min="0"
                      value={expectedYieldKg}
                      onChange={(e) => setExpectedYieldKg(e.target.value)}
                      placeholder="0"
                    />
                  </div>

                  <div>
                    <label className="pg-field-label" htmlFor="pg-crop-area">Area (hectares)</label>
                    <input
                      id="pg-crop-area"
                      className="pg-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={areaHectares}
                      onChange={(e) => setAreaHectares(e.target.value)}
                      placeholder="0.00"
                    />
                  </div>

                  <div>
                    <label className="pg-field-label" htmlFor="pg-crop-planting-date">Planting date</label>
                    <input
                      id="pg-crop-planting-date"
                      className="pg-input"
                      type="date"
                      value={plantingDate}
                      onChange={(e) => setPlantingDate(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="pg-field-label" htmlFor="pg-crop-status">Status</label>
                    <div style={{ position: 'relative' }}>
                      <select
                        id="pg-crop-status"
                        className="pg-input"
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        style={{ appearance: 'none', paddingRight: 36 }}
                      >
                        <option value="growing">🌱 Growing</option>
                        <option value="harvested">🌾 Harvested</option>
                      </select>
                      <svg
                        aria-hidden="true"
                        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-secondary)' }}
                        width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Cost section */}
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  <p style={{ margin: '0 0 4px', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Direct costs
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
                    <div>
                      <label className="pg-field-label" htmlFor="pg-crop-labor">Labor cost (RM)</label>
                      <input
                        id="pg-crop-labor"
                        className="pg-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={laborCostRm}
                        onChange={(e) => setLaborCostRm(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>

                    <div>
                      <label className="pg-field-label" htmlFor="pg-crop-other">Other costs (RM)</label>
                      <input
                        id="pg-crop-other"
                        className="pg-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={otherCostsRm}
                        onChange={(e) => setOtherCostsRm(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab: Inventory Usage ── */}
            {activeTab === 'inventory' && (
              <div>
                {inventoryItems.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '28px 16px' }}>
                    <p style={{ margin: 0, fontSize: '2rem' }}>📦</p>
                    <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '0.9375rem' }}>
                      No inventory items yet. Add items in Inventory first to track usage per crop.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 12 }}>
                    {inventoryItems.map((item) => {
                      const qty = toSafeNumber(usageDraft[item.id], 0)
                      const lineCost = qty * item.unitCostRm
                      return (
                        <div
                          key={item.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr auto',
                            gap: '6px 12px',
                            alignItems: 'center',
                            background: 'var(--bg)',
                            borderRadius: 10,
                            padding: '10px 12px',
                            border: '1px solid var(--border)',
                          }}
                        >
                          <div>
                            <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                              {item.name}
                            </p>
                            <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                              RM {item.unitCostRm.toFixed(2)} / {item.unit}
                              {qty > 0 && (
                                <span style={{ color: 'var(--primary)', fontWeight: 700, marginLeft: 8 }}>
                                  = RM {lineCost.toFixed(2)}
                                </span>
                              )}
                            </p>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input
                              id={`pg-crop-usage-${item.id}`}
                              className="pg-input"
                              type="number"
                              min="0"
                              step="0.01"
                              value={usageDraft[item.id] || ''}
                              onChange={(e) => {
                                const nextValue = e.target.value
                                setUsageDraft((curr) => ({ ...curr, [item.id]: nextValue }))
                              }}
                              placeholder="0"
                              style={{ width: 90, margin: 0, textAlign: 'right' }}
                              aria-label={`Quantity of ${item.name} used`}
                            />
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                              {item.unit}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </article>
      )}

      {/* ── Cost summary + Save ── */}
      {!isLoading && (
        <article className="pg-card" style={{ padding: '16px' }}>
          <p style={{ margin: '0 0 12px', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Cost Summary
          </p>

          <div style={{ display: 'grid', gap: 6 }}>
            <CostRow label="Inventory inputs" value={inventoryCostPreview} />
            <CostRow label="Labor" value={laborCostValue} />
            <CostRow label="Other costs" value={otherCostValue} />
          </div>

          <div style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>Total</span>
            <span style={{ fontWeight: 800, fontSize: '1.125rem', color: 'var(--primary)' }}>
              RM {totalCostPreview.toFixed(2)}
            </span>
          </div>

          <button
            type="button"
            className="pg-btn pg-btn-primary"
            onClick={handleSaveCrop}
            disabled={isSaving}
            style={{ width: '100%', marginTop: 16 }}
          >
            {isSaving ? 'Saving…' : isNewCrop ? '+ Create Crop' : 'Save Changes'}
          </button>
        </article>
      )}
    </section>
  )
}

/* ── Small helper components ── */

function StatChip({ label, value }) {
  return (
    <div style={{
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '7px 10px',
      textAlign: 'center',
    }}>
      <p style={{ margin: 0, fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </p>
      <p style={{ margin: '2px 0 0', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  )
}

function CostRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>RM {value.toFixed(2)}</span>
    </div>
  )
}
