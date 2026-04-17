import { onAuthStateChanged } from 'firebase/auth'
import { useEffect, useMemo, useState } from 'react'
import { auth, isFirebaseConfigured } from '../firebase'
import { signOutCurrentUser } from '../services/auth'
import {
  bootstrapUserProfile,
  createUserProfile,
  clearOnboardingProfile,
  normalizeOnboardingData,
  saveOnboardingProfile,
} from '../services/userProfile'

export function useSession() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(auth?.currentUser))
  const [isOnboarded, setIsOnboarded] = useState(false)
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

      setIsAuthLoading(true)
      setUser(nextUser)
      setIsAuthenticated(Boolean(nextUser))

      if (!nextUser) {
        setProfile(null)
        setIsOnboarded(false)
        setIsAuthLoading(false)
        return
      }

      try {
        let nextProfile = await bootstrapUserProfile(nextUser)
        if (!active) {
          return
        }

        if (!nextProfile) {
          const creationTime = new Date(nextUser.metadata?.creationTime || 0).getTime()
          const lastSignInTime = new Date(nextUser.metadata?.lastSignInTime || 0).getTime()
          const isReturningUser = Boolean(creationTime && lastSignInTime && creationTime !== lastSignInTime)

          if (isReturningUser) {
            // Migration path: legacy accounts created before profile docs existed.
            nextProfile = await createUserProfile(nextUser, {
              onboardingCompleted: true,
              onboarding: {
                farmName: null,
                location: null,
                locationLabel: null,
                locationLat: null,
                locationLng: null,
                locationSource: null,
                variety: null,
                language: 'BM',
              },
            })
          }
        }

        setProfile(nextProfile)
        const profileOnboarded = Boolean(nextProfile?.onboardingCompleted)
        setIsOnboarded(profileOnboarded)
      } catch {
        if (!active) {
          return
        }

        setProfile(null)
        setIsOnboarded(false)
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

  const logout = async () => {
    if (isFirebaseConfigured && auth) {
      await signOutCurrentUser()
      return
    }

    setIsAuthenticated(false)
    setUser(null)
  }

  const completeOnboarding = async (onboardingData = null) => {
    if (!user?.uid || !isFirebaseConfigured) {
      throw new Error('Authenticated Firebase session is required to complete onboarding.')
    }

    const normalizedOnboarding = normalizeOnboardingData(onboardingData)

    await saveOnboardingProfile(user.uid, normalizedOnboarding)

    setProfile((current) => ({
      ...(current || {}),
      onboardingCompleted: true,
      onboarding: {
        ...normalizedOnboarding,
      },
      onboardingSyncStatus: 'synced',
    }))

    setIsOnboarded(true)

    return { persisted: true }
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
  }

  return useMemo(
    () => ({
      isAuthenticated,
      isOnboarded,
      user,
      profile,
      isAuthLoading,
      logout,
      completeOnboarding,
      resetOnboarding,
    }),
    [isAuthenticated, isAuthLoading, isOnboarded, profile, user],
  )
}
