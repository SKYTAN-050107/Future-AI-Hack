import { useEffect, useState } from 'react'
import SectionHeader from '../../components/ui/SectionHeader'
import MetricTile from '../../components/ui/MetricTile'
import SkeletonBlock from '../../components/feedback/SkeletonBlock'
import BottomSheet from '../../components/ui/BottomSheet'
import { getTreatmentPlan } from '../../api/treatment'

export default function Treatment() {
  const [plan, setPlan] = useState(null)
  const [chatOpen, setChatOpen] = useState(false)

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
        eyebrow="Spray plan"
        title="Cost and next steps"
        subtitle="Suggested spray, cost, and return — check timing with the weather."
        action={(
          <button type="button" className="pg-btn pg-btn-ghost pg-btn-inline" onClick={() => setChatOpen(true)}>
            Help
          </button>
        )}
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

      <BottomSheet open={chatOpen} title="Spray help" onClose={() => setChatOpen(false)}>
        <div className="pg-chatbot-panel">
          <div className="pg-chatbot-message from-ai">
            Ask about amount, timing, or cheaper options for your farm.
          </div>
          <div className="pg-chatbot-message from-user">
            Show a lower-cost option.
          </div>
          <div className="pg-chatbot-note">
            Full chat will work when connected to your service.
          </div>
          <input className="pg-input" placeholder="Type a question…" disabled />
          <button type="button" className="pg-btn pg-btn-primary" disabled>Send</button>
        </div>
      </BottomSheet>
    </section>
  )
}
