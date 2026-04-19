import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SectionHeader from '../../components/ui/SectionHeader'
import MetricTile from '../../components/ui/MetricTile'
import BackButton from '../../components/navigation/BackButton'
import { getCropById, getCrops } from '../../api/crops'
import { runSwarmOrchestrator } from '../../api/swarm'
import { getTreatmentPlan } from '../../api/treatment'
import { getTreatmentFormSnapshot, saveTreatmentFormSnapshot, saveTreatmentRoiSnapshot } from '../../utils/treatmentRoiCache'
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
    areaHectares: toSafeNumber(rawCrop?.area_hectares ?? rawCrop?.areaHectares, 0),
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

function severityLabel(value) {
  if (value >= 70) {
    return 'High'
  }

  if (value >= 40) {
    return 'Medium'
  }

  return 'Low'
}

function deriveSurvivalProbability(report) {
  const explicitValue = Number(report?.survivalProb ?? report?.survival_prob)
  if (Number.isFinite(explicitValue)) {
    return Math.max(0, Math.min(1, explicitValue))
  }

  const severity = Number(report?.severity)
  if (!Number.isFinite(severity)) {
    return null
  }

  const inferred = 1 - (severity / 100)
  return Math.max(0.05, Math.min(0.95, inferred))
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
  const [hasManualYieldInput, setHasManualYieldInput] = useState(false)
  const [hasManualActualSoldInput, setHasManualActualSoldInput] = useState(false)
  const [sellingChannel, setSellingChannel] = useState('middleman')
  const [marketCondition, setMarketCondition] = useState('normal')
  const [manualPriceOverride, setManualPriceOverride] = useState('')
  const [yieldForecast, setYieldForecast] = useState(null)
  const [yieldForecastError, setYieldForecastError] = useState('')
  const [isYieldForecastLoading, setIsYieldForecastLoading] = useState(false)
  const [calculationInput, setCalculationInput] = useState(null)
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingCrops, setIsLoadingCrops] = useState(true)

  const userId = String(user?.uid || '').trim()

  const firstGridWithCentroid = useMemo(
    () => grids.find((grid) => Number.isFinite(grid?.centroid?.lat) && Number.isFinite(grid?.centroid?.lng)),
    [grids],
  )

  const totalAreaHectares = useMemo(
    () => grids.reduce((sum, grid) => sum + toSafeNumber(grid?.areaHectares, 0), 0),
    [grids],
  )

  const resolvedFarmSizeHectares = useMemo(() => {
    const cropArea = toSafeNumber(cropDetail?.areaHectares, 0)
    if (cropArea > 0) {
      return cropArea
    }

    return totalAreaHectares > 0 ? totalAreaHectares : null
  }, [cropDetail?.areaHectares, totalAreaHectares])

  const predictedYieldKg = toSafeNumber(yieldForecast?.predicted_yield_kg, 0)
  const forecastConfidence = toSafeNumber(yieldForecast?.confidence, 0)
  const forecastLossPercent = toSafeNumber(yieldForecast?.yield_loss_percent, 0)

  const yieldInputSourceLabel = useMemo(() => {
    if (hasManualYieldInput) {
      return 'manual input'
    }

    if (predictedYieldKg > 0) {
      return 'swarm yield forecast'
    }

    return 'crop profile'
  }, [hasManualYieldInput, predictedYieldKg])

  const maxYield = useMemo(() => {
    const base = Math.max(
      0,
      toSafeNumber(cropDetail?.expectedYieldKg, 0),
      toSafeNumber(yieldKg, 0),
      predictedYieldKg,
    )
    return Math.max(100, Math.ceil(base * 2))
  }, [cropDetail?.expectedYieldKg, predictedYieldKg, yieldKg])

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

        const cachedSelection = String(getTreatmentFormSnapshot(userId)?.selectedCropId || '').trim()
        if (cachedSelection && nextCrops.some((item) => item.id === cachedSelection)) {
          setSelectedCropId(cachedSelection)
          return
        }

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

        const cachedForm = getTreatmentFormSnapshot(userId, selectedCropId)?.values
        if (cachedForm) {
          setYieldKg(toSafeNumber(cachedForm.yieldKg, normalized.expectedYieldKg))
          setActualSoldKg(toSafeNumber(cachedForm.actualSoldKg, normalized.expectedYieldKg))
          setLaborCostRm(toSafeNumber(cachedForm.laborCostRm, normalized.laborCostRm))
          setOtherCostsRm(toSafeNumber(cachedForm.otherCostsRm, normalized.otherCostsRm))
          setSellingChannel(String(cachedForm.sellingChannel || 'middleman').trim().toLowerCase() || 'middleman')
          setMarketCondition(String(cachedForm.marketCondition || 'normal').trim().toLowerCase() || 'normal')
          setManualPriceOverride(String(cachedForm.manualPriceOverride ?? ''))
          setHasManualYieldInput(true)
          setHasManualActualSoldInput(true)
          setPlan(cachedForm.plan && typeof cachedForm.plan === 'object' ? cachedForm.plan : null)
          return
        }

        setPlan(null)
        setYieldKg(normalized.expectedYieldKg)
        setActualSoldKg(normalized.expectedYieldKg)
        setHasManualYieldInput(false)
        setHasManualActualSoldInput(false)
        setLaborCostRm(normalized.laborCostRm)
        setOtherCostsRm(normalized.otherCostsRm)
        setSellingChannel('middleman')
        setMarketCondition('normal')
        setManualPriceOverride('')
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

  const yieldForecastRequest = useMemo(() => {
    const gridId = String(latestReport?.gridId || latestReport?.zone || firstGridWithCentroid?.id || '').trim()
    const cropType = String(cropDetail?.name || '').trim()
    const treatmentPlan = String(
      latestReport?.treatmentPlan
      || latestReport?.treatment_plan
      || 'recommended treatment',
    ).trim()
    const disease = String(latestReport?.disease || '').trim()
    const lat = Number(firstGridWithCentroid?.centroid?.lat)
    const lng = Number(firstGridWithCentroid?.centroid?.lng)
    const survivalProb = deriveSurvivalProbability(latestReport)

    if (!userId || !gridId || !cropType || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return {
        payload: null,
        error: 'Yield forecast needs signed-in user, mapped grid centroid, and selected crop.',
      }
    }

    if (!disease) {
      return {
        payload: null,
        error: 'Yield forecast is waiting for a diagnosis result from your latest scan.',
      }
    }

    if (!resolvedFarmSizeHectares || resolvedFarmSizeHectares <= 0) {
      return {
        payload: null,
        error: 'Yield forecast needs farm size from crop profile or mapped grids.',
      }
    }

    if (survivalProb === null) {
      return {
        payload: null,
        error: 'Yield forecast needs survival probability from the latest scan.',
      }
    }

    const severityPercent = Number(latestReport?.severity)
    const severityScore = Number.isFinite(Number(latestReport?.severityScore))
      ? Math.max(0, Math.min(1, Number(latestReport?.severityScore)))
      : Math.max(0, Math.min(1, (Number.isFinite(severityPercent) ? severityPercent : 0) / 100))

    return {
      payload: {
        user_id: userId,
        grid_id: gridId,
        lat,
        lng,
        crop_type: cropType,
        disease,
        severity: severityLabel(severityPercent),
        severity_score: severityScore,
        survival_prob: survivalProb,
        farm_size: resolvedFarmSizeHectares,
        treatment_plan: treatmentPlan,
        growth_stage: String(cropDetail?.status || '').trim() || null,
        wind_speed_kmh: 0,
        wind_direction: 'N',
      },
      error: '',
    }
  }, [
    cropDetail?.name,
    cropDetail?.status,
    firstGridWithCentroid?.centroid?.lat,
    firstGridWithCentroid?.centroid?.lng,
    firstGridWithCentroid?.id,
    latestReport,
    resolvedFarmSizeHectares,
    userId,
  ])

  useEffect(() => {
    let active = true

    if (!yieldForecastRequest.payload) {
      setYieldForecast(null)
      setYieldForecastError(yieldForecastRequest.error)
      setIsYieldForecastLoading(false)
      return undefined
    }

    setIsYieldForecastLoading(true)
    setYieldForecastError('')

    runSwarmOrchestrator(yieldForecastRequest.payload)
      .then((response) => {
        if (!active) {
          return
        }

        const forecast = response?.yield_forecast && typeof response.yield_forecast === 'object'
          ? response.yield_forecast
          : null

        if (!forecast) {
          setYieldForecast(null)
          setYieldForecastError('Yield forecast is unavailable in the current swarm response.')
          return
        }

        setYieldForecast(forecast)

        const predicted = toSafeNumber(forecast?.predicted_yield_kg, 0)
        if (predicted > 0 && !hasManualYieldInput) {
          setYieldKg(predicted)
        }

        if (predicted > 0 && !hasManualActualSoldInput) {
          setActualSoldKg(predicted)
        }
      })
      .catch((loadError) => {
        if (!active) {
          return
        }

        setYieldForecast(null)
        setYieldForecastError(loadError?.message || 'Unable to fetch yield forecast from swarm.')
      })
      .finally(() => {
        if (active) {
          setIsYieldForecastLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [
    hasManualActualSoldInput,
    hasManualYieldInput,
    yieldForecastRequest.error,
    yieldForecastRequest.payload,
  ])

  useEffect(() => {
    if (!calculationInput) {
      return undefined
    }

    let active = true
    setIsLoading(true)
    setError('')

    getTreatmentPlan(calculationInput)
      .then((response) => {
        if (!active) {
          return
        }

        setPlan(response)
        saveTreatmentRoiSnapshot({ userId: calculationInput.userId, plan: response })
        saveTreatmentFormSnapshot({
          userId: calculationInput.userId,
          cropId: calculationInput.cropId,
          values: {
            yieldKg: calculationInput.yieldKg,
            actualSoldKg: calculationInput.actualSoldKg,
            laborCostRm: calculationInput.laborCostRm,
            otherCostsRm: calculationInput.otherCostsRm,
            sellingChannel: calculationInput.sellingChannel,
            marketCondition: calculationInput.marketCondition,
            manualPriceOverride: calculationInput.manualPriceOverrideInput,
            hasManualYieldInput: calculationInput.hasManualYieldInput,
            hasManualActualSoldInput: calculationInput.hasManualActualSoldInput,
          },
          plan: response,
        })
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

    return () => {
      active = false
    }
  }, [calculationInput])

  const handleSaveAndCalculate = () => {
    if (!userId || !selectedCropId || !cropDetail) {
      setPlan(null)
      setError('Select a crop before calculating ROI.')
      return
    }

    if (sellingChannel === 'contract' && Number(manualPriceOverride) <= 0) {
      setPlan(null)
      setError('Contract selling requires manual price override (RM/kg).')
      return
    }

    setError('')
    setCalculationInput({
      userId,
      cropId: selectedCropId,
      cropType: cropDetail?.name,
      sellingChannel,
      marketCondition,
      manualPriceOverride: manualPriceOverride === '' ? null : Number(manualPriceOverride),
      manualPriceOverrideInput: manualPriceOverride,
      farmSizeHectares: resolvedFarmSizeHectares,
      survivalProb: deriveSurvivalProbability(latestReport) ?? 1,
      yieldKg,
      actualSoldKg,
      laborCostRm,
      otherCostsRm,
      hasManualYieldInput,
      hasManualActualSoldInput,
      disease: String(latestReport?.disease || 'Crop disease risk').trim(),
      treatmentPlan: String(latestReport?.treatmentPlan || latestReport?.treatment_plan || 'recommended treatment').trim(),
      lat: firstGridWithCentroid?.centroid?.lat,
      lng: firstGridWithCentroid?.centroid?.lng,
    })
  }

  if (isLoadingCrops) {
    return (
      <section className="pg-page pg-page-roi-deep-dive pg-glass-deep-dive">
        <SectionHeader
          title="ROI Deep Dive"
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
    <section className="pg-page pg-page-roi-deep-dive pg-glass-deep-dive">
      <SectionHeader
        title="ROI Deep Dive"
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
          {/* 1. Revenue and cost metrics */}
          <div className="pg-tile-grid pg-deep-dive-metrics">
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
              helper={plan?.roi_note ? `ROI ${plan.roi_note}` : 'updated on save'}
              tone="success"
            />
          </div>

          {/* 2. Breakdown details */}
          <article className="pg-card">
            <h2>Breakdown</h2>
            {isLoading ? <p>Recalculating ROI...</p> : null}

            {plan ? (
              <>
                <p>Retail price: RM {formatMoney(plan.retail_price_rm_per_kg)}/kg</p>
                <p>Farm price: RM {formatMoney(plan.farm_price_rm_per_kg)}/kg</p>
                <p>Price date: {plan.price_date || 'N/A'}</p>
                <p>Yield source: {yieldInputSourceLabel}</p>
                {yieldForecast && !hasManualYieldInput ? (
                  <p>
                    Forecast context: confidence {forecastConfidence.toFixed(2)}, projected loss {forecastLossPercent.toFixed(1)}%.
                  </p>
                ) : null}
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
              </>
            ) : (
              <p>Save your inputs in the Inputs &amp; Assumptions section below to see the full cost breakdown.</p>
            )}
          </article>

          {/* 3. Suggested plan */}
          {plan ? (
            <article className="pg-card">
              <h2>Suggested Plan</h2>
              <p>{plan.recommendation}</p>
              {plan.organic_alternative ? (
                <>
                  <p style={{ marginTop: 10, fontWeight: 600 }}>Organic alternative</p>
                  <p>{plan.organic_alternative}</p>
                </>
              ) : null}
            </article>
          ) : null}

          {/* 4. Live ROI panel */}
          <article className="pg-card">
            <h2>Live ROI Panel</h2>
            <small style={{ display: 'block', marginBottom: 10, opacity: 0.82 }}>
              Adjust inputs in the Inputs &amp; Assumptions section below, then save to recalculate your ROI.
            </small>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="pg-btn pg-btn-primary"
                onClick={handleSaveAndCalculate}
                disabled={!selectedCropId || !cropDetail || isLoading}
              >
                {isLoading ? 'Saving...' : 'Save & Recalculate'}
              </button>
            </div>
            <small style={{ display: 'block', marginTop: 6, opacity: 0.82 }}>
              ROI recalculates only after you click Save &amp; Recalculate.
            </small>
          </article>

          {/* 5. Inputs and assumptions (moved to bottom) */}
          <article className="pg-card">
            <h2>Inputs &amp; Assumptions</h2>

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
              onChange={(event) => {
                setHasManualYieldInput(true)
                setYieldKg(toSafeNumber(event.target.value, 0))
              }}
              style={{ width: '100%' }}
            />

            <small style={{ display: 'block', marginTop: 4, opacity: 0.82 }}>
              {isYieldForecastLoading
                ? 'Syncing yield forecast from swarm...'
                : hasManualYieldInput
                  ? 'Yield source: manual input (forecast auto-fill paused).'
                  : predictedYieldKg > 0
                    ? `Yield source: swarm forecast (${predictedYieldKg.toFixed(1)} kg, confidence ${forecastConfidence.toFixed(2)}, loss ${forecastLossPercent.toFixed(1)}%).`
                    : yieldForecastError || 'Yield source: crop profile expected yield.'}
            </small>

            <label className="pg-field-label" htmlFor="pg-treatment-actual">Actual sold (kg)</label>
            <input
              id="pg-treatment-actual"
              className="pg-input"
              type="number"
              min="0"
              step="0.1"
              value={actualSoldKg}
              onChange={(event) => {
                setHasManualActualSoldInput(true)
                setActualSoldKg(toSafeNumber(event.target.value, 0))
              }}
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
        </>
      )}
    </section>
  )
}
