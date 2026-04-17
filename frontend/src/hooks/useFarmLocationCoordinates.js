import { useEffect, useState } from 'react'
import { geocodeLocation } from '../services/locationResolver'

export function useFarmLocationCoordinates({ locationText, gridLat, gridLng }) {
  const safeGridLat = Number(gridLat)
  const safeGridLng = Number(gridLng)
  const hasGridCoordinates = Number.isFinite(safeGridLat) && Number.isFinite(safeGridLng)

  const [resolvedLocation, setResolvedLocation] = useState(null)
  const [isResolvingLocation, setIsResolvingLocation] = useState(false)
  const [locationResolutionError, setLocationResolutionError] = useState('')

  useEffect(() => {
    let active = true

    if (hasGridCoordinates) {
      setResolvedLocation(null)
      setIsResolvingLocation(false)
      setLocationResolutionError('')
      return undefined
    }

    const safeLocation = String(locationText || '').trim()
    if (!safeLocation) {
      setResolvedLocation(null)
      setIsResolvingLocation(false)
      setLocationResolutionError('')
      return undefined
    }

    setIsResolvingLocation(true)
    setLocationResolutionError('')

    geocodeLocation(safeLocation)
      .then((result) => {
        if (!active) {
          return
        }

        setResolvedLocation(result)
        if (!result) {
          setLocationResolutionError('Unable to resolve your saved location. Please update it in Settings.')
        }
      })
      .catch((error) => {
        if (!active) {
          return
        }

        setResolvedLocation(null)
        setLocationResolutionError(error?.message || 'Unable to resolve your saved location. Please update it in Settings.')
      })
      .finally(() => {
        if (active) {
          setIsResolvingLocation(false)
        }
      })

    return () => {
      active = false
    }
  }, [hasGridCoordinates, locationText])

  const coordinates = hasGridCoordinates
    ? { lat: safeGridLat, lng: safeGridLng, source: 'grid' }
    : resolvedLocation
      ? { lat: resolvedLocation.lat, lng: resolvedLocation.lng, source: 'bound-location', label: resolvedLocation.label }
      : null

  return {
    coordinates,
    isResolvingLocation,
    locationResolutionError,
    resolvedLocation,
  }
}
