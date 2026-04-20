import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SectionHeader from '../../components/ui/SectionHeader'
import BackButton from '../../components/navigation/BackButton'
import SkeletonBlock from '../../components/feedback/SkeletonBlock'
import { getCropById, getCrops } from '../../api/crops'
import { getCachedTreatmentPlan, getTreatmentPlan, setCachedTreatmentPlan } from '../../api/treatment'
import { getTreatmentFormSnapshot, saveTreatmentFormSnapshot, saveTreatmentRoiSnapshot } from '../../utils/treatmentRoiCache'
import { useSessionContext } from '../../hooks/useSessionContext'
import { useScanHistory } from '../../hooks/useScanHistory'
import { useGrids } from '../../hooks/useGrids'

const CACHE_REFRESH_THROTTLE_MS = 15000

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

function deriveSurvivalProbability(report) {
  const explicitValue = Number(report?.survivalProb ?? report?.survival_prob)
  if (Number.isFinite(explicitValue)) return Math.max(0, Math.min(1, explicitValue))
  const severity = Number(report?.severity)
  if (!Number.isFinite(severity)) return null
  return Math.max(0.05, Math.min(0.95, 1 - severity / 100))
}

function getCachedPlanForCrop(userId, cropId) {
  const safeCropId = String(cropId || '').trim()
  const cached = getCachedTreatmentPlan(userId)
  const cachedCropId = String(cached?.input?.cropId || '').trim()

  if (!safeCropId || !cached || cachedCropId !== safeCropId) {
    return null
  }

  return cached.plan && typeof cached.plan === 'object' ? cached.plan : null
}

