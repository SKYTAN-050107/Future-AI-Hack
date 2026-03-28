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
        eyebrow="Treatment"
        title="Action Plan and ROI"
        subtitle="Choose intervention based on recovery impact, cost, and timing window."
        action={(
          <button className="pg-btn pg-btn-ghost pg-btn-inline" onClick={() => setChatOpen(true)}>
            Chatbot
          </button>
        )}
      />

      <article className="pg-card">
        <h2>Recommended Plan</h2>
        <p>{plan ? plan.recommendation : 'Generating recommendation from disease severity and weather risk...'}</p>
      </article>

      {!plan ? (
        <article className="pg-card pg-skeleton-card">
          <SkeletonBlock width="34%" height={13} />
          <SkeletonBlock width="100%" height={11} />
          <SkeletonBlock width="88%" height={11} />
        </article>
      ) : null}

      <div className="pg-tile-grid">
        <MetricTile label="Estimated Cost" value={plan ? `RM ${plan.estimated_cost_rm}` : 'Loading'} helper="2.34 ha coverage" />
        <MetricTile label="Expected Gain" value={plan ? `RM ${plan.expected_gain_rm}` : 'Loading'} tone="success" helper="Yield recovery model" />
        <MetricTile label="ROI" value={plan ? `${plan.roi_x}x` : 'Loading'} tone="success" helper="Cost-to-gain ratio" />
      </div>

      <div className="pg-grid pg-grid-actions">
        <article className="pg-card">
          <h2>Organic Alternative</h2>
          <p>{plan ? plan.organic_alternative : 'Fetching alternative option...'}</p>
        </article>
        <article className="pg-card">
          <h2>Safety Reminder</h2>
          <p>Wear gloves, mask, and keep irrigation channels isolated for at least 24 hours.</p>
        </article>
      </div>

      <BottomSheet open={chatOpen} title="Treatment Assistant" onClose={() => setChatOpen(false)}>
        <div className="pg-chatbot-panel">
          <div className="pg-chatbot-message from-ai">
            I can help explain dosage, timing, and safer alternatives based on your farm context.
          </div>
          <div className="pg-chatbot-message from-user">
            Show an option with lower upfront cost.
          </div>
          <div className="pg-chatbot-note">
            Chatbot integration shell ready. You can connect RAG retrieval, database context, and LLM API key later.
          </div>
          <input className="pg-input" placeholder="Ask treatment assistant..." disabled />
          <button className="pg-btn pg-btn-primary" disabled>Send (pending backend)</button>
        </div>
      </BottomSheet>
    </section>
  )
}
