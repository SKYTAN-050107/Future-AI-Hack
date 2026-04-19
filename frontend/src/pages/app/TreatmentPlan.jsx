import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SectionHeader from '../../components/ui/SectionHeader'
import BackButton from '../../components/navigation/BackButton'
import { getCropById, getCrops } from '../../api/crops'
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

function deriveSurvivalProbability(report) {
  const explicitValue = Number(report?.survivalProb ?? report?.survival_prob)
  if (Number.isFinite(explicitValue)) return Math.max(0, Math.min(1, explicitValue))
  const severity = Number(report?.severity)
  if (!Number.isFinite(severity)) return null
  return Math.max(0.05, Math.min(0.95, 1 - severity / 100))
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
    let active = true
    if (!userId) { setIsLoadingCrops(false); return undefined }
    setIsLoadingCrops(true)
    getCrops({ userId })
      .then((response) => {
        if (!active) return
        const nextCrops = Array.isArray(response?.items) ? response.items.map(normalizeCrop) : []
        setCrops(nextCrops)
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
        const cachedForm = getTreatmentFormSnapshot(userId, selectedCropId)?.values
        if (cachedForm?.plan) { setPlan(cachedForm.plan) } else { setPlan(null) }
      })
      .catch(() => { if (active) { setCropDetail(null); setPlan(null) } })
    return () => { active = false }
  }, [selectedCropId, userId])

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
        saveTreatmentRoiSnapshot({ userId, plan: response })
        saveTreatmentFormSnapshot({ userId, cropId: selectedCropId, values: { ...input, plan: response }, plan: response })
      })
      .catch((err) => setError(err?.message || 'Unable to load treatment plan'))
      .finally(() => setIsLoading(false))
  }

  if (isLoadingCrops) {
    return (
      <section className="pg-page pg-page-treatment-plan pg-glass-deep-dive">
        <SectionHeader title="Treatment Plan" align="center" leadingAction={<BackButton fallback="/app" label="Back to home" />} />
        <article className="pg-card"><p>Loading...</p></article>
      </section>
    )
  }

  return (
    <section className="pg-page pg-page-treatment-plan pg-glass-deep-dive">
      <SectionHeader
        title="Treatment Plan"
        align="center"
        leadingAction={<BackButton fallback="/app" label="Back to home" />}
      />

      {error ? <article className="pg-card"><p>{error}</p></article> : null}

      {crops.length === 0 ? (
        <article className="pg-card">
          <h2>Add your first crop</h2>
          <p>Add a crop profile to unlock treatment plan guidance.</p>
          <button type="button" className="pg-btn pg-btn-primary" onClick={() => navigate('/app/crops')}>
            Manage Crops
          </button>
        </article>
      ) : (
        <>
          <article className="pg-card">
            <label className="pg-field-label" htmlFor="pg-tp-crop">Crop</label>
            <select
              id="pg-tp-crop"
              className="pg-input"
              value={selectedCropId}
              onChange={(e) => setSelectedCropId(e.target.value)}
            >
              {crops.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button
                type="button"
                className="pg-btn pg-btn-primary"
                onClick={handleCalculate}
                disabled={!selectedCropId || !cropDetail || isLoading}
              >
                {isLoading ? 'Loading...' : 'Load Plan'}
              </button>
            </div>
          </article>

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
              <p>Select a crop and click Load Plan to view treatment guidance.</p>
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
