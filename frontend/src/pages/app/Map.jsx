import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import * as turf from '@turf/turf'
import 'mapbox-gl/dist/mapbox-gl.css'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import SectionHeader from '../../components/ui/SectionHeader'
import { useOffline } from '../../hooks/useOffline'
import { useGrids } from '../../hooks/useGrids'

const DEFAULT_CENTER = [101.6958, 3.139]
const HEALTH_COLORS = {
  Healthy: '#00FF00',
  'At-Risk': '#FFA500',
  Infected: '#FF0000',
}
const MIN_GRID_AREA_HECTARES = 0.01
const MAX_GRID_AREA_HECTARES = 200

function createBufferCollection(grids) {
  return {
    type: 'FeatureCollection',
    features: grids
      .filter((grid) => {
        const geometryType = grid?.bufferZone?.type
        return geometryType === 'Polygon' || geometryType === 'MultiPolygon'
      })
      .map((grid) => ({
        type: 'Feature',
        id: `${grid.id}-buffer`,
        properties: {
          gridId: grid.gridId || grid.id,
          radiusKm: Number(grid.bufferZoneKm || 0),
        },
        geometry: grid.bufferZone,
      })),
  }
}

function createFeatureCollection(grids) {
  return {
    type: 'FeatureCollection',
    features: grids
      .filter((grid) => grid?.polygon?.type === 'Polygon')
      .map((grid) => ({
        type: 'Feature',
        id: grid.id,
        properties: {
          gridId: grid.gridId || grid.id,
          healthState: grid.healthState || 'Healthy',
          areaHectares: grid.areaHectares || 0,
        },
        geometry: grid.polygon,
      })),
  }
}

