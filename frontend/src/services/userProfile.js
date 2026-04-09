import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase'

const USERS_COLLECTION = 'users'

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
    }

    await setDoc(userRef, payload, { merge: true })
    return payload
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

  const payload = {
    onboardingCompleted: true,
    onboarding: {
      farmName: onboardingData?.farmName || null,
      location: onboardingData?.location || null,
      variety: onboardingData?.variety || null,
      language: onboardingData?.language || 'BM',
      completedAt: serverTimestamp(),
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