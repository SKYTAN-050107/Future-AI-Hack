import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SectionHeader from '../../components/ui/SectionHeader'
import MetricTile from '../../components/ui/MetricTile'
import BackButton from '../../components/navigation/BackButton'
import { getCropById, getCrops } from '../../api/crops'
import { getTreatmentPlan } from '../../api/treatment'
import { useSessionContext } from '../../hooks/useSessionContext'
import { useScanHistory } from '../../hooks/useScanHistory'
import { useGrids } from '../../hooks/useGrids'

function toSafeNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeCrop(rawCrop) {
  return {
    id: String(rawCrop?.id || ''),
    name: String(rawCrop?.name || 'Unnamed Crop'),
    expectedYieldKg: toSafeNumber(rawCrop?.expected_yield_kg, 0),
    laborCostRm: toSafeNumber(rawCrop?.labor_cost_rm, 0),
    otherCostsRm: toSafeNumber(rawCrop?.other_costs_rm, 0),
    status: String(rawCrop?.status || 'growing').trim().toLowerCase() || 'growing',
  }
}

function formatMoney(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? parsed.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00'
}

function formatRoi(plan) {
  const roiPercent = Number(plan?.roi_percent)
  if (Number.isFinite(roiPercent)) {
    return `${roiPercent.toFixed(2)}%`
  }

  if (plan?.roi_note === 'infinite') {
    return 'infinite'
  }

  if (plan?.roi_note === 'undefined') {
    return 'undefined'
  }

  return '--'
}

