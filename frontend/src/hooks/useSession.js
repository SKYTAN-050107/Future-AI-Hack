import { onAuthStateChanged } from 'firebase/auth'
import { useEffect, useMemo, useState } from 'react'
import { auth, isFirebaseConfigured } from '../firebase'
import { signOutCurrentUser } from '../services/auth'
import {
  bootstrapUserProfile,
  clearOnboardingProfile,
  saveOnboardingProfile,
} from '../services/userProfile'

function loadFlag(key) {
  return localStorage.getItem(key) === '1'
}

export function useSession() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(auth?.currentUser))
  const [isOnboarded, setIsOnboarded] = useState(() => loadFlag('padiguard_onboarded'))
  const [user, setUser] = useState(() => auth?.currentUser || null)
  const [profile, setProfile] = useState(null)
  const [isAuthLoading, setIsAuthLoading] = useState(() => Boolean(isFirebaseConfigured && auth))

  useEffect(() => {
    let active = true

    if (!isFirebaseConfigured || !auth) {
      setIsAuthenticated(false)
      setUser(null)
      setProfile(null)
      setIsAuthLoading(false)
      return undefined
    }

    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      if (!active) {
        return
      }

      setUser(nextUser)
      setIsAuthenticated(Boolean(nextUser))

      if (!nextUser) {
        setProfile(null)
        setIsOnboarded(loadFlag('padiguard_onboarded'))
        setIsAuthLoading(false)
        return
      }

      try {
        const nextProfile = await bootstrapUserProfile(nextUser)
        if (!active) {
          return
        }

        setProfile(nextProfile)
        const profileOnboarded = Boolean(nextProfile?.onboardingCompleted)
        setIsOnboarded(profileOnboarded)
        localStorage.setItem('padiguard_onboarded', profileOnboarded ? '1' : '0')
      } catch {
        if (!active) {
          return
        }

        setProfile(null)
      } finally {
        if (active) {
          setIsAuthLoading(false)
        }
      }
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const login = () => {
    // Firebase auth providers now own login; this method remains for compatibility.
  }

  const logout = async () => {
    if (isFirebaseConfigured && auth) {
      await signOutCurrentUser()
      return
    }

    setIsAuthenticated(false)
    setUser(null)
  }

  const completeOnboarding = async (onboardingData = null) => {
    if (user?.uid && isFirebaseConfigured) {
      await saveOnboardingProfile(user.uid, onboardingData)
      setProfile((current) => ({
        ...(current || {}),
        onboardingCompleted: true,
        onboarding: {
          farmName: onboardingData?.farmName || null,
          location: onboardingData?.location || null,
          variety: onboardingData?.variety || null,
          language: onboardingData?.language || 'BM',
        },
      }))
    }

    setIsOnboarded(true)
    localStorage.setItem('padiguard_onboarded', '1')
  }

  const resetOnboarding = async () => {
    if (user?.uid && isFirebaseConfigured) {
      await clearOnboardingProfile(user.uid)
    }

    setProfile((current) => ({
      ...(current || {}),
      onboardingCompleted: false,
      onboarding: null,
    }))
    setIsOnboarded(false)
    localStorage.removeItem('padiguard_onboarded')
  }

  return useMemo(
    () => ({
      isAuthenticated,
      isOnboarded,
      user,
      profile,
      isAuthLoading,
      login,
      logout,
      completeOnboarding,
      resetOnboarding,
    }),
    [isAuthenticated, isAuthLoading, isOnboarded, profile, user],
  )
}
