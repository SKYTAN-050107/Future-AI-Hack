import SectionHeader from '../../components/ui/SectionHeader'
import TimelineList from '../../components/ui/TimelineList'

const historyItems = [
  {
    id: 'scan-01',
    date: 'Today, 08:42',
    title: 'Leaf check: blast risk in Zone C',
    detail: 'Problem about 64%. Plan saved. Recheck in a few days.',
  },
  {
    id: 'spray-01',
    date: 'Yesterday, 16:15',
    title: 'Spray done in Zone B',
    detail: '0.6 kg/ha. Weather OK. Next check in 48 hours.',
  },
  {
    id: 'scan-00',
    date: '2 days ago, 09:10',
    title: 'First leaf photos',
    detail: 'No big issues; two areas looked a bit dry.',
  },
]

export default function History() {
  return (
    <section className="pg-page">
      <SectionHeader
        title="History"
        align="center"
      />

      <article className="pg-card">
        <h2>Trend</h2>
        <p>Problem level went from 71% down to 64% over the last two checks.</p>
      </article>

      <TimelineList items={historyItems} />
    </section>
  )
}
