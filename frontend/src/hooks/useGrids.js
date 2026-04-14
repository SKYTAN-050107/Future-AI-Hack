import { useCallback, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { auth, db, isFirebaseConfigured } from '../firebase'

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

function getOwnedGridDocId(ownerUid, mapFeatureId) {
  return `${ownerUid}_${String(mapFeatureId)}`
}

function serializeGeometry(geometry) {
  if (!geometry) {
    return null
  }

  return JSON.stringify(geometry)
}

function deserializeGeometry(value) {
  if (!value) {
    return null
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }

  return value
}

function toFriendlyFirestoreError(error, fallback) {
  if (error?.code === 'permission-denied') {
    return 'Missing or insufficient permissions. Please sign in again and ensure Firestore rules are deployed.'
  }

  return error?.message || fallback
}

export function useGrids() {
  const [grids, setGrids] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [authStateReady, setAuthStateReady] = useState(() => !isFirebaseConfigured || !auth)
  const [authUser, setAuthUser] = useState(() => auth?.currentUser || null)

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setAuthStateReady(true)
      setAuthUser(null)
      return undefined
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setAuthUser(nextUser)
      setAuthStateReady(true)
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured || !db) {
      setIsLoading(false)
      setError('Firebase is not configured yet. Fill frontend/.env first.')
      return undefined
    }

    if (!authStateReady) {
      setIsLoading(true)
      setError(null)
      return undefined
    }

    if (!authUser) {
      setIsLoading(false)
      setGrids([])
      setError('Sign in is required to sync grids.')
      return undefined
    }

    setIsLoading(true)
    const gridsRef = collection(db, GRID_COLLECTION)
    const gridsQuery = query(gridsRef, where('ownerUid', '==', authUser.uid))
    const unsubscribe = onSnapshot(
      gridsQuery,
      (snapshot) => {
        const nextGrids = snapshot.docs.map((item) => {
          const data = item.data()

          return {
            id: item.id,
            ...data,
            polygon: deserializeGeometry(data.polygon),
            bufferZone: deserializeGeometry(data.bufferZone),
          }
        })

        setGrids(sortByHealthAndTime(nextGrids))
        setIsLoading(false)
        setError(null)
      },
      (snapshotError) => {
        setError(toFriendlyFirestoreError(snapshotError, 'Failed to stream farm grids'))
        setIsLoading(false)
      },
    )

    return () => unsubscribe()
  }, [authStateReady, authUser])

  const saveGrid = useCallback(async ({ gridId, polygon, areaHectares, centroid, plantDensity }) => {
    if (!db || !authUser?.uid) {
      throw new Error('Firebase is not configured')
    }

    const payload = {
      ownerUid: authUser.uid,
      gridId,
      polygon: serializeGeometry(polygon),
      areaHectares,
      centroid,
      plantDensity: plantDensity ?? null,
      healthState: 'Healthy',
      lastUpdated: serverTimestamp(),
      createdAt: serverTimestamp(),
    }

    return addDoc(collection(db, GRID_COLLECTION), payload)
  }, [authUser?.uid])

  const saveOrUpdateGridByFeature = useCallback(
    async ({ mapFeatureId, gridId, polygon, areaHectares, centroid, plantDensity, healthState = 'Healthy' }) => {
      if (!db || !authUser?.uid) {
        throw new Error('Firebase is not configured')
      }

      if (!mapFeatureId) {
        throw new Error('mapFeatureId is required')
      }

      const ownedDocId = getOwnedGridDocId(authUser.uid, mapFeatureId)
      const target = doc(db, GRID_COLLECTION, ownedDocId)

      await setDoc(
        target,
        {
          ownerUid: authUser.uid,
          mapFeatureId,
          gridId,
          polygon: serializeGeometry(polygon),
          areaHectares,
          centroid,
          plantDensity: plantDensity ?? null,
          healthState,
          lastUpdated: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true },
      )
    },
    [authUser?.uid],
  )

  const deleteGrid = useCallback(async (gridDocId) => {
    if (!db || !authUser?.uid) {
      throw new Error('Firebase is not configured')
    }

    const featureId = String(gridDocId)
    const ownedDocId = getOwnedGridDocId(authUser.uid, featureId)

    // New schema path (owner-scoped doc id)
    await deleteDoc(doc(db, GRID_COLLECTION, ownedDocId))

    // Legacy cleanup path (old doc ids using mapFeatureId)
    const legacyQuery = query(
      collection(db, GRID_COLLECTION),
      where('ownerUid', '==', authUser.uid),
      where('mapFeatureId', '==', featureId),
    )
    const legacySnapshot = await getDocs(legacyQuery)
    await Promise.all(legacySnapshot.docs.map((item) => deleteDoc(item.ref)))
  }, [authUser?.uid])

  const updateGridHealthState = useCallback(async (gridDocId, nextHealthState) => {
    if (!db || !authUser?.uid) {
      throw new Error('Firebase is not configured')
    }

    const target = doc(db, GRID_COLLECTION, gridDocId)
    await updateDoc(target, {
      healthState: nextHealthState,
      lastUpdated: serverTimestamp(),
    })
  }, [authUser?.uid])

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