export default function TreatmentPlan() {
  const navigate = useNavigate()
  const { user, profile } = useSessionContext()
  const { latestReport } = useScanHistory()
  const { grids } = useGrids()

  const [crops, setCrops] = useState([])
  const [selectedCropId, setSelectedCropId] = useState('')
  const [cropDetail, setCropDetail] = useState(null)
  const [plan, setPlan] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingCrops, setIsLoadingCrops] = useState(true)
  const [error, setError] = useState('')
  const selectedCropIdRef = useRef('')

  const userId = String(user?.uid || '').trim()

  const firstGridWithCentroid = useMemo(
    () => grids.find((g) => Number.isFinite(g?.centroid?.lat) && Number.isFinite(g?.centroid?.lng)),
    [grids],
  )

  const totalAreaHectares = useMemo(
    () => grids.reduce((sum, g) => sum + toSafeNumber(g?.areaHectares, 0), 0),
    [grids],
  )

  const resolvedFarmSizeHectares = useMemo(() => {
    const cropArea = toSafeNumber(cropDetail?.areaHectares, 0)
    if (cropArea > 0) return cropArea
    return totalAreaHectares > 0 ? totalAreaHectares : null
  }, [cropDetail?.areaHectares, totalAreaHectares])

  useEffect(() => {
    selectedCropIdRef.current = selectedCropId
  }, [selectedCropId])

  useEffect(() => {
    if (!userId) {
      setPlan(null)
      return undefined
    }

    const cached = getCachedTreatmentPlan(userId)
    const cachedCropId = String(cached?.input?.cropId || '').trim()
    const cachedPlan = cached?.plan && typeof cached.plan === 'object' ? cached.plan : null

    const persistedForm = getTreatmentFormSnapshot(userId)
    const persistedCropId = String(persistedForm?.selectedCropId || '').trim()
    const persistedPlan = persistedForm?.values?.plan && typeof persistedForm.values.plan === 'object'
      ? persistedForm.values.plan
      : null

    if (cachedCropId) {
      setSelectedCropId((current) => current || cachedCropId)
    } else if (persistedCropId) {
      setSelectedCropId((current) => current || persistedCropId)
    }

    if (cachedPlan) {
      setPlan(cachedPlan)
    } else if (persistedPlan) {
      setPlan(persistedPlan)
    }

    return undefined
  }, [userId])

  useEffect(() => {
    let active = true

    if (!userId) {
      return undefined
    }

    const cached = getCachedTreatmentPlan(userId)
    const cachedInput = cached?.input
    const cachedPlan = cached?.plan
    const cachedCropId = String(cachedInput?.cropId || '').trim()
    const cachedRefreshedAt = Number(cached?.refreshedAt)

    if (!cachedInput || typeof cachedInput !== 'object' || !cachedPlan || typeof cachedPlan !== 'object') {
      return undefined
    }

    if (Number.isFinite(cachedRefreshedAt) && cachedRefreshedAt > 0 && Date.now() - cachedRefreshedAt < CACHE_REFRESH_THROTTLE_MS) {
      return undefined
    }

    // Mark refresh start to avoid duplicate calls during React StrictMode remount checks.
    setCachedTreatmentPlan({ userId, input: cachedInput, plan: cachedPlan, refreshedAt: Date.now() })
    setIsLoading(true)
    setError('')

    getTreatmentPlan(cachedInput)
      .then((response) => {
        setCachedTreatmentPlan({ userId, input: cachedInput, plan: response, refreshedAt: Date.now() })
        saveTreatmentRoiSnapshot({ userId, plan: response })
        if (cachedCropId) {
          saveTreatmentFormSnapshot({ userId, cropId: cachedCropId, values: { ...cachedInput, plan: response }, plan: response })
        }
        if (!active) return
        if (!selectedCropIdRef.current || selectedCropIdRef.current === cachedCropId) {
          setPlan(response)
        }
      })
      .catch((err) => {
        if (!active) return
        setError(err?.message || 'Unable to refresh cached treatment plan')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
    }
  }, [userId])

  useEffect(() => {
    let active = true
    if (!userId) { setIsLoadingCrops(false); return undefined }
    setIsLoadingCrops(true)
    getCrops({ userId })
      .then((response) => {
        if (!active) return
        const nextCrops = Array.isArray(response?.items) ? response.items.map(normalizeCrop) : []
        setCrops(nextCrops)
        const cachedInMemoryCropId = String(getCachedTreatmentPlan(userId)?.input?.cropId || '').trim()
        if (cachedInMemoryCropId && nextCrops.some((c) => c.id === cachedInMemoryCropId)) {
          setSelectedCropId(cachedInMemoryCropId)
          return
        }
        const cached = String(getTreatmentFormSnapshot(userId)?.selectedCropId || '').trim()
        if (cached && nextCrops.some((c) => c.id === cached)) { setSelectedCropId(cached); return }
        const preferred = String(profile?.activeCropId || '').trim()
        if (preferred && nextCrops.some((c) => c.id === preferred)) { setSelectedCropId(preferred); return }
        setSelectedCropId(nextCrops[0]?.id || '')
      })
      .catch(() => { if (active) { setCrops([]); setSelectedCropId('') } })
      .finally(() => { if (active) setIsLoadingCrops(false) })
    return () => { active = false }
  }, [profile?.activeCropId, userId])

  useEffect(() => {
    let active = true
    if (!userId || !selectedCropId) { setCropDetail(null); setPlan(null); return undefined }
    getCropById(selectedCropId, { userId })
      .then((response) => {
        if (!active) return
        const normalized = normalizeCrop(response)
        setCropDetail(normalized)
        setPlan(getCachedPlanForCrop(userId, selectedCropId))
      })
      .catch(() => {
        if (!active) return
        setCropDetail(null)
        setPlan(getCachedPlanForCrop(userId, selectedCropId))
      })
    return () => { active = false }
  }, [selectedCropId, userId])

  const handleCropChange = (event) => {
    const nextCropId = String(event.target.value || '').trim()
    setSelectedCropId(nextCropId)

    const cachedCropId = String(getCachedTreatmentPlan(userId)?.input?.cropId || '').trim()
    if (!cachedCropId || cachedCropId !== nextCropId) {
      setPlan(null)
    }
  }

  const handleCalculate = () => {
    if (!userId || !selectedCropId || !cropDetail) return
    setIsLoading(true)
    setError('')
    const input = {
      userId,
      cropId: selectedCropId,
      cropType: cropDetail.name,
      sellingChannel: 'middleman',
      marketCondition: 'normal',
      manualPriceOverride: null,
      manualPriceOverrideInput: '',
      farmSizeHectares: resolvedFarmSizeHectares,
      survivalProb: deriveSurvivalProbability(latestReport) ?? 1,
      yieldKg: cropDetail.expectedYieldKg,
      actualSoldKg: cropDetail.expectedYieldKg,
      laborCostRm: cropDetail.laborCostRm,
      otherCostsRm: cropDetail.otherCostsRm,
      hasManualYieldInput: false,
      hasManualActualSoldInput: false,
      disease: String(latestReport?.disease || 'Crop disease risk').trim(),
      treatmentPlan: String(latestReport?.treatmentPlan || latestReport?.treatment_plan || 'recommended treatment').trim(),
      lat: firstGridWithCentroid?.centroid?.lat,
      lng: firstGridWithCentroid?.centroid?.lng,
    }
    getTreatmentPlan(input)
      .then((response) => {
        setPlan(response)
        setCachedTreatmentPlan({ userId, input, plan: response, refreshedAt: Date.now() })
        saveTreatmentRoiSnapshot({ userId, plan: response })
        saveTreatmentFormSnapshot({ userId, cropId: selectedCropId, values: { ...input, plan: response }, plan: response })
      })
      .catch((err) => setError(err?.message || 'Unable to load treatment plan'))
      .finally(() => setIsLoading(false))
  }

  return (
    <section className="pg-page pg-page-treatment-plan pg-glass-deep-dive">
      <SectionHeader
        title="Treatment Plan"
        align="center"
        leadingAction={<BackButton fallback="/app" label="Back to home" />}
      />

      {error ? <article className="pg-card"><p>{error}</p></article> : null}

      {crops.length === 0 && !isLoadingCrops ? (
        <article className="pg-card">
          <h2>Add your first crop</h2>
          <p>Add a crop profile to unlock treatment plan guidance.</p>
          <button type="button" className="pg-btn pg-btn-primary" onClick={() => navigate('/app/crops')}>
            Manage Crops
          </button>
        </article>
      ) : (
        <>
          {isLoadingCrops ? (
            <article className="pg-card">
              <label className="pg-field-label" htmlFor="pg-tp-crop-loading">Crop</label>
              <select id="pg-tp-crop-loading" className="pg-input" value="" disabled>
                <option>Loading crops...</option>
              </select>
              <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                <SkeletonBlock width="58%" height={12} rounded={8} />
                <SkeletonBlock width="32%" height={34} rounded={10} />
              </div>
            </article>
          ) : crops.length > 0 ? (
            <article className="pg-card">
              <label className="pg-field-label" htmlFor="pg-tp-crop">Crop</label>
              <select
                id="pg-tp-crop"
                className="pg-input"
                value={selectedCropId}
                onChange={handleCropChange}
              >
                {crops.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <button
                  type="button"
                  className="pg-btn pg-btn-primary"
                  onClick={handleCalculate}
                  disabled={!selectedCropId || !cropDetail || isLoading || isLoadingCrops}
                >
                  {isLoading ? 'Loading...' : 'Load Plan'}
                </button>
              </div>
            </article>
          ) : null}

          {plan ? (
            <>
              <article className="pg-card">
                <h2>Recommended Treatment</h2>
                <p>{plan.recommendation || 'No recommendation available.'}</p>
              </article>

              <article className="pg-card">
                <h2>Organic Alternative</h2>
                <p>{plan.organic_alternative || 'No organic alternative available.'}</p>
              </article>

              <article className="pg-card">
                <h2>Cost Composition</h2>
                <p>Inventory cost: RM {formatMoney(plan.inventory_cost_rm)}</p>
                <p>Labor cost: RM {formatMoney(plan.labor_cost_rm)}</p>
                <p>Other costs: RM {formatMoney(plan.other_costs_rm)}</p>
                <p><strong>Total estimated cost: RM {formatMoney(plan.estimated_cost_rm)}</strong></p>
                <p>Selling channel: {plan.selling_channel || 'middleman'}</p>
                <p>Market condition: {plan.market_condition || 'normal'}</p>
              </article>

              <article className="pg-card">
                <h2>Inventory Usage</h2>
                {Array.isArray(plan.inventory_breakdown) && plan.inventory_breakdown.length > 0 ? (
                  <ul>
                    {plan.inventory_breakdown.map((line) => (
                      <li key={line.inventory_id}>
                        {line.name}: {toSafeNumber(line.quantity_used).toFixed(2)} x RM {formatMoney(line.cost_per_unit_rm)} = RM {formatMoney(line.line_cost_rm)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No inventory usage linked to this crop yet.</p>
                )}
              </article>
            </>
          ) : (
            <article className="pg-card">
              {isLoadingCrops ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <SkeletonBlock width="74%" height={13} rounded={8} />
                  <SkeletonBlock width="66%" height={13} rounded={8} />
                </div>
              ) : (
                <p>Select a crop and click Load Plan to view treatment guidance.</p>
              )}
            </article>
          )}

          <article className="pg-card">
            <h2>Next Steps</h2>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="pg-btn pg-btn-primary" onClick={() => navigate('/app/treatment')}>
                View ROI Deep Dive
              </button>
              <button type="button" className="pg-btn pg-btn-inline" onClick={() => navigate('/app/inventory')}>
                Manage Inventory
              </button>
            </div>
          </article>
        </>
      )}
    </section>
  )
}