function createGridId() {
  return `GRID_${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

export default function MapPage() {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const drawRef = useRef(null)
  const mapReadyRef = useRef(false)

  const [mapReady, setMapReady] = useState(false)
  const [actionMessage, setActionMessage] = useState('Draw a polygon to create your first grid section.')
  const [localAreaHectares, setLocalAreaHectares] = useState(0)
  const [pendingFeature, setPendingFeature] = useState(null)
  const [pendingZoneName, setPendingZoneName] = useState('')
  const [zoneNameDrafts, setZoneNameDrafts] = useState({})
  const [isSavingPending, setIsSavingPending] = useState(false)
  const [deletingGridId, setDeletingGridId] = useState('')
  const [renamingGridId, setRenamingGridId] = useState('')
  const [lastSaveState, setLastSaveState] = useState('idle')
  const centroidTargetRef = useRef({ center: DEFAULT_CENTER, hasSaved: false })

  const { isOnline } = useOffline()
  const {
    grids,
    isLoading,
    error,
    isFirebaseConfigured,
    saveOrUpdateGridByFeature,
    deleteGrid,
    updateGridName,
  } = useGrids()

  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN
  const isMapboxConfigured = Boolean(mapboxToken && !mapboxToken.includes('YOUR_'))

  const centroidTarget = useMemo(() => {
    const points = grids
      .filter((grid) => Number.isFinite(grid?.centroid?.lat) && Number.isFinite(grid?.centroid?.lng))
      .map((grid) => ({
        lat: Number(grid.centroid.lat),
        lng: Number(grid.centroid.lng),
        area: Number(grid.areaHectares || 0),
      }))

    if (points.length === 0) {
      return {
        center: DEFAULT_CENTER,
        hasSaved: false,
      }
    }

    const totalArea = points.reduce((sum, point) => sum + (point.area > 0 ? point.area : 0), 0)
    const useWeighted = totalArea > 0

    const weighted = points.reduce(
      (acc, point) => {
        const weight = useWeighted ? point.area : 1
        return {
          lat: acc.lat + point.lat * weight,
          lng: acc.lng + point.lng * weight,
          weight: acc.weight + weight,
        }
      },
      { lat: 0, lng: 0, weight: 0 },
    )

    const centerLat = weighted.weight > 0 ? weighted.lat / weighted.weight : DEFAULT_CENTER[1]
    const centerLng = weighted.weight > 0 ? weighted.lng / weighted.weight : DEFAULT_CENTER[0]

    return {
      center: [centerLng, centerLat],
      hasSaved: true,
    }
  }, [grids])

  useEffect(() => {
    centroidTargetRef.current = centroidTarget
  }, [centroidTarget])

  useEffect(() => {
    const nextName = String(pendingFeature?.properties?.gridId || '').trim()
    setPendingZoneName(nextName)
  }, [pendingFeature])

  useEffect(() => {
    setZoneNameDrafts((prev) => {
      const next = {}

      grids.forEach((grid) => {
        const key = String(grid.id)
        next[key] = Object.prototype.hasOwnProperty.call(prev, key)
          ? String(prev[key] || '')
          : String(grid.gridId || '')
      })

      return next
    })
  }, [grids])

  useEffect(() => {
    if (!isMapboxConfigured || !mapContainerRef.current || mapRef.current) {
      return undefined
    }

    mapboxgl.accessToken = mapboxToken
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: DEFAULT_CENTER,
      zoom: 15,
      attributionControl: false,
    })

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')

    const centroidControl = {
      map: null,
      container: null,
      button: null,
      handleClick: null,
      onAdd(controlMap) {
        this.map = controlMap
        const container = document.createElement('div')
        container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group pg-map-centroid-ctrl'

        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'pg-map-centroid-btn'
        button.setAttribute('aria-label', 'Go to farm centroid')
        button.title = 'Go to farm centroid'
        button.innerHTML = '<span class="pg-map-centroid-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="5"></circle><circle cx="12" cy="12" r="1.5"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path></svg></span>'

        this.handleClick = () => {
          const { center, hasSaved } = centroidTargetRef.current
          this.map.easeTo({
            center,
            zoom: hasSaved ? Math.max(this.map.getZoom(), 15) : 13,
            duration: 700,
          })
          setActionMessage(
            hasSaved
              ? 'Centered map to your saved farm centroid.'
              : 'No saved grid yet. Returned to default map center.',
          )
        }

        button.addEventListener('click', this.handleClick)
        container.appendChild(button)

        this.container = container
        this.button = button

        return container
      },
      onRemove() {
        if (this.button && this.handleClick) {
          this.button.removeEventListener('click', this.handleClick)
        }

        if (this.container && this.container.parentNode) {
          this.container.parentNode.removeChild(this.container)
        }

        this.map = null
        this.container = null
        this.button = null
        this.handleClick = null
      },
    }
    map.addControl(centroidControl, 'top-right')

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        polygon: true,
        trash: true,
      },
      defaultMode: 'draw_polygon',
    })

    map.addControl(draw, 'top-left')

    const fitToUserLocation = () => {
      if (!navigator.geolocation) {
        return
      }

      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          map.easeTo({
            center: [coords.longitude, coords.latitude],
            zoom: 16,
            duration: 800,
          })
        },
        () => {},
        { enableHighAccuracy: true, timeout: 6000 },
      )
    }

    const validateFeature = (feature, areaHectares) => {
      if (!feature || feature.geometry?.type !== 'Polygon') {
        return 'Only polygon grids are supported.'
      }

      if (!feature.id) {
        return 'Unable to save this shape. Please redraw the polygon.'
      }

      if (areaHectares < MIN_GRID_AREA_HECTARES) {
        return 'Polygon is too small. Draw at least 0.01 hectares.'
      }

      if (areaHectares > MAX_GRID_AREA_HECTARES) {
        return 'Polygon is too large. Split this section into smaller grids.'
      }

      const kinkCollection = turf.kinks(feature)
      if ((kinkCollection.features || []).length > 0) {
        return 'Polygon crosses itself. Redraw for a clean boundary.'
      }

      return null
    }

    const saveFeature = async (feature, mode = 'auto') => {
      if (!feature || feature.geometry?.type !== 'Polygon') {
        return
      }

      const areaHectares = turf.area(feature) / 10000
      const centroid = turf.centroid(feature)

      const validationError = validateFeature(feature, areaHectares)
      if (validationError) {
        setActionMessage(validationError)
        setLastSaveState('failed')
        return
      }

      setLocalAreaHectares(areaHectares)

      if (!isFirebaseConfigured) {
        setActionMessage('Grid save requires Firebase configuration and authenticated access.')
        setLastSaveState('failed')
        return
      }

      setLastSaveState('pending')
      await saveOrUpdateGridByFeature({
        mapFeatureId: String(feature.id),
        gridId: feature.properties?.gridId || createGridId(),
        polygon: feature.geometry,
        areaHectares,
        centroid: {
          lat: centroid.geometry.coordinates[1],
          lng: centroid.geometry.coordinates[0],
        },
      })

      setActionMessage(mode === 'manual' ? 'Grid confirmed and synced.' : 'Grid auto-saved and synced. Confirm if you want to re-sync.')
      setLastSaveState('saved')
      setPendingFeature(mode === 'manual' ? null : feature)
    }

    const onDrawCreate = async (event) => {
      for (const feature of event.features || []) {
        setPendingFeature(feature)
        setPendingZoneName(String(feature?.properties?.gridId || '').trim())
        try {
          await saveFeature(feature)
        } catch (saveError) {
          setActionMessage(saveError.message || 'Failed to save grid')
          setLastSaveState('failed')
        }
      }
    }

    const onDrawUpdate = async (event) => {
      for (const feature of event.features || []) {
        setPendingFeature(feature)
        setPendingZoneName(String(feature?.properties?.gridId || '').trim())
        try {
          await saveFeature(feature)
        } catch (saveError) {
          setActionMessage(saveError.message || 'Failed to update grid')
          setLastSaveState('failed')
        }
      }
    }

    const onDrawDelete = async (event) => {
      if (!isFirebaseConfigured) {
        setActionMessage('Grid delete requires Firebase configuration and authenticated access.')
        setLastSaveState('idle')
        return
      }

      for (const feature of event.features || []) {
        if (!feature?.id) {
          continue
        }

        try {
          await deleteGrid(String(feature.id))
          setActionMessage('Grid removed.')
          setLastSaveState('saved')
          setPendingFeature(null)
        } catch (deleteError) {
          setActionMessage(deleteError.message || 'Failed to delete grid')
          setLastSaveState('failed')
        }
      }
    }

    map.on('load', () => {
      if (!map.getSource('pg-grids')) {
        map.addSource('pg-grids', {
          type: 'geojson',
          data: createFeatureCollection([]),
        })
      }

      if (!map.getSource('pg-grid-buffers')) {
        map.addSource('pg-grid-buffers', {
          type: 'geojson',
          data: createBufferCollection([]),
        })
      }

      map.addLayer({
        id: 'pg-grid-fill',
        type: 'fill',
        source: 'pg-grids',
        paint: {
          'fill-color': [
            'match',
            ['get', 'healthState'],
            'Healthy',
            HEALTH_COLORS.Healthy,
            'At-Risk',
            HEALTH_COLORS['At-Risk'],
            'Infected',
            HEALTH_COLORS.Infected,
            '#CCCCCC',
          ],
          'fill-opacity': 0.34,
        },
      })

      map.addLayer({
        id: 'pg-grid-outline',
        type: 'line',
        source: 'pg-grids',
        paint: {
          'line-color': '#18424B',
          'line-width': 2,
        },
      })

      map.addLayer({
        id: 'pg-grid-buffer-fill',
        type: 'fill',
        source: 'pg-grid-buffers',
        paint: {
          'fill-color': '#FFA500',
          'fill-opacity': 0.12,
        },
      })

      map.addLayer({
        id: 'pg-grid-buffer-outline',
        type: 'line',
        source: 'pg-grid-buffers',
        paint: {
          'line-color': '#C97A00',
          'line-width': 2,
          'line-dasharray': [2, 2],
        },
      })

      fitToUserLocation()
      mapReadyRef.current = true
      setMapReady(true)
      setActionMessage('Map ready. Draw polygon areas to build your farm grid.')
    })

    map.on('draw.create', onDrawCreate)
    map.on('draw.update', onDrawUpdate)
    map.on('draw.delete', onDrawDelete)

    mapRef.current = map
    drawRef.current = draw

    return () => {
      map.off('draw.create', onDrawCreate)
      map.off('draw.update', onDrawUpdate)
      map.off('draw.delete', onDrawDelete)
      map.remove()
      mapRef.current = null
      drawRef.current = null
      mapReadyRef.current = false
      setMapReady(false)
    }
  }, [deleteGrid, isFirebaseConfigured, isMapboxConfigured, mapboxToken, saveOrUpdateGridByFeature])

  useEffect(() => {
    if (!mapReady || !mapReadyRef.current || !mapRef.current) {
      return
    }

    const source = mapRef.current.getSource('pg-grids')
    if (source) {
      source.setData(createFeatureCollection(grids))
    }

    const bufferSource = mapRef.current.getSource('pg-grid-buffers')
    if (bufferSource) {
      bufferSource.setData(createBufferCollection(grids))
    }
  }, [grids, mapReady])

  const onConfirmSave = async () => {
    if (!pendingFeature) {
      setActionMessage('Draw or edit a grid first, then confirm save.')
      return
    }

    const resolvedZoneName = String(pendingZoneName || pendingFeature?.properties?.gridId || '').trim() || createGridId()

    setIsSavingPending(true)
    try {
      await saveOrUpdateGridByFeature({
        mapFeatureId: String(pendingFeature.id),
        gridId: resolvedZoneName,
        polygon: pendingFeature.geometry,
        areaHectares: turf.area(pendingFeature) / 10000,
        centroid: {
          lat: turf.centroid(pendingFeature).geometry.coordinates[1],
          lng: turf.centroid(pendingFeature).geometry.coordinates[0],
        },
      })
      setActionMessage(`Zone ${resolvedZoneName} confirmed and synced.`)
      setLastSaveState('saved')
      setPendingFeature(null)
      setPendingZoneName('')
    } catch (errorMessage) {
      setActionMessage(errorMessage.message || 'Failed to confirm save')
      setLastSaveState('failed')
    } finally {
      setIsSavingPending(false)
    }
  }

  const handleDeletePersistedGrid = async (grid) => {
    if (!grid?.id) {
      return
    }

    if (!isFirebaseConfigured) {
      setActionMessage('Grid delete requires Firebase configuration and authenticated access.')
      setLastSaveState('failed')
      return
    }

    const gridLabel = grid.gridId || grid.id
    const shouldDelete = window.confirm(`Delete saved polygon ${gridLabel}?`)
    if (!shouldDelete) {
      return
    }

    try {
      setDeletingGridId(String(grid.id))
      await deleteGrid(String(grid.id))
      if (String(pendingFeature?.id || '') === String(grid.mapFeatureId || grid.id)) {
        setPendingFeature(null)
      }
      setActionMessage(`Removed ${gridLabel}.`)
      setLastSaveState('saved')
    } catch (deleteError) {
      setActionMessage(deleteError?.message || `Failed to delete ${gridLabel}.`)
      setLastSaveState('failed')
    } finally {
      setDeletingGridId('')
    }
  }

  const handleRenamePersistedGrid = async (grid) => {
    const gridDocId = String(grid?.id || '').trim()
    if (!gridDocId) {
      return
    }

    const nextName = String(zoneNameDrafts[gridDocId] || '').trim()
    if (!nextName) {
      setActionMessage('Zone name cannot be empty.')
      setLastSaveState('failed')
      return
    }

    const currentName = String(grid?.gridId || '').trim()
    if (nextName === currentName) {
      setActionMessage('Zone name is unchanged.')
      return
    }

    try {
      setRenamingGridId(gridDocId)
      await updateGridName(gridDocId, nextName)
      setActionMessage(`Zone renamed to ${nextName}.`)
      setLastSaveState('saved')
    } catch (renameError) {
      setActionMessage(renameError?.message || 'Failed to rename zone.')
      setLastSaveState('failed')
    } finally {
      setRenamingGridId('')
    }
  }

  const totalHectares = useMemo(
    () => grids.reduce((sum, item) => sum + Number(item.areaHectares || 0), 0),
    [grids],
  )

  const syncStatusLabel = !isFirebaseConfigured
    ? 'Disabled'
    : isLoading
      ? 'Syncing...'
      : error
        ? (String(error).toLowerCase().includes('sign in') ? 'Auth required' : 'Error')
        : 'Ready'

  const healthyCount = grids.filter((item) => item.healthState === 'Healthy').length
  const riskCount = grids.filter((item) => item.healthState === 'At-Risk').length
  const infectedCount = grids.filter((item) => item.healthState === 'Infected').length
  const bufferedCount = grids.filter((item) => item?.bufferZone).length
  const riskRecommendations = grids
    .filter((item) => item.healthState === 'At-Risk' || item.healthState === 'Infected')
    .slice(0, 4)

  return (
    <section className="pg-page pg-page-map">
      <SectionHeader title="Map" align="center" />

      <article className="pg-map-stage">
        <div className="pg-map-canvas-wrap">
          {!isMapboxConfigured ? (
            <div className="pg-map-placeholder">
              <p>Mapbox key is missing</p>
              <small>Add VITE_MAPBOX_TOKEN in frontend/.env to load the live map.</small>
            </div>
          ) : (
            <>
              <div ref={mapContainerRef} className="pg-map-canvas" />
              {!mapReady ? <div className="pg-map-loading">Loading map...</div> : null}
            </>
          )}
        </div>

        <aside className="pg-map-controls">
          <h3>Grid controls</h3>
          <p className="pg-map-status">{actionMessage}</p>
          <p className="pg-map-status">
            Save status:{' '}
            <strong>
              {lastSaveState === 'pending'
                ? 'Pending sync'
                : lastSaveState === 'saved'
                  ? 'Saved'
                  : lastSaveState === 'failed'
                    ? 'Needs attention'
                    : 'Idle'}
            </strong>
          </p>
          <div className="pg-cta-row">
            <label className="pg-field-label" htmlFor="pg-map-zone-name">Zone name</label>
            <input
              id="pg-map-zone-name"
              className="pg-input"
              type="text"
              value={pendingZoneName}
              placeholder="Enter zone name"
              maxLength={56}
              onChange={(event) => setPendingZoneName(event.target.value)}
            />
            <button
              type="button"
              className="pg-btn pg-btn-primary"
              onClick={onConfirmSave}
              disabled={!pendingFeature || isSavingPending || !isFirebaseConfigured}
            >
              {isSavingPending ? 'Saving…' : 'Confirm grid save'}
            </button>
          </div>
          <div className="pg-map-legend">
            <span><i className="dot healthy" />Healthy</span>
            <span><i className="dot risk" />At-Risk</span>
            <span><i className="dot infected" />Infected</span>
            <span><i className="dot risk" />Buffer zone</span>
          </div>
          <div className="pg-map-metrics">
            <p><strong>Total area</strong><span>{totalHectares.toFixed(2)} ha</span></p>
            <p><strong>Last draw</strong><span>{localAreaHectares.toFixed(2)} ha</span></p>
            <p><strong>Grid zones</strong><span>{grids.length}</span></p>
            <p><strong>Healthy</strong><span>{healthyCount}</span></p>
            <p><strong>At-Risk</strong><span>{riskCount}</span></p>
            <p><strong>Infected</strong><span>{infectedCount}</span></p>
            <p><strong>Buffer zones</strong><span>{bufferedCount}</span></p>
            <p><strong>Connection</strong><span>{isOnline ? 'Online' : 'Offline'}</span></p>
            <p><strong>Sync</strong><span>{syncStatusLabel}</span></p>
          </div>

          {error ? (
            <p className="pg-map-status" style={{ marginTop: 8 }}>
              <strong>Sync detail:</strong> {error}
            </p>
          ) : null}

          {grids.length > 0 ? (
            <article className="pg-card" style={{ marginTop: 12 }}>
              <h3>Saved polygons</h3>
              {grids.slice(0, 10).map((grid) => (
                <div
                  key={grid.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <small style={{ display: 'block', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {grid.gridId || grid.id} ({Number(grid.areaHectares || 0).toFixed(2)} ha)
                    </small>
                    <input
                      className="pg-input"
                      type="text"
                      value={zoneNameDrafts[String(grid.id)] || ''}
                      maxLength={56}
                      onChange={(event) => {
                        const value = event.target.value
                        const key = String(grid.id)
                        setZoneNameDrafts((prev) => ({
                          ...prev,
                          [key]: value,
                        }))
                      }}
                    />
                  </div>

                  <div style={{ display: 'grid', gap: 6 }}>
                    <button
                      type="button"
                      className="pg-btn"
                      onClick={() => handleRenamePersistedGrid(grid)}
                      disabled={renamingGridId === grid.id || deletingGridId === grid.id}
                    >
                      {renamingGridId === grid.id ? 'Saving…' : 'Save name'}
                    </button>
                    <button
                      type="button"
                      className="pg-btn"
                      onClick={() => handleDeletePersistedGrid(grid)}
                      disabled={deletingGridId === grid.id || renamingGridId === grid.id}
                    >
                      {deletingGridId === grid.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
              ))}
            </article>
          ) : null}

          {riskRecommendations.length > 0 ? (
            <article className="pg-card" style={{ marginTop: 12 }}>
              <h3>Risk recommendations</h3>
              {riskRecommendations.map((grid) => (
                <p key={grid.id} className="pg-map-status" style={{ marginBottom: 8 }}>
                  <strong>{grid.gridId || grid.id}</strong>: {grid.bufferZoneAdvice || grid.riskReason || 'Monitor nearby spread and prepare preventive spray.'}
                  {Number(grid.riskDistanceKm || 0) > 0 ? ` (${Number(grid.riskDistanceKm).toFixed(3)} km)` : ''}
                </p>
              ))}
            </article>
          ) : null}
        </aside>
      </article>
    </section>
  )
}
