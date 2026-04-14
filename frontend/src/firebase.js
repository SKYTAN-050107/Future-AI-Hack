import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { enableIndexedDbPersistence, getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const requiredKeys = Object.values(firebaseConfig)
const hasMissingConfig = requiredKeys.some((value) => !value)
const hasPlaceholderValues = requiredKeys.some((value) =>
  typeof value === 'string' && value.includes('YOUR_'),
)

export const isFirebaseConfigured = !hasMissingConfig && !hasPlaceholderValues

let app = null
let db = null
let auth = null

if (isFirebaseConfigured) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig)
  db = getFirestore(app)
  auth = getAuth(app)

  // Force local persistence to support offline-first grid editing.
  enableIndexedDbPersistence(db).catch((error) => {
    if (error?.code !== 'failed-precondition' && error?.code !== 'unimplemented') {
      console.warn('Firestore persistence could not be enabled:', error)
    }
  })
} else {
  console.warn(
    'Firebase environment variables are missing or still using placeholders. Map sync is disabled until configured.',
  )
}

export { app, db, auth }
