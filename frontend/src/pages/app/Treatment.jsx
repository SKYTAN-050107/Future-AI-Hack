import { useEffect, useMemo, useState } from 'react'
import SectionHeader from '../../components/ui/SectionHeader'
import MetricTile from '../../components/ui/MetricTile'
import SkeletonBlock from '../../components/feedback/SkeletonBlock'
import BackButton from '../../components/navigation/BackButton'
import { getTreatmentPlan } from '../../api/treatment'
import { useSessionContext } from '../../hooks/useSessionContext'
import { useScanHistory } from '../../hooks/useScanHistory'
import { useGrids } from '../../hooks/useGrids'

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

function formatMoney(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00'
}

export default function Treatment() {
  const { user, profile } = useSessionContext()
  const { latestReport } = useScanHistory()
  const { grids } = useGrids()
  const [plan, setPlan] = useState(null)
  const [error, setError] = useState('')

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

  const requestBuild = useMemo(() => {
    const userId = String(user?.uid || '').trim()
    if (!userId) {
      return { payload: null, error: 'Sign in to load treatment recommendations.' }
    }

    if (!latestReport) {
      return { payload: null, error: 'No scan report available. Capture a scan before opening treatment.' }
    }

    const disease = String(latestReport?.disease || '').trim()
    const cropType = String(latestReport?.cropType || latestReport?.crop_type || profile?.onboarding?.variety || '').trim()
    const treatmentPlan = String(latestReport?.treatmentPlan || latestReport?.treatment_plan || '').trim()
    const survivalProb = deriveSurvivalProbability(latestReport)

    if (!disease) {
      return { payload: null, error: 'Latest scan is missing disease information.' }
    }

    if (!cropType) {
      return { payload: null, error: 'Latest scan is missing crop type information.' }
    }

    if (!treatmentPlan) {
      return { payload: null, error: 'Latest scan is missing treatment plan details.' }
    }

    if (!Number.isFinite(totalAreaHectares) || totalAreaHectares <= 0) {
      return { payload: null, error: 'Farm area is not available. Draw at least one grid to estimate ROI.' }
    }

    if (survivalProb === null) {
      return { payload: null, error: 'Latest scan is missing severity needed for survival projection.' }
    }

    return {
      payload: {
        disease,
        zone: latestReport?.gridId || latestReport?.zone || null,
        cropType,
        treatmentPlan,
        userId,
        farmSizeHectares: totalAreaHectares,
        survivalProb,
        lat: firstGridWithCentroid?.centroid?.lat,
        lng: firstGridWithCentroid?.centroid?.lng,
      },
      error: '',
    }
  }, [firstGridWithCentroid?.centroid?.lat, firstGridWithCentroid?.centroid?.lng, latestReport, profile?.onboarding?.variety, totalAreaHectares, user?.uid])

  useEffect(() => {
    let active = true

    if (!requestBuild.payload) {
      setPlan(null)
      setError(requestBuild.error)
      return undefined
    }

    setError('')

    getTreatmentPlan(requestBuild.payload)
      .then((response) => {
        if (active) {
          setPlan(response)
          setError('')
        }
      })
      .catch((loadError) => {
        if (active) {
          setPlan(null)
          setError(loadError?.message || 'Unable to load treatment plan')
        }
      })

    return () => {
      active = false
    }
  }, [requestBuild.error, requestBuild.payload])

  return (
    <section className="pg-page">
      <SectionHeader
        title="Treatment"
        align="center"
        leadingAction={<BackButton fallback="/app" label="Back to home" />}
      />

      <article className="pg-card">
        <h2>Suggested plan</h2>
        <p>{error || (plan ? plan.recommendation : 'Preparing advice from disease level and weather...')}</p>
      </article>

      {!plan && !error ? (
        <article className="pg-card pg-skeleton-card">
          <SkeletonBlock width="34%" height={13} />
          <SkeletonBlock width="100%" height={11} />
          <SkeletonBlock width="88%" height={11} />
        </article>
      ) : null}

      <div className="pg-tile-grid">
        <MetricTile label="Est. cost" value={plan ? `RM ${formatMoney(plan.estimated_cost_rm)}` : '...'} helper="For your area size" />
        <MetricTile label="Est. return" value={plan ? `RM ${formatMoney(plan.expected_gain_rm)}` : '...'} tone="success" helper="If crop recovers" />
        <MetricTile label="Return vs cost" value={plan ? `${Number(plan.roi_x).toFixed(2)}x` : '...'} tone="success" helper="Rough ratio" />
      </div>

      <div className="pg-grid pg-grid-actions">
        <article className="pg-card">
          <h2>Gentler option</h2>
          <p>{plan ? plan.organic_alternative : 'Loading another choice...'}</p>
        </article>
        <article className="pg-card">
          <h2>Stay safe</h2>
          <p>Wear gloves and a mask. Keep spray away from water channels for at least a day.</p>
        </article>
      </div>
    </section>
  )
}
