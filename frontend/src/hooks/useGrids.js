import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const USERS_COLLECTION = 'users'
const GRID_COLLECTION = 'grids'
const GRID_STREAM_LOADING_TIMEOUT_MS = 12000

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

function getUserGridCollection(firestore, ownerUid) {
  return collection(firestore, USERS_COLLECTION, ownerUid, GRID_COLLECTION)
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

  const message = error?.message || fallback
  return error?.code ? `${message} (code: ${error.code})` : message
}

export function useGrids() {
  const [grids, setGrids] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [authStateReady, setAuthStateReady] = useState(() => !isFirebaseConfigured || !auth)
  const [authUser, setAuthUser] = useState(() => auth?.currentUser || null)
  const migratedUsersRef = useRef(new Set())

  const migrateLegacyGridsForUser = useCallback(async (userUid) => {
    if (!db || !userUid || migratedUsersRef.current.has(userUid)) {
      return
    }

    const legacyQuery = query(
      collection(db, GRID_COLLECTION),
      where('ownerUid', '==', userUid),
    )
    const legacySnapshot = await getDocs(legacyQuery)

    if (legacySnapshot.empty) {
      migratedUsersRef.current.add(userUid)
      return
    }

    await Promise.all(
      legacySnapshot.docs.map(async (legacyDoc) => {
        const payload = legacyDoc.data() || {}
        const targetRef = doc(db, USERS_COLLECTION, userUid, GRID_COLLECTION, legacyDoc.id)

        await setDoc(targetRef, payload, { merge: true })
        await deleteDoc(legacyDoc.ref)
      }),
    )

    migratedUsersRef.current.add(userUid)
  }, [])

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

    let unsubscribe = () => {}
    let cancelled = false
    let hasResolvedInitialSnapshot = false
    let loadingTimeoutId = null

    const connectGridStream = async () => {
      setIsLoading(true)

      const gridsRef = getUserGridCollection(db, authUser.uid)
      const gridsQuery = query(gridsRef)

      loadingTimeoutId = window.setTimeout(() => {
        if (cancelled || hasResolvedInitialSnapshot) {
          return
        }

        setIsLoading(false)
      }, GRID_STREAM_LOADING_TIMEOUT_MS)

      unsubscribe = onSnapshot(
        gridsQuery,
        (snapshot) => {
          hasResolvedInitialSnapshot = true
          if (loadingTimeoutId) {
            window.clearTimeout(loadingTimeoutId)
            loadingTimeoutId = null
          }

          const nextGrids = snapshot.docs.map((item) => {
            const data = item.data()

            return {
              id: item.id,
              ...data,
              polygon: deserializeGeometry(data.polygon),
              bufferZone: deserializeGeometry(data.bufferZone),
              spreadGeometry: deserializeGeometry(data.spreadGeometry),
            }
          })

          setGrids(sortByHealthAndTime(nextGrids))
          setIsLoading(false)
          setError(null)
        },
        (snapshotError) => {
          hasResolvedInitialSnapshot = true
          if (loadingTimeoutId) {
            window.clearTimeout(loadingTimeoutId)
            loadingTimeoutId = null
          }

          setError(toFriendlyFirestoreError(snapshotError, 'Failed to stream farm grids'))
          setIsLoading(false)
        },
      )

      void migrateLegacyGridsForUser(authUser.uid).catch((migrationError) => {
        console.warn('Legacy grid migration skipped:', migrationError)
      })
    }

    connectGridStream()

    return () => {
      cancelled = true
      if (loadingTimeoutId) {
        window.clearTimeout(loadingTimeoutId)
      }
      unsubscribe()
    }
  }, [authStateReady, authUser, migrateLegacyGridsForUser])

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

    return addDoc(getUserGridCollection(db, authUser.uid), payload)
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
      const target = doc(db, USERS_COLLECTION, authUser.uid, GRID_COLLECTION, ownedDocId)

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

    // Support both possible ids:
    // 1) map feature id (old flow), 2) direct Firestore doc id (migrated docs)
    await Promise.all([
      deleteDoc(doc(db, USERS_COLLECTION, authUser.uid, GRID_COLLECTION, featureId)),
      deleteDoc(doc(db, USERS_COLLECTION, authUser.uid, GRID_COLLECTION, ownedDocId)),
    ])

    // Cleanup path for docs keyed by mapFeatureId value
    const legacyQuery = query(
      getUserGridCollection(db, authUser.uid),
      where('mapFeatureId', '==', featureId),
    )
    const legacySnapshot = await getDocs(legacyQuery)
    await Promise.all(legacySnapshot.docs.map((item) => deleteDoc(item.ref)))
  }, [authUser?.uid])

  const updateGridHealthState = useCallback(async (gridDocId, nextHealthState) => {
    if (!db || !authUser?.uid) {
      throw new Error('Firebase is not configured')
    }

    const target = doc(db, USERS_COLLECTION, authUser.uid, GRID_COLLECTION, gridDocId)
    await updateDoc(target, {
      healthState: nextHealthState,
      lastUpdated: serverTimestamp(),
    })
  }, [authUser?.uid])

  const updateGridName = useCallback(async (gridDocId, nextGridName) => {
    if (!db || !authUser?.uid) {
      throw new Error('Firebase is not configured')
    }

    const safeName = String(nextGridName || '').trim()
    if (!safeName) {
      throw new Error('Zone name cannot be empty')
    }

    const target = doc(db, USERS_COLLECTION, authUser.uid, GRID_COLLECTION, gridDocId)
    await updateDoc(target, {
      gridId: safeName,
      lastUpdated: serverTimestamp(),
    })
  }, [authUser?.uid])

  const updateGridCropType = useCallback(async (gridDocId, nextCropType) => {
    if (!db || !authUser?.uid) {
      throw new Error('Firebase is not configured')
    }

    const safeCropType = String(nextCropType ?? '').trim()
    const target = doc(db, USERS_COLLECTION, authUser.uid, GRID_COLLECTION, gridDocId)
    await updateDoc(target, {
      cropType: safeCropType || null,
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
      updateGridName,
      updateGridCropType,
      isFirebaseConfigured,
    }),
    [
      deleteGrid,
      error,
      grids,
      isLoading,
      saveGrid,
      saveOrUpdateGridByFeature,
      updateGridName,
      updateGridCropType,
      updateGridHealthState,
    ],
  )
}
