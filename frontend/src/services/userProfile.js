import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase'

const USERS_COLLECTION = 'users'

function toSafeNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeOnboardingData(onboardingData = {}) {
  const farmName = String(onboardingData?.farmName || '').trim() || null
  const location = String(onboardingData?.location || '').trim() || null
  const locationLabel = String(onboardingData?.locationLabel || onboardingData?.locationResolved?.label || location || '').trim() || location
  const locationLat = toSafeNumber(onboardingData?.locationLat ?? onboardingData?.locationResolved?.lat)
  const locationLng = toSafeNumber(onboardingData?.locationLng ?? onboardingData?.locationResolved?.lng)
  const locationSource = String(onboardingData?.locationSource || 'manual').trim() || 'manual'
  const variety = String(onboardingData?.variety || '').trim() || null
  const language = String(onboardingData?.language || 'BM').trim() || 'BM'

  return {
    farmName,
    location,
    locationLabel,
    locationLat,
    locationLng,
    locationSource,
    variety,
    language,
  }
}

function ensureFirestoreReady() {
  if (!isFirebaseConfigured || !db) {
    throw new Error('Firestore is not configured')
  }

  return db
}

function getUserRef(uid) {
  const firestore = ensureFirestoreReady()
  return doc(firestore, USERS_COLLECTION, uid)
}

export async function bootstrapUserProfile(user) {
  if (!user?.uid || !isFirebaseConfigured || !db) {
    return null
  }

  const userRef = getUserRef(user.uid)
  const snapshot = await getDoc(userRef)

  if (!snapshot.exists()) {
    return null
  }

  await updateDoc(userRef, {
    email: user.email || snapshot.data()?.email || null,
    displayName: user.displayName || snapshot.data()?.displayName || null,
    phoneNumber: user.phoneNumber || snapshot.data()?.phoneNumber || null,
    lastLoginAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  const refreshed = await getDoc(userRef)
  return refreshed.data() || null
}

export async function createUserProfile(user, partialProfile = {}) {
  if (!user?.uid || !isFirebaseConfigured || !db) {
    throw new Error('Cannot create user profile without authenticated user and Firestore config')
  }

  const userRef = getUserRef(user.uid)
  const snapshot = await getDoc(userRef)
  if (snapshot.exists()) {
    return snapshot.data()
  }

  const payload = {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null,
    phoneNumber: user.phoneNumber || null,
    onboardingCompleted: false,
    onboarding: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastLoginAt: serverTimestamp(),
    ...partialProfile,
  }

  await setDoc(userRef, payload, { merge: true })
  const refreshed = await getDoc(userRef)
  return refreshed.data() || null
}

export async function getUserProfile(uid) {
  if (!uid || !isFirebaseConfigured || !db) {
    return null
  }

  const snapshot = await getDoc(getUserRef(uid))
  return snapshot.exists() ? snapshot.data() : null
}

export async function saveOnboardingProfile(uid, onboardingData) {
  if (!uid) {
    throw new Error('uid is required')
  }

  const normalized = normalizeOnboardingData(onboardingData)

  const payload = {
    onboardingCompleted: true,
    onboarding: {
      farmName: normalized.farmName,
      location: normalized.location,
      locationLabel: normalized.locationLabel,
      locationLat: normalized.locationLat,
      locationLng: normalized.locationLng,
      locationSource: normalized.locationSource,
      variety: normalized.variety,
      language: normalized.language,
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    updatedAt: serverTimestamp(),
  }

  await setDoc(getUserRef(uid), payload, { merge: true })
}

export async function clearOnboardingProfile(uid) {
  if (!uid || !isFirebaseConfigured || !db) {
    return
  }

  await setDoc(getUserRef(uid), {
    onboardingCompleted: false,
    onboarding: null,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export async function saveActiveCropSelection(uid, cropId) {
  if (!uid || !isFirebaseConfigured || !db) {
    return
  }

  await setDoc(getUserRef(uid), {
    activeCropId: String(cropId || '').trim() || null,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}