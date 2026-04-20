import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SectionHeader from '../../components/ui/SectionHeader'
import MetricTile from '../../components/ui/MetricTile'
import BackButton from '../../components/navigation/BackButton'
import SkeletonBlock from '../../components/feedback/SkeletonBlock'
import { getCropById, getCrops, updateCrop } from '../../api/crops'
import { runSwarmOrchestrator } from '../../api/swarm'
import { getTreatmentPlan } from '../../api/treatment'
import { getTreatmentFormSnapshot, saveTreatmentFormSnapshot, saveTreatmentRoiSnapshot } from '../../utils/treatmentRoiCache'
import { getYieldForecastCache, saveYieldForecastCache, YIELD_FORECAST_CACHE_TTL_MS } from '../../utils/yieldForecastCache'
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
  const { latestReport, isLoading: isScanHistoryLoading } = useScanHistory()
  const { grids, isLoading: isGridsLoading } = useGrids()

  const [crops, setCrops] = useState([])
  const [selectedCropId, setSelectedCropId] = useState('')
  const [cropDetail, setCropDetail] = useState(null)
  const [yieldKg, setYieldKg] = useState(0)
  const [actualSoldKg, setActualSoldKg] = useState('')
  const [laborCostRm, setLaborCostRm] = useState('')
  const [otherCostsRm, setOtherCostsRm] = useState('')
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
  const [isSavingCrop, setIsSavingCrop] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingCrops, setIsLoadingCrops] = useState(true)

  const userId = String(user?.uid || '').trim()
  const isPrerequisiteLoading = isLoadingCrops || isScanHistoryLoading || isGridsLoading

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
          setActualSoldKg(
            typeof cachedForm.actualSoldKgInput === 'string'
              ? cachedForm.actualSoldKgInput
              : String(toSafeNumber(cachedForm.actualSoldKg, normalized.expectedYieldKg)),
          )
          setLaborCostRm(
            typeof cachedForm.laborCostRmInput === 'string'
              ? cachedForm.laborCostRmInput
              : String(toSafeNumber(cachedForm.laborCostRm, normalized.laborCostRm)),
          )
          setOtherCostsRm(
            typeof cachedForm.otherCostsRmInput === 'string'
              ? cachedForm.otherCostsRmInput
              : String(toSafeNumber(cachedForm.otherCostsRm, normalized.otherCostsRm)),
          )
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
        setActualSoldKg(String(normalized.expectedYieldKg))
        setHasManualYieldInput(false)
        setHasManualActualSoldInput(false)
        setLaborCostRm(String(normalized.laborCostRm))
        setOtherCostsRm(String(normalized.otherCostsRm))
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
    if (isPrerequisiteLoading) {
      return {
        payload: null,
        error: '',
        waiting: true,
      }
    }

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
        waiting: false,
      }
    }

    if (!disease) {
      return {
        payload: null,
        error: 'Yield forecast is waiting for a diagnosis result from your latest scan.',
        waiting: false,
      }
    }

    if (!resolvedFarmSizeHectares || resolvedFarmSizeHectares <= 0) {
      return {
        payload: null,
        error: 'Yield forecast needs farm size from crop profile or mapped grids.',
        waiting: false,
      }
    }

    if (survivalProb === null) {
      return {
        payload: null,
        error: 'Yield forecast needs survival probability from the latest scan.',
        waiting: false,
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
      waiting: false,
    }
  }, [
    cropDetail?.name,
    cropDetail?.status,
    firstGridWithCentroid?.centroid?.lat,
    firstGridWithCentroid?.centroid?.lng,
    firstGridWithCentroid?.id,
    isPrerequisiteLoading,
    latestReport,
    resolvedFarmSizeHectares,
    userId,
  ])

  useEffect(() => {
    let active = true
    const payload = yieldForecastRequest.payload

    if (!payload) {
      setYieldForecast(null)
      setYieldForecastError(yieldForecastRequest.error)
      setIsYieldForecastLoading(false)
      return undefined
    }

    const cachedForecast = getYieldForecastCache({
      userId,
      payload,
      ttlMs: YIELD_FORECAST_CACHE_TTL_MS,
      includeStale: true,
    })

    if (cachedForecast?.forecast) {
      setYieldForecast(cachedForecast.forecast)
      setYieldForecastError('')

      const cachedPredictedYield = toSafeNumber(cachedForecast.forecast?.predicted_yield_kg, 0)
      if (cachedPredictedYield > 0 && !hasManualYieldInput) {
        setYieldKg(cachedPredictedYield)
      }

      if (cachedPredictedYield > 0 && !hasManualActualSoldInput) {
        setActualSoldKg(String(cachedPredictedYield))
      }

      if (cachedForecast.isFresh) {
        setIsYieldForecastLoading(false)
        return () => {
          active = false
        }
      }
    }

    setIsYieldForecastLoading(true)
    setYieldForecastError('')

    runSwarmOrchestrator(payload)
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
        saveYieldForecastCache({ userId, payload, forecast })

        const predicted = toSafeNumber(forecast?.predicted_yield_kg, 0)
        if (predicted > 0 && !hasManualYieldInput) {
          setYieldKg(predicted)
        }

        if (predicted > 0 && !hasManualActualSoldInput) {
          setActualSoldKg(String(predicted))
        }
      })
      .catch((loadError) => {
        if (!active) {
          return
        }

        if (!cachedForecast?.forecast) {
          setYieldForecast(null)
        }
        setYieldForecastError(
          cachedForecast?.forecast
            ? 'Showing cached forecast. Live refresh failed.'
            : (loadError?.message || 'Unable to fetch yield forecast from swarm.'),
        )
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
    userId,
  ])

  useEffect(() => {
    if (!calculationInput) {
      return undefined
    }

    const requestInput = {
      ...calculationInput,
    }
    const rawInputs = requestInput.rawInputs && typeof requestInput.rawInputs === 'object'
      ? requestInput.rawInputs
      : {}
    delete requestInput.rawInputs

    let active = true
    setIsLoading(true)
    setError('')

    getTreatmentPlan(requestInput)
      .then((response) => {
        if (!active) {
          return
        }

        setPlan(response)
        saveTreatmentRoiSnapshot({ userId: requestInput.userId, plan: response })
        saveTreatmentFormSnapshot({
          userId: requestInput.userId,
          cropId: requestInput.cropId,
          values: {
            yieldKg: requestInput.yieldKg,
            actualSoldKg: requestInput.actualSoldKg,
            laborCostRm: requestInput.laborCostRm,
            otherCostsRm: requestInput.otherCostsRm,
            actualSoldKgInput: String(rawInputs.actualSoldKgInput ?? ''),
            laborCostRmInput: String(rawInputs.laborCostRmInput ?? ''),
            otherCostsRmInput: String(rawInputs.otherCostsRmInput ?? ''),
            sellingChannel: requestInput.sellingChannel,
            marketCondition: requestInput.marketCondition,
            manualPriceOverride: requestInput.manualPriceOverrideInput,
            hasManualYieldInput: requestInput.hasManualYieldInput,
            hasManualActualSoldInput: requestInput.hasManualActualSoldInput,
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

  function validateCalculationInput() {
    if (!userId || !selectedCropId || !cropDetail) {
      setPlan(null)
      setError('Select a crop before calculating ROI.')
      return false
    }

    if (sellingChannel === 'contract' && Number(manualPriceOverride) <= 0) {
      setPlan(null)
      setError('Contract selling requires manual price override (RM/kg).')
      return false
    }

    return true
  }

  function buildCalculationInput() {
    const safeYieldKg = Math.max(0, toSafeNumber(yieldKg, 0))
    const safeActualSoldKg = Math.max(0, toSafeNumber(actualSoldKg, 0))
    const safeLaborCostRm = Math.max(0, toSafeNumber(laborCostRm, 0))
    const safeOtherCostsRm = Math.max(0, toSafeNumber(otherCostsRm, 0))

    return {
      userId,
      cropId: selectedCropId,
      cropType: cropDetail?.name,
      sellingChannel,
      marketCondition,
      manualPriceOverride: manualPriceOverride === '' ? null : Number(manualPriceOverride),
      manualPriceOverrideInput: manualPriceOverride,
      farmSizeHectares: resolvedFarmSizeHectares,
      survivalProb: deriveSurvivalProbability(latestReport) ?? 1,
      yieldKg: safeYieldKg,
      actualSoldKg: safeActualSoldKg,
      laborCostRm: safeLaborCostRm,
      otherCostsRm: safeOtherCostsRm,
      hasManualYieldInput,
      hasManualActualSoldInput,
      disease: String(latestReport?.disease || 'Crop disease risk').trim(),
      treatmentPlan: String(latestReport?.treatmentPlan || latestReport?.treatment_plan || 'recommended treatment').trim(),
      lat: firstGridWithCentroid?.centroid?.lat,
      lng: firstGridWithCentroid?.centroid?.lng,
      rawInputs: {
        actualSoldKgInput: actualSoldKg,
        laborCostRmInput: laborCostRm,
        otherCostsRmInput: otherCostsRm,
      },
    }
  }

  const handleRecalculateOnly = () => {
    if (!validateCalculationInput()) {
      return
    }

    setError('')
    setCalculationInput(buildCalculationInput())
  }

  const handleSaveAndCalculate = async () => {
    if (!validateCalculationInput()) {
      return
    }

    const safeExpectedYieldKg = Math.max(0, toSafeNumber(yieldKg, 0))
    const safeLaborCostRm = Math.max(0, toSafeNumber(laborCostRm, 0))
    const safeOtherCostsRm = Math.max(0, toSafeNumber(otherCostsRm, 0))

    setError('')
    setIsSavingCrop(true)

    try {
      await updateCrop(selectedCropId, {
        userId,
        expectedYieldKg: safeExpectedYieldKg,
        laborCostRm: safeLaborCostRm,
        otherCostsRm: safeOtherCostsRm,
      })

      setCropDetail((current) => {
        if (!current) {
          return current
        }

        return {
          ...current,
          expectedYieldKg: safeExpectedYieldKg,
          laborCostRm: safeLaborCostRm,
          otherCostsRm: safeOtherCostsRm,
        }
      })
    } catch (saveError) {
      setError(saveError?.message || 'Unable to save crop profile')
      return
    } finally {
      setIsSavingCrop(false)
    }

    setCalculationInput(buildCalculationInput())
  }

  const showEmptyState = !isLoadingCrops && crops.length === 0

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

      {showEmptyState ? (
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
              helper={plan?.roi_note ? `ROI ${plan.roi_note}` : 'updated on recalculation'}
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
              <p>
                {isLoadingCrops
                  ? 'Loading crop ROI setup...'
                  : 'Save your inputs in the Inputs &amp; Assumptions section below to see the full cost breakdown.'}
              </p>
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
              Adjust inputs below, then choose whether to recalculate only or save and recalculate.
            </small>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="pg-btn"
                onClick={handleRecalculateOnly}
                disabled={!selectedCropId || !cropDetail || isLoading || isSavingCrop || isLoadingCrops}
              >
                {isLoading ? 'Calculating...' : 'Recalculate Only'}
              </button>
              <button
                type="button"
                className="pg-btn pg-btn-primary"
                onClick={handleSaveAndCalculate}
                disabled={!selectedCropId || !cropDetail || isLoading || isSavingCrop || isLoadingCrops}
              >
                {isSavingCrop ? 'Saving...' : isLoading ? 'Calculating...' : 'Save & Recalculate'}
              </button>
            </div>
            <small style={{ display: 'block', marginTop: 6, opacity: 0.82 }}>
              Recalculate Only updates ROI without saving crop values.
            </small>
          </article>

          {/* 5. Inputs and assumptions (moved to bottom) */}
          <article className="pg-card">
            <h2>Inputs &amp; Assumptions</h2>

            {isLoadingCrops ? (
              <>
                <label className="pg-field-label" htmlFor="pg-treatment-crop-loading">Crop</label>
                <select id="pg-treatment-crop-loading" className="pg-input" value="" disabled>
                  <option>Loading crops...</option>
                </select>
                <div style={{ marginTop: 10 }}>
                  <SkeletonBlock width="58%" height={12} rounded={8} />
                </div>
              </>
            ) : (
              <>
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
              </>
            )}

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
              {isPrerequisiteLoading
                ? 'Loading yield forecast inputs...'
                : isYieldForecastLoading
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
                setActualSoldKg(event.target.value)
              }}
              onWheel={(event) => event.currentTarget.blur()}
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
                  onWheel={(event) => event.currentTarget.blur()}
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
              onChange={(event) => setLaborCostRm(event.target.value)}
              onWheel={(event) => event.currentTarget.blur()}
            />

            <label className="pg-field-label" htmlFor="pg-treatment-other">Other costs (RM)</label>
            <input
              id="pg-treatment-other"
              className="pg-input"
              type="number"
              min="0"
              step="0.01"
              value={otherCostsRm}
              onChange={(event) => setOtherCostsRm(event.target.value)}
              onWheel={(event) => event.currentTarget.blur()}
            />
          </article>
        </>
      )}
    </section>
  )
}
