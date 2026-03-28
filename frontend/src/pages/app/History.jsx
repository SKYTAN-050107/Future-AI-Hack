import SectionHeader from '../../components/ui/SectionHeader'
import TimelineList from '../../components/ui/TimelineList'

const historyItems = [
  {
    id: 'scan-01',
    date: 'Today, 08:42',
    title: 'Scan complete: Blast risk in Zone C',
    detail: 'Severity 64%, confidence 92%, treatment recommendation generated.',
  },
  {
    id: 'spray-01',
    date: 'Yesterday, 16:15',
    title: 'Treatment applied in Zone B',
    detail: 'Dosage 0.6 kg/ha, weather window confirmed, follow-up scan in 48h.',
  },
  {
    id: 'scan-00',
    date: '2 days ago, 09:10',
    title: 'Scanner baseline capture',
    detail: 'No severe anomaly, mild stress in 2 sectors due to water fluctuation.',
  },
]

export default function History() {
  return (
    <section className="pg-page">
      <SectionHeader
        eyebrow="Logs"
        title="Scan and Treatment History"
        subtitle="Track disease progression and measure treatment outcomes over time."
      />

      <article className="pg-card">
        <h2>Latest Summary</h2>
        <p>Overall severity trend improved from 71% to 64% over last two scans.</p>
      </article>

      <TimelineList items={historyItems} />
    </section>
  )
}
