import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase'

const GRID_COLLECTION = 'grids'

const healthStateWeight = {
  Infected: 3,
  'At-Risk': 2,
  Healthy: 1,
}

function sortByHealthAndTime(grids) {
  return [...grids].sort((a, b) => {
    const stateDiff = (healthStateWeight[b.healthState] || 0) - (healthStateWeight[a.healthState] || 0)

    if (stateDiff !== 0) {
      return stateDiff
    }

    const left = a.lastUpdated?.toMillis?.() ?? 0
    const right = b.lastUpdated?.toMillis?.() ?? 0
    return right - left
  })
}

export function useGrids() {
  const [grids, setGrids] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      setIsLoading(false)
      setError('Firebase is not configured yet. Fill frontend/.env first.')
      return undefined
    }

    const gridsRef = collection(db, GRID_COLLECTION)
    const unsubscribe = onSnapshot(
      gridsRef,
      (snapshot) => {
        const nextGrids = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))

        setGrids(sortByHealthAndTime(nextGrids))
        setIsLoading(false)
        setError(null)
      },
      (snapshotError) => {
        setError(snapshotError.message || 'Failed to stream farm grids')
        setIsLoading(false)
      },
    )

    return () => unsubscribe()
  }, [])

  const saveGrid = useCallback(async ({ gridId, polygon, areaHectares, centroid, plantDensity }) => {
    if (!db) {
      throw new Error('Firebase is not configured')
    }

    const payload = {
      gridId,
      polygon,
      areaHectares,
      centroid,
      plantDensity: plantDensity ?? null,
      healthState: 'Healthy',
      lastUpdated: serverTimestamp(),
      createdAt: serverTimestamp(),
    }

    return addDoc(collection(db, GRID_COLLECTION), payload)
  }, [])

  const saveOrUpdateGridByFeature = useCallback(
    async ({ mapFeatureId, gridId, polygon, areaHectares, centroid, plantDensity, healthState = 'Healthy' }) => {
      if (!db) {
        throw new Error('Firebase is not configured')
      }

      if (!mapFeatureId) {
        throw new Error('mapFeatureId is required')
      }

      const target = doc(db, GRID_COLLECTION, mapFeatureId)
      const existing = await getDoc(target)
      const existingData = existing.exists() ? existing.data() : null

      await setDoc(
        target,
        {
          mapFeatureId,
          gridId,
          polygon,
          areaHectares,
          centroid,
          plantDensity: plantDensity ?? null,
          healthState: existingData?.healthState || healthState,
          lastUpdated: serverTimestamp(),
          createdAt: existingData?.createdAt || serverTimestamp(),
        },
        { merge: true },
      )
    },
    [],
  )

  const deleteGrid = useCallback(async (gridDocId) => {
    if (!db) {
      throw new Error('Firebase is not configured')
    }

    await deleteDoc(doc(db, GRID_COLLECTION, gridDocId))
  }, [])

  const updateGridHealthState = useCallback(async (gridDocId, nextHealthState) => {
    if (!db) {
      throw new Error('Firebase is not configured')
    }

    const target = doc(db, GRID_COLLECTION, gridDocId)
    await updateDoc(target, {
      healthState: nextHealthState,
      lastUpdated: serverTimestamp(),
    })
  }, [])

  return useMemo(
    () => ({
      grids,
      isLoading,
      error,
      saveGrid,
      saveOrUpdateGridByFeature,
      deleteGrid,
      updateGridHealthState,
      isFirebaseConfigured,
    }),
    [
      deleteGrid,
      error,
      grids,
      isLoading,
      saveGrid,
      saveOrUpdateGridByFeature,
      updateGridHealthState,
    ],
  )
}
