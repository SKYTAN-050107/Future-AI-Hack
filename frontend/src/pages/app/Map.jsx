import SectionHeader from '../../components/ui/SectionHeader'

export default function MapPage() {
  return (
    <section className="pg-page">
      <SectionHeader
        title="Map"
        align="center"
      />

      <article className="pg-map-stage">
        <div className="pg-map-placeholder">
          <p>Map preview</p>
          <small>Draw your plots here when the map is connected.</small>
        </div>

        <aside className="pg-map-controls">
          <h3>Tools</h3>
          <button type="button" className="pg-btn pg-btn-ghost pg-btn-inline">Draw area</button>
          <button type="button" className="pg-btn pg-btn-ghost pg-btn-inline">Show grid</button>
          <button type="button" className="pg-btn pg-btn-ghost pg-btn-inline">Estimate density</button>
          <div className="pg-map-metrics">
            <p><strong>Area</strong><span>2.34 ha</span></p>
            <p><strong>Zones</strong><span>20</span></p>
            <p><strong>Offline map</strong><span>Saved</span></p>
          </div>
        </aside>
      </article>
    </section>
  )
}
