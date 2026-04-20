import { useEffect, useMemo, useState } from 'react'
import SectionHeader from '../../components/ui/SectionHeader'
import MetricTile from '../../components/ui/MetricTile'
import BackButton from '../../components/navigation/BackButton'
import { runSwarmOrchestrator } from '../../api/swarm'
import { useSessionContext } from '../../hooks/useSessionContext'
import { useGrids } from '../../hooks/useGrids'
import { useScanHistory } from '../../hooks/useScanHistory'

function severityTone(value) {
  if (value >= 60) {
    return 'danger'
  }

  if (value >= 30) {
    return 'warning'
  }

  return 'default'
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

export default function Report() {
  const { user } = useSessionContext()
  const { grids } = useGrids()
  const { latestReport } = useScanHistory()
  const [swarmInsight, setSwarmInsight] = useState(null)
  const [swarmError, setSwarmError] = useState('')

  const severity = Number(latestReport?.severity || 0)
  const confidence = Number(latestReport?.confidence || 0)
  const disease = latestReport?.disease || 'No recent scan'
  const spreadRisk = latestReport?.spreadRisk || latestReport?.spread_risk || 'Unknown'
  const zone = latestReport?.gridId || latestReport?.zone || 'Unlinked zone'

  const firstGridWithCentroid = useMemo(
    () => grids.find((grid) => Number.isFinite(grid?.centroid?.lat) && Number.isFinite(grid?.centroid?.lng)),
    [grids],
  )

  const totalAreaHectares = useMemo(
    () => grids.reduce((sum, grid) => {
      const area = Number(grid?.areaHectares)
      return Number.isFinite(area) ? sum + area : sum
    }, 0),
    [grids],
  )

  const swarmRequest = useMemo(() => {
    const userId = String(user?.uid || '').trim()
    const gridId = String(latestReport?.gridId || latestReport?.zone || firstGridWithCentroid?.id || '').trim()
    const cropType = String(latestReport?.cropType || latestReport?.crop_type || '').trim()
    const treatmentPlan = String(latestReport?.treatmentPlan || latestReport?.treatment_plan || '').trim()
    const survivalProb = deriveSurvivalProbability(latestReport)
    const lat = Number(firstGridWithCentroid?.centroid?.lat)
    const lng = Number(firstGridWithCentroid?.centroid?.lng)

    if (!userId || !gridId || !cropType || !treatmentPlan || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { payload: null, error: 'Swarm analysis is waiting for user, grid, crop, treatment, and map centroid data.' }
    }

    if (!latestReport?.disease) {
      return { payload: null, error: 'Swarm analysis needs a diagnosis result first.' }
    }

    if (!Number.isFinite(totalAreaHectares) || totalAreaHectares <= 0) {
      return { payload: null, error: 'Swarm analysis needs farm area from mapped grids.' }
    }

    if (survivalProb === null) {
      return { payload: null, error: 'Swarm analysis needs survival probability from latest scan.' }
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
        disease: String(latestReport?.disease || 'Unknown'),
        severity: severityLabel(severityPercent),
        severity_score: severityScore,
        survival_prob: survivalProb,
        farm_size: totalAreaHectares,
        treatment_plan: treatmentPlan,
        wind_speed_kmh: 0,
        wind_direction: 'N',
      },
      error: '',
    }
  }, [firstGridWithCentroid?.centroid?.lat, firstGridWithCentroid?.centroid?.lng, firstGridWithCentroid?.id, latestReport, totalAreaHectares, user?.uid])

  useEffect(() => {
    let active = true

    if (!swarmRequest.payload) {
      setSwarmInsight(null)
      setSwarmError(swarmRequest.error)
      return undefined
    }

    setSwarmError('')

    runSwarmOrchestrator(swarmRequest.payload)
      .then((response) => {
        if (!active) {
          return
        }
        setSwarmInsight(response)
      })
      .catch((error) => {
        if (!active) {
          return
        }
        setSwarmInsight(null)
        setSwarmError(error?.message || 'Unable to connect to swarm analysis service.')
      })

    return () => {
      active = false
    }
  }, [swarmRequest.error, swarmRequest.payload])

  const spatialRisk = swarmInsight?.spatial_risk
  const yieldForecast = swarmInsight?.yield_forecast
  const chatbotReply = swarmInsight?.chatbot_reply

  return (
    <section className="pg-page">
      <SectionHeader
        title="Report"
        align="center"
        leadingAction={<BackButton fallback="/app/scan" label="Back to scanner" />}
      />

      <article className="pg-severity-card">
        <h2>{disease}</h2>
        <p>{severityLabel(severity)} level in {zone}. Acting within 24 hours usually helps.</p>
        <div className="pg-severity-meter" role="img" aria-label={`Problem level ${severity} percent`}>
          <span style={{ width: `${severity}%` }} />
        </div>
      </article>

      <div className="pg-tile-grid">
        <MetricTile
          label="Problem level"
          value={`${severity}%`}
          tone={severityTone(severity)}
          helper={severityLabel(severity)}
        />
        <MetricTile label="Spread risk" value={spreadRisk} tone="danger" helper="Wind & damp air" />
        <MetricTile label="How sure" value={`${confidence}%`} helper="Read quality" />
      </div>

      <article className="pg-card">
        <h2>What to do next</h2>
        <p>Open the spray plan to compare cost and amount before you buy and apply.</p>
      </article>

      <article className="pg-card">
        <h2>Swarm Analysis</h2>
        {swarmInsight ? (
          <>
            {chatbotReply ? <p>{chatbotReply}</p> : null}
            <p>{swarmInsight.weather}</p>
            <p>{swarmInsight.economy}</p>
            <p>{swarmInsight.resources}</p>
            {yieldForecast ? (
              <p>
                Yield forecast: {Number(yieldForecast.predicted_yield_kg || 0).toFixed(0)} kg expected,
                {" "}
                {Number(yieldForecast.yield_loss_percent || 0).toFixed(1)}% loss,
                {" "}
                confidence {Number(yieldForecast.confidence || 0).toFixed(2)}.
              </p>
            ) : null}
            {spatialRisk ? (
              <p>
                Spatial risk radius: {Number(spatialRisk.predicted_spread_radius_km || 0).toFixed(2)} km,
                {" "}
                spread rate {Number(spatialRisk.spread_rate_meters_per_day || 0).toFixed(1)} m/day,
                {" "}
                risk level {spatialRisk.risk_level || 'unknown'}.
              </p>
            ) : null}
          </>
        ) : (
          <p>{swarmError || 'Connecting to swarm service...'}</p>
        )}
      </article>
    </section>
  )
}
