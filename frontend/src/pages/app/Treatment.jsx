import { useEffect, useState } from 'react'
import SectionHeader from '../../components/ui/SectionHeader'
import MetricTile from '../../components/ui/MetricTile'
import SkeletonBlock from '../../components/feedback/SkeletonBlock'
import BackButton from '../../components/navigation/BackButton'
import { getTreatmentPlan } from '../../api/treatment'

export default function Treatment() {
  const [plan, setPlan] = useState(null)

  useEffect(() => {
    let active = true

    getTreatmentPlan({ disease: 'Blast', zone: 'Zone C' }).then((response) => {
      if (active) {
        setPlan(response)
      }
    })

    return () => {
      active = false
    }
  }, [])

  return (
    <section className="pg-page">
      <SectionHeader
        title="Treatment"
        align="center"
        leadingAction={<BackButton fallback="/app" label="Back to home" />}
      />

      <article className="pg-card">
        <h2>Suggested plan</h2>
        <p>{plan ? plan.recommendation : 'Preparing advice from disease level and weather…'}</p>
      </article>

      {!plan ? (
        <article className="pg-card pg-skeleton-card">
          <SkeletonBlock width="34%" height={13} />
          <SkeletonBlock width="100%" height={11} />
          <SkeletonBlock width="88%" height={11} />
        </article>
      ) : null}

      <div className="pg-tile-grid">
        <MetricTile label="Est. cost" value={plan ? `RM ${plan.estimated_cost_rm}` : '…'} helper="For your area size" />
        <MetricTile label="Est. return" value={plan ? `RM ${plan.expected_gain_rm}` : '…'} tone="success" helper="If crop recovers" />
        <MetricTile label="Return vs cost" value={plan ? `${plan.roi_x}x` : '…'} tone="success" helper="Rough ratio" />
      </div>

      <div className="pg-grid pg-grid-actions">
        <article className="pg-card">
          <h2>Gentler option</h2>
          <p>{plan ? plan.organic_alternative : 'Loading another choice…'}</p>
        </article>
        <article className="pg-card">
          <h2>Stay safe</h2>
          <p>Wear gloves and a mask. Keep spray away from water channels for at least a day.</p>
        </article>
      </div>
    </section>
  )
}
