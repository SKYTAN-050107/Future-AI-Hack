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

  if (!crop) {
    return map
  }

  crop.cropInventoryUsage.forEach((line) => {
    map[line.inventoryId] = String(line.quantityUsed)
  })

  return map
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
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

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
        if (!active) {
          return
        }

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
        if (!active) {
          return
        }
        setError(loadError?.message || 'Unable to load crops and inventory')
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
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
  }

  function handleCreateDraft() {
    setSelectedCropId('')
    hydrateDraft(null)
    setError('')
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
    } catch (saveError) {
      setError(saveError?.message || 'Unable to save crop profile')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="pg-page" aria-label="Manage crops">
      <SectionHeader
        title="Manage Crops"
        align="center"
        leadingAction={<BackButton fallback="/app/profile" label="Back to profile" />}
      />

      {error ? (
        <article className="pg-card">
          <p>{error}</p>
        </article>
      ) : null}

      {isLoading ? (
        <article className="pg-card">
          <p>Loading crops and inventory...</p>
        </article>
      ) : null}

      {!isLoading ? (
        <>
          <article className="pg-card">
            <h2>Crops</h2>
            <div className="pg-cta-row" style={{ marginBottom: 12 }}>
              <select
                className="pg-input"
                value={selectedCropId}
                onChange={(event) => handleSelectCrop(event.target.value)}
                style={{ flex: 1 }}
              >
                {crops.length === 0 ? (
                  <option value="">No crops yet</option>
                ) : (
                  crops.map((crop) => (
                    <option key={crop.id} value={crop.id}>{crop.name}</option>
                  ))
                )}
              </select>
              <button type="button" className="pg-btn pg-btn-ghost" onClick={handleCreateDraft}>
                Add New
              </button>
            </div>

            {selectedCrop ? (
              <p>
                Yield: {selectedCrop.expectedYieldKg.toFixed(1)}kg | Status: {selectedCrop.status}
                {selectedCrop.lastPriceRmPerKg != null
                  ? ` | Last price: RM ${selectedCrop.lastPriceRmPerKg.toFixed(2)}/kg`
                  : ''}
              </p>
            ) : (
              <p>Create your first crop profile to enable crop-linked ROI.</p>
            )}
          </article>

          <article className="pg-card">
            <h2>Crop Profile</h2>

            <label className="pg-field-label" htmlFor="pg-crop-name">Crop name</label>
            <input
              id="pg-crop-name"
              className="pg-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Rice, Tomato, Chili..."
            />

            <label className="pg-field-label" htmlFor="pg-crop-yield">Expected yield (kg)</label>
            <input
              id="pg-crop-yield"
              className="pg-input"
              type="number"
              min="0"
              value={expectedYieldKg}
              onChange={(event) => setExpectedYieldKg(event.target.value)}
            />

            <label className="pg-field-label" htmlFor="pg-crop-area">Area (hectares)</label>
            <input
              id="pg-crop-area"
              className="pg-input"
              type="number"
              min="0"
              step="0.01"
              value={areaHectares}
              onChange={(event) => setAreaHectares(event.target.value)}
            />

            <label className="pg-field-label" htmlFor="pg-crop-planting-date">Planting date</label>
            <input
              id="pg-crop-planting-date"
              className="pg-input"
              type="date"
              value={plantingDate}
              onChange={(event) => setPlantingDate(event.target.value)}
            />

            <label className="pg-field-label" htmlFor="pg-crop-status">Status</label>
            <select
              id="pg-crop-status"
              className="pg-input"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="growing">Growing</option>
              <option value="harvested">Harvested</option>
            </select>

            <label className="pg-field-label" htmlFor="pg-crop-labor">Labor cost (RM)</label>
            <input
              id="pg-crop-labor"
              className="pg-input"
              type="number"
              min="0"
              step="0.01"
              value={laborCostRm}
              onChange={(event) => setLaborCostRm(event.target.value)}
            />

            <label className="pg-field-label" htmlFor="pg-crop-other">Other costs (RM)</label>
            <input
              id="pg-crop-other"
              className="pg-input"
              type="number"
              min="0"
              step="0.01"
              value={otherCostsRm}
              onChange={(event) => setOtherCostsRm(event.target.value)}
            />
          </article>

          <article className="pg-card">
            <h2>Inventory Usage per Crop</h2>
            {inventoryItems.length === 0 ? (
              <p>Add inventory items first to link usage per crop.</p>
            ) : (
              inventoryItems.map((item) => (
                <div key={item.id} style={{ marginBottom: 12 }}>
                  <label className="pg-field-label" htmlFor={`pg-crop-usage-${item.id}`}>
                    {item.name} (RM {item.unitCostRm.toFixed(2)}/{item.unit})
                  </label>
                  <input
                    id={`pg-crop-usage-${item.id}`}
                    className="pg-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={usageDraft[item.id] || ''}
                    onChange={(event) => {
                      const nextValue = event.target.value
                      setUsageDraft((current) => ({
                        ...current,
                        [item.id]: nextValue,
                      }))
                    }}
                    placeholder={`Quantity used (${item.unit})`}
                  />
                </div>
              ))
            )}
          </article>

          <article className="pg-card">
            <h2>Cost Preview</h2>
            <p>Inventory: RM {inventoryCostPreview.toFixed(2)}</p>
            <p>Labor: RM {laborCostValue.toFixed(2)}</p>
            <p>Other costs: RM {otherCostValue.toFixed(2)}</p>
            <p><strong>Total: RM {totalCostPreview.toFixed(2)}</strong></p>

            <button
              type="button"
              className="pg-btn pg-btn-primary"
              onClick={handleSaveCrop}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : selectedCropId ? 'Update Crop' : 'Create Crop'}
            </button>
          </article>
        </>
      ) : null}
    </section>
  )
}
