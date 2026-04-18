import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadString } from 'firebase/storage'
import { db, isFirebaseConfigured, storage } from '../firebase'

const USERS_COLLECTION = 'users'
const SCAN_CAPTURE_COLLECTION = 'scanCaptures'
const DEFAULT_CAPTURE_MIME_TYPE = 'image/jpeg'

export function createScanCaptureId() {
  return `capture-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function buildScanCaptureStoragePath(uid, captureId) {
  const safeUid = String(uid || '').trim()
  const safeCaptureId = String(captureId || '').trim()
  return `users/${safeUid}/scanCaptures/${safeCaptureId}.jpg`
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Unable to decode stored scan photo.'))
    reader.readAsDataURL(blob)
  })
}

export async function downloadUrlToDataUrl(downloadURL) {
  if (!downloadURL) {
    throw new Error('downloadURL is required')
  }

  const response = await fetch(downloadURL)
  if (!response.ok) {
    throw new Error('Unable to load stored scan photo.')
  }

  const blob = await response.blob()
  return blobToDataUrl(blob)
}

export async function persistUserScanCapture({
  uid,
  captureId,
  base64Image,
  capturedAt,
  source = 'camera',
  userPrompt = null,
  gridId = null,
  zoneAssignmentMode = null,
  zonePosition = null,
  zonePositionLabel = null,
  conversationId = null,
}) {
  const ownerUid = String(uid || '').trim()
  if (!ownerUid) {
    throw new Error('uid is required to save scan capture')
  }

  const safeBase64Image = String(base64Image || '').trim()
  if (!safeBase64Image) {
    throw new Error('base64Image is required to save scan capture')
  }

  const safeCaptureId = String(captureId || '').trim() || createScanCaptureId()
  const storagePath = buildScanCaptureStoragePath(ownerUid, safeCaptureId)
  const capturedAtIso = String(capturedAt || new Date().toISOString()).trim()

  if (!isFirebaseConfigured || !db || !storage) {
    return {
      captureId: safeCaptureId,
      storagePath,
      downloadURL: null,
      firestorePath: null,
      persisted: false,
      firestorePersisted: false,
      storagePersisted: false,
    }
  }

  const storageRef = ref(storage, storagePath)
  await uploadString(storageRef, safeBase64Image, 'data_url', {
    contentType: DEFAULT_CAPTURE_MIME_TYPE,
  })

  const downloadURL = await getDownloadURL(storageRef)

  const captureDoc = {
    ownerUid,
    captureId: safeCaptureId,
    source,
    userPrompt,
    gridId: gridId || null,
    zoneAssignmentMode: zoneAssignmentMode || null,
    zonePosition: zonePosition || null,
    zonePositionLabel: zonePositionLabel || null,
    conversationId: conversationId || null,
    storagePath,
    downloadURL,
    capturedAt: capturedAtIso,
    mimeType: DEFAULT_CAPTURE_MIME_TYPE,
    status: 'stored',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }

  const firestorePath = `users/${ownerUid}/${SCAN_CAPTURE_COLLECTION}/${safeCaptureId}`
  let firestorePersisted = false
  try {
    await setDoc(doc(db, USERS_COLLECTION, ownerUid, SCAN_CAPTURE_COLLECTION, safeCaptureId), captureDoc, { merge: true })
    firestorePersisted = true
  } catch (error) {
    console.warn('Scan capture metadata write failed:', error)
  }

  return {
    captureId: safeCaptureId,
    storagePath,
    downloadURL,
    firestorePath,
    persisted: firestorePersisted,
    firestorePersisted,
    storagePersisted: true,
  }
}

export async function loadUserScanCapture(uid, captureId) {
  const ownerUid = String(uid || '').trim()
  const safeCaptureId = String(captureId || '').trim()

  if (!ownerUid || !safeCaptureId || !isFirebaseConfigured || !db) {
    return null
  }

  const snapshot = await getDoc(doc(db, USERS_COLLECTION, ownerUid, SCAN_CAPTURE_COLLECTION, safeCaptureId))
  return snapshot.exists() ? snapshot.data() : null
}
