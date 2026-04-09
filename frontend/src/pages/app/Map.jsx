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
  const [isSavingPending, setIsSavingPending] = useState(false)
  const [lastSaveState, setLastSaveState] = useState('idle')

  const { isOnline } = useOffline()
  const {
    grids,
    isLoading,
    error,
    isFirebaseConfigured,
    saveOrUpdateGridByFeature,
    deleteGrid,
  } = useGrids()

  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN
  const isMapboxConfigured = Boolean(mapboxToken && !mapboxToken.includes('YOUR_'))

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
        setActionMessage('Polygon measured locally. Configure Firebase to sync this grid.')
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
        setActionMessage('Local polygon removed.')
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
    if (!mapReadyRef.current || !mapRef.current) {
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
  }, [grids])

  const onConfirmSave = async () => {
    if (!pendingFeature) {
      setActionMessage('Draw or edit a grid first, then confirm save.')
      return
    }

    setIsSavingPending(true)
    try {
      await saveOrUpdateGridByFeature({
        mapFeatureId: String(pendingFeature.id),
        gridId: pendingFeature.properties?.gridId || createGridId(),
        polygon: pendingFeature.geometry,
        areaHectares: turf.area(pendingFeature) / 10000,
        centroid: {
          lat: turf.centroid(pendingFeature).geometry.coordinates[1],
          lng: turf.centroid(pendingFeature).geometry.coordinates[0],
        },
      })
      setActionMessage('Grid confirmed and synced.')
      setLastSaveState('saved')
      setPendingFeature(null)
    } catch (errorMessage) {
      setActionMessage(errorMessage.message || 'Failed to confirm save')
      setLastSaveState('failed')
    } finally {
      setIsSavingPending(false)
    }
  }

  const totalHectares = useMemo(
    () => grids.reduce((sum, item) => sum + Number(item.areaHectares || 0), 0),
    [grids],
  )

  const healthyCount = grids.filter((item) => item.healthState === 'Healthy').length
  const riskCount = grids.filter((item) => item.healthState === 'At-Risk').length
  const infectedCount = grids.filter((item) => item.healthState === 'Infected').length

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
            <p><strong>Connection</strong><span>{isOnline ? 'Online' : 'Offline'}</span></p>
            <p><strong>Sync</strong><span>{isFirebaseConfigured ? (isLoading ? 'Syncing...' : error ? 'Error' : 'Ready') : 'Disabled'}</span></p>
          </div>
        </aside>
      </article>
    </section>
  )
}