export default function Treatment() {
  const navigate = useNavigate()
  const { user, profile } = useSessionContext()
  const { latestReport } = useScanHistory()
  const { grids } = useGrids()

  const [crops, setCrops] = useState([])
  const [selectedCropId, setSelectedCropId] = useState('')
  const [cropDetail, setCropDetail] = useState(null)
  const [yieldKg, setYieldKg] = useState(0)
  const [actualSoldKg, setActualSoldKg] = useState(0)
  const [laborCostRm, setLaborCostRm] = useState(0)
  const [otherCostsRm, setOtherCostsRm] = useState(0)
  const [sellingChannel, setSellingChannel] = useState('middleman')
  const [marketCondition, setMarketCondition] = useState('normal')
  const [manualPriceOverride, setManualPriceOverride] = useState('')
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingCrops, setIsLoadingCrops] = useState(true)

  const userId = String(user?.uid || '').trim()

  const firstGridWithCentroid = useMemo(
    () => grids.find((grid) => Number.isFinite(grid?.centroid?.lat) && Number.isFinite(grid?.centroid?.lng)),
    [grids],
  )

  const maxYield = useMemo(() => {
    const base = Math.max(0, toSafeNumber(cropDetail?.expectedYieldKg, 0))
    return Math.max(100, Math.ceil(base * 2))
  }, [cropDetail?.expectedYieldKg])

  useEffect(() => {
    let active = true

    if (!userId) {
      setError('Sign in to load treatment ROI.')
      setIsLoadingCrops(false)
      return undefined
    }

    setIsLoadingCrops(true)
    setError('')

    getCrops({ userId })
      .then((response) => {
        if (!active) {
          return
        }

        const nextCrops = Array.isArray(response?.items)
          ? response.items.map(normalizeCrop)
          : []

        setCrops(nextCrops)

        const preferredCropId = String(profile?.activeCropId || '').trim()
        if (preferredCropId && nextCrops.some((item) => item.id === preferredCropId)) {
          setSelectedCropId(preferredCropId)
          return
        }

        setSelectedCropId(nextCrops[0]?.id || '')
      })
      .catch((loadError) => {
        if (!active) {
          return
        }

        setError(loadError?.message || 'Unable to load crops for ROI')
        setCrops([])
        setSelectedCropId('')
      })
      .finally(() => {
        if (active) {
          setIsLoadingCrops(false)
        }
      })

    return () => {
      active = false
    }
  }, [profile?.activeCropId, userId])

  useEffect(() => {
    let active = true

    if (!userId || !selectedCropId) {
      setCropDetail(null)
      setPlan(null)
      return undefined
    }

    getCropById(selectedCropId, { userId })
      .then((response) => {
        if (!active) {
          return
        }

        const normalized = normalizeCrop(response)
        setCropDetail(normalized)
        setYieldKg(normalized.expectedYieldKg)
        setActualSoldKg(normalized.expectedYieldKg)
        setLaborCostRm(normalized.laborCostRm)
        setOtherCostsRm(normalized.otherCostsRm)
      })
      .catch((loadError) => {
        if (!active) {
          return
        }

        setCropDetail(null)
        setPlan(null)
        setError(loadError?.message || 'Unable to load crop details')
      })

    return () => {
      active = false
    }
  }, [selectedCropId, userId])

  useEffect(() => {
    if (!userId || !selectedCropId || !cropDetail) {
      return undefined
    }

    if (sellingChannel === 'contract' && Number(manualPriceOverride) <= 0) {
      setPlan(null)
      setError('Contract selling requires manual price override (RM/kg).')
      return undefined
    }

    let active = true
    const timeout = window.setTimeout(() => {
      setIsLoading(true)
      setError('')

      getTreatmentPlan({
        userId,
        cropId: selectedCropId,
        sellingChannel,
        marketCondition,
        manualPriceOverride: manualPriceOverride === '' ? null : Number(manualPriceOverride),
        yieldKg,
        actualSoldKg,
        laborCostRm,
        otherCostsRm,
        disease: String(latestReport?.disease || 'Crop disease risk').trim(),
        treatmentPlan: String(latestReport?.treatmentPlan || latestReport?.treatment_plan || 'recommended treatment').trim(),
        lat: firstGridWithCentroid?.centroid?.lat,
        lng: firstGridWithCentroid?.centroid?.lng,
      })
        .then((response) => {
          if (!active) {
            return
          }

          setPlan(response)
        })
        .catch((loadError) => {
          if (!active) {
            return
          }

          setPlan(null)
          setError(loadError?.message || 'Unable to calculate ROI')
        })
        .finally(() => {
          if (active) {
            setIsLoading(false)
          }
        })
    }, 220)

    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [
    actualSoldKg,
    cropDetail,
    firstGridWithCentroid?.centroid?.lat,
    firstGridWithCentroid?.centroid?.lng,
    laborCostRm,
    latestReport?.disease,
    latestReport?.treatmentPlan,
    latestReport?.treatment_plan,
    manualPriceOverride,
    marketCondition,
    otherCostsRm,
    selectedCropId,
    sellingChannel,
    userId,
    yieldKg,
  ])

  if (isLoadingCrops) {
    return (
      <section className="pg-page">
        <SectionHeader
          title="Treatment"
          align="center"
          leadingAction={<BackButton fallback="/app" label="Back to home" />}
        />
        <article className="pg-card">
          <p>Loading crop ROI setup...</p>
        </article>
      </section>
    )
  }

  return (
    <section className="pg-page">
      <SectionHeader
        title="Treatment"
        align="center"
        leadingAction={<BackButton fallback="/app" label="Back to home" />}
      />

      {error ? (
        <article className="pg-card">
          <p>{error}</p>
        </article>
      ) : null}

      {crops.length === 0 ? (
        <article className="pg-card">
          <h2>Add your first crop</h2>
          <p>Complete setup looks good. Next step: add a crop profile to unlock crop-level ROI and treatment economics.</p>
          <button type="button" className="pg-btn pg-btn-primary" onClick={() => navigate('/app/crops')}>
            Go to Manage Crops
          </button>
        </article>
      ) : (
        <>
          <article className="pg-card">
            <h2>Live ROI Panel</h2>

            <label className="pg-field-label" htmlFor="pg-treatment-crop">Crop</label>
            <select
              id="pg-treatment-crop"
              className="pg-input"
              value={selectedCropId}
              onChange={(event) => setSelectedCropId(event.target.value)}
            >
              {crops.map((crop) => (
                <option key={crop.id} value={crop.id}>{crop.name}</option>
              ))}
            </select>

            <label className="pg-field-label" htmlFor="pg-treatment-yield">Expected yield: {toSafeNumber(yieldKg).toFixed(1)}kg</label>
            <input
              id="pg-treatment-yield"
              type="range"
              min="0"
              max={maxYield}
              step="1"
              value={toSafeNumber(yieldKg)}
              onChange={(event) => setYieldKg(toSafeNumber(event.target.value, 0))}
              style={{ width: '100%' }}
            />

            <label className="pg-field-label" htmlFor="pg-treatment-actual">Actual sold (kg)</label>
            <input
              id="pg-treatment-actual"
              className="pg-input"
              type="number"
              min="0"
              step="0.1"
              value={actualSoldKg}
              onChange={(event) => setActualSoldKg(toSafeNumber(event.target.value, 0))}
            />

            <label className="pg-field-label" htmlFor="pg-treatment-channel">Selling channel</label>
            <select
              id="pg-treatment-channel"
              className="pg-input"
              value={sellingChannel}
              onChange={(event) => setSellingChannel(event.target.value)}
            >
              <option value="middleman">Middleman</option>
              <option value="direct">Direct</option>
              <option value="contract">Contract</option>
            </select>

            <label className="pg-field-label" htmlFor="pg-treatment-market">Market condition</label>
            <select
              id="pg-treatment-market"
              className="pg-input"
              value={marketCondition}
              onChange={(event) => setMarketCondition(event.target.value)}
            >
              <option value="weak">Weak</option>
              <option value="normal">Normal</option>
              <option value="strong">Strong</option>
            </select>

            {sellingChannel === 'contract' ? (
              <>
                <label className="pg-field-label" htmlFor="pg-treatment-contract">Contract price override (RM/kg)</label>
                <input
                  id="pg-treatment-contract"
                  className="pg-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={manualPriceOverride}
                  onChange={(event) => setManualPriceOverride(event.target.value)}
                />
              </>
            ) : null}

            <label className="pg-field-label" htmlFor="pg-treatment-labor">Labor cost (RM)</label>
            <input
              id="pg-treatment-labor"
              className="pg-input"
              type="number"
              min="0"
              step="0.01"
              value={laborCostRm}
              onChange={(event) => setLaborCostRm(toSafeNumber(event.target.value, 0))}
            />

            <label className="pg-field-label" htmlFor="pg-treatment-other">Other costs (RM)</label>
            <input
              id="pg-treatment-other"
              className="pg-input"
              type="number"
              min="0"
              step="0.01"
              value={otherCostsRm}
              onChange={(event) => setOtherCostsRm(toSafeNumber(event.target.value, 0))}
            />
          </article>

          <div className="pg-tile-grid">
            <MetricTile
              label="Revenue"
              value={plan ? `RM ${formatMoney(plan.expected_gain_rm)}` : '...'}
              helper="actualSoldKg x farm price"
              tone="success"
            />
            <MetricTile
              label="Total cost"
              value={plan ? `RM ${formatMoney(plan.estimated_cost_rm)}` : '...'}
              helper="inventory + labor + other"
            />
            <MetricTile
              label="ROI"
              value={plan ? formatRoi(plan) : '...'}
              helper={plan?.roi_note ? `ROI ${plan.roi_note}` : 'live updated'}
              tone="success"
            />
          </div>

          <article className="pg-card">
            <h2>Breakdown View</h2>
            {isLoading ? <p>Recalculating ROI...</p> : null}

            {plan ? (
              <>
                <p>Retail price: RM {formatMoney(plan.retail_price_rm_per_kg)}/kg</p>
                <p>Farm price: RM {formatMoney(plan.farm_price_rm_per_kg)}/kg</p>
                <p>Price date: {plan.price_date || 'N/A'}</p>
                <p>Inventory cost: RM {formatMoney(plan.inventory_cost_rm)}</p>
                <p>Labor cost: RM {formatMoney(plan.labor_cost_rm)}</p>
                <p>Other costs: RM {formatMoney(plan.other_costs_rm)}</p>
                <p>Profit: RM {formatMoney(plan.profit_rm)}</p>

                <details style={{ marginTop: 12 }}>
                  <summary>Inventory usage details</summary>
                  {Array.isArray(plan.inventory_breakdown) && plan.inventory_breakdown.length > 0 ? (
                    <ul style={{ marginTop: 8 }}>
                      {plan.inventory_breakdown.map((line) => (
                        <li key={line.inventory_id}>
                          {line.name}: {toSafeNumber(line.quantity_used).toFixed(2)} x RM {formatMoney(line.cost_per_unit_rm)} = RM {formatMoney(line.line_cost_rm)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ marginTop: 8 }}>No inventory usage linked to this crop yet.</p>
                  )}
                </details>

                <article className="pg-card" style={{ marginTop: 12 }}>
                  <h2>Suggested plan</h2>
                  <p>{plan.recommendation}</p>
                  <p>{plan.organic_alternative}</p>
                </article>
              </>
            ) : (
              <p>Select a crop and adjust values to see live ROI.</p>
            )}
          </article>
        </>
      )}
    </section>
  )
}
