import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SectionHeader from '../../components/ui/SectionHeader'
import BackButton from '../../components/navigation/BackButton'
import { getCrops } from '../../api/crops'
import { runSwarmOrchestrator } from '../../api/swarm'
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
    status: String(rawCrop?.status || 'growing').trim().toLowerCase() || 'growing',
  }
}

function deriveSurvivalProbability(report) {
  const explicitValue = Number(report?.survivalProb ?? report?.survival_prob)
  if (Number.isFinite(explicitValue)) return Math.max(0, Math.min(1, explicitValue))
  const severity = Number(report?.severity)
  if (!Number.isFinite(severity)) return null
  return Math.max(0.05, Math.min(0.95, 1 - severity / 100))
}

function severityLabel(value) {
  if (value >= 70) return 'High'
  if (value >= 40) return 'Medium'
  return 'Low'
}

function ConfidenceBar({ value }) {
  const pct = Math.max(0, Math.min(1, toSafeNumber(value, 0))) * 100
  const toneClass = pct >= 70 ? 'is-high' : pct >= 40 ? 'is-medium' : 'is-low'
  return (
    <div
      className="pg-yield-confidence-track"
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`pg-yield-confidence-fill ${toneClass}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function YieldPrediction() {
  const navigate = useNavigate()
  const { user, profile } = useSessionContext()
  const { latestReport } = useScanHistory()
  const { grids } = useGrids()

  const [crops, setCrops] = useState([])
  const [selectedCropId, setSelectedCropId] = useState('')
  const [selectedCrop, setSelectedCrop] = useState(null)
  const [isLoadingCrops, setIsLoadingCrops] = useState(true)
  const [yieldForecast, setYieldForecast] = useState(null)
  const [forecastError, setForecastError] = useState('')
  const [isForecastLoading, setIsForecastLoading] = useState(false)

  const userId = String(user?.uid || '').trim()

  const firstGridWithCentroid = useMemo(
    () => grids.find((g) => Number.isFinite(g?.centroid?.lat) && Number.isFinite(g?.centroid?.lng)),
    [grids],
  )

  const totalAreaHectares = useMemo(
    () => grids.reduce((sum, g) => sum + toSafeNumber(g?.areaHectares, 0), 0),
    [grids],
  )

  useEffect(() => {
    let active = true
    if (!userId) { setIsLoadingCrops(false); return undefined }
    setIsLoadingCrops(true)
    getCrops({ userId })
      .then((res) => {
        if (!active) return
        const list = Array.isArray(res?.items) ? res.items.map(normalizeCrop) : []
        setCrops(list)
        const preferred = String(profile?.activeCropId || '').trim()
        if (preferred && list.some((c) => c.id === preferred)) {
          setSelectedCropId(preferred)
          setSelectedCrop(list.find((c) => c.id === preferred) || null)
          return
        }
        if (list.length > 0) { setSelectedCropId(list[0].id); setSelectedCrop(list[0]) }
      })
      .catch(() => { if (active) setCrops([]) })
      .finally(() => { if (active) setIsLoadingCrops(false) })
    return () => { active = false }
  }, [profile?.activeCropId, userId])

  const resolvedFarmSize = useMemo(() => {
    const cropArea = toSafeNumber(selectedCrop?.areaHectares, 0)
    if (cropArea > 0) return cropArea
    return totalAreaHectares > 0 ? totalAreaHectares : null
  }, [selectedCrop?.areaHectares, totalAreaHectares])

  const forecastPayload = useMemo(() => {
    const gridId = String(latestReport?.gridId || latestReport?.zone || firstGridWithCentroid?.id || '').trim()
    const cropType = String(selectedCrop?.name || '').trim()
    const disease = String(latestReport?.disease || '').trim()
    const lat = Number(firstGridWithCentroid?.centroid?.lat)
    const lng = Number(firstGridWithCentroid?.centroid?.lng)
    const survivalProb = deriveSurvivalProbability(latestReport)

    const missing = []
    if (!userId) missing.push('Sign in to your account')
    if (!gridId) missing.push('Draw or assign a farm grid on the Map')
    if (!cropType) missing.push('Select a crop')
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) missing.push('Farm grid needs a centroid (set on Map)')
    if (!disease) missing.push('Scan a crop for a disease diagnosis')
    if (!resolvedFarmSize || resolvedFarmSize <= 0) missing.push('Add farm size via crop profile or mapped grids')
    if (survivalProb === null) missing.push('Latest scan needs severity data')

    if (missing.length > 0) return { payload: null, missing }

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
        farm_size: resolvedFarmSize,
        treatment_plan: String(latestReport?.treatmentPlan || latestReport?.treatment_plan || 'recommended treatment').trim(),
        growth_stage: String(selectedCrop?.status || '').trim() || null,
        wind_speed_kmh: 0,
        wind_direction: 'N',
      },
      missing: [],
    }
  }, [firstGridWithCentroid, latestReport, resolvedFarmSize, selectedCrop, userId])

  useEffect(() => {
    let active = true
    if (!forecastPayload.payload) {
      setYieldForecast(null)
      setForecastError('')
      setIsForecastLoading(false)
      return undefined
    }
    setIsForecastLoading(true)
    setForecastError('')
    runSwarmOrchestrator(forecastPayload.payload)
      .then((res) => {
        if (!active) return
        const forecast = res?.yield_forecast && typeof res.yield_forecast === 'object' ? res.yield_forecast : null
        if (!forecast) { setForecastError('Yield forecast unavailable in swarm response.'); return }
        setYieldForecast(forecast)
      })
      .catch((err) => {
        if (!active) return
        setForecastError(err?.message || 'Unable to fetch yield forecast from swarm.')
      })
      .finally(() => { if (active) setIsForecastLoading(false) })
    return () => { active = false }
  }, [forecastPayload.payload])

  const predictedYieldKg = toSafeNumber(yieldForecast?.predicted_yield_kg, 0)
  const confidence = toSafeNumber(yieldForecast?.confidence, 0)
  const yieldLossPercent = toSafeNumber(yieldForecast?.yield_loss_percent, 0)

  if (isLoadingCrops) {
    return (
      <section className="pg-page pg-page-yield-prediction pg-glass-deep-dive">
        <SectionHeader title="Yield Prediction" align="center" leadingAction={<BackButton fallback="/app" label="Back to home" />} />
        <article className="pg-card"><p>Loading...</p></article>
      </section>
    )
  }

  return (
    <section className="pg-page pg-page-yield-prediction pg-glass-deep-dive">
      <SectionHeader
        title="Yield Prediction"
        align="center"
        leadingAction={<BackButton fallback="/app" label="Back to home" />}
      />

      {crops.length > 0 ? (
        <article className="pg-card">
          <label className="pg-field-label" htmlFor="pg-yp-crop">Crop</label>
          <select
            id="pg-yp-crop"
            className="pg-input"
            value={selectedCropId}
            onChange={(e) => {
              setSelectedCropId(e.target.value)
              setSelectedCrop(crops.find((c) => c.id === e.target.value) || null)
            }}
          >
            {crops.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </article>
      ) : (
        <article className="pg-card">
          <h2>Add a crop</h2>
          <p>Add a crop profile to unlock yield prediction.</p>
          <button type="button" className="pg-btn pg-btn-primary" onClick={() => navigate('/app/crops')}>Manage Crops</button>
        </article>
      )}

      {forecastPayload.missing.length > 0 ? (
        <article className="pg-card">
          <h2>Missing Inputs</h2>
          <p>The following inputs are needed before a yield forecast can run:</p>
          <ul>
            {forecastPayload.missing.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </article>
      ) : null}

      {isForecastLoading ? (
        <article className="pg-card"><p>Fetching yield forecast from swarm...</p></article>
      ) : forecastError ? (
        <article className="pg-card"><p>{forecastError}</p></article>
      ) : yieldForecast ? (
        <>
          <article className="pg-card">
            <h2>Predicted Yield</h2>
            <p style={{ fontSize: '2rem', fontWeight: 700, margin: '8px 0' }}>
              {predictedYieldKg.toFixed(1)} kg
            </p>
            <p>Crop: {selectedCrop?.name || 'Unknown'}</p>
          </article>

          <article className="pg-card">
            <h2>Confidence &amp; Loss Context</h2>
            <p>Forecast confidence</p>
            <ConfidenceBar value={confidence} />
            <p style={{ marginTop: 4 }}>{(confidence * 100).toFixed(1)}%</p>
            <p style={{ marginTop: 12 }}>Projected yield loss: <strong>{yieldLossPercent.toFixed(1)}%</strong></p>
            <p style={{ marginTop: 4, fontSize: 13, opacity: 0.8 }}>
              Loss estimate is derived from disease severity and survival probability in the latest scan.
            </p>
          </article>

          <article className="pg-card">
            <h2>Source Transparency</h2>
            <p>This forecast is generated by the swarm orchestrator using:</p>
            <ul>
              <li>Disease: <strong>{latestReport?.disease || 'from latest scan'}</strong></li>
              <li>Severity: <strong>{latestReport?.severity ?? 'from latest scan'}</strong></li>
              <li>Farm size: <strong>{resolvedFarmSize?.toFixed(2) || 'N/A'} ha</strong></li>
              <li>Crop: <strong>{selectedCrop?.name || 'selected crop'}</strong></li>
            </ul>
            <p style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
              Results reflect swarm computation on current inputs. Adjust your scan data or crop profile for refined accuracy.
            </p>
          </article>
        </>
      ) : forecastPayload.payload && !isForecastLoading ? (
        <article className="pg-card"><p>Forecast data unavailable. Check swarm connectivity.</p></article>
      ) : null}

      <article className="pg-card">
        <h2>Next Steps</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="pg-btn pg-btn-primary" onClick={() => navigate('/app/treatment')}>
            Open ROI Deep Dive
          </button>
          <button type="button" className="pg-btn pg-btn-inline" onClick={() => navigate('/app/scan')}>
            New Scan
          </button>
        </div>
      </article>
    </section>
  )
}
