import {
  GoogleAuthProvider,
  OAuthProvider,
  RecaptchaVerifier,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { auth, isFirebaseConfigured } from '../firebase'

let recaptchaVerifier = null

function ensureAuth() {
  if (!isFirebaseConfigured || !auth) {
    throw new Error('Firebase Auth is not configured. Check your frontend/.env values.')
  }

  return auth
}

export async function signInWithEmail(email, password) {
  const authInstance = ensureAuth()
  return signInWithEmailAndPassword(authInstance, email, password)
}

export async function signUpWithEmail(email, password, fullName) {
  const authInstance = ensureAuth()
  const credential = await createUserWithEmailAndPassword(authInstance, email, password)

  if (fullName?.trim()) {
    await updateProfile(credential.user, {
      displayName: fullName.trim(),
    })
  }

  return credential
}

export async function signInWithGoogleProvider() {
  const authInstance = ensureAuth()
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  return signInWithPopup(authInstance, provider)
}

export async function signInWithAppleProvider() {
  const authInstance = ensureAuth()
  const provider = new OAuthProvider('apple.com')
  provider.addScope('email')
  provider.addScope('name')
  return signInWithPopup(authInstance, provider)
}

function ensureRecaptcha(containerId = 'recaptcha-container') {
  const authInstance = ensureAuth()

  if (recaptchaVerifier) {
    return recaptchaVerifier
  }

  recaptchaVerifier = new RecaptchaVerifier(authInstance, containerId, {
    size: 'invisible',
  })

  return recaptchaVerifier
}

export async function startPhoneAuth(phoneNumber, containerId = 'recaptcha-container') {
  const authInstance = ensureAuth()
  const verifier = ensureRecaptcha(containerId)
  return signInWithPhoneNumber(authInstance, phoneNumber, verifier)
}

export async function confirmPhoneOtp(confirmationResult, code) {
  if (!confirmationResult) {
    throw new Error('OTP session has expired. Please request a new code.')
  }

  return confirmationResult.confirm(code)
}

export async function sendResetPassword(email) {
  const authInstance = ensureAuth()
  return sendPasswordResetEmail(authInstance, email)
}

export async function signOutCurrentUser() {
  const authInstance = ensureAuth()
  return signOut(authInstance)
}