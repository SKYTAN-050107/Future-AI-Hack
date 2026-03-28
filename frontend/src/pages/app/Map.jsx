import SectionHeader from '../../components/ui/SectionHeader'

export default function MapPage() {
  return (
    <section className="pg-page">
      <SectionHeader
        eyebrow="Farm Layout"
        title="Map and Grid"
        subtitle="Draw zones, estimate area in hectares, and prepare sector-based monitoring."
      />

      <article className="pg-map-stage">
        <div className="pg-map-placeholder">
          <p>Satellite map stage</p>
          <small>Mapbox layer placeholder for polygon + heatmap overlay</small>
        </div>

        <aside className="pg-map-controls">
          <h3>Mapping Controls</h3>
          <button className="pg-btn pg-btn-ghost pg-btn-inline">Draw Polygon</button>
          <button className="pg-btn pg-btn-ghost pg-btn-inline">Toggle Grid</button>
          <button className="pg-btn pg-btn-ghost pg-btn-inline">Estimate Density</button>
          <div className="pg-map-metrics">
            <p><strong>Area</strong><span>2.34 ha</span></p>
            <p><strong>Zones</strong><span>20</span></p>
            <p><strong>Offline</strong><span>Cached</span></p>
          </div>
        </aside>
      </article>
    </section>
  )
}
