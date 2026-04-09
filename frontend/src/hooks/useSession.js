import { onAuthStateChanged } from 'firebase/auth'
import { useEffect, useMemo, useState } from 'react'
import { auth, isFirebaseConfigured } from '../firebase'
import { signOutCurrentUser } from '../services/auth'

function loadFlag(key) {
  return localStorage.getItem(key) === '1'
}

export function useSession() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(auth?.currentUser))
  const [isOnboarded, setIsOnboarded] = useState(() => loadFlag('padiguard_onboarded'))
  const [user, setUser] = useState(() => auth?.currentUser || null)
  const [isAuthLoading, setIsAuthLoading] = useState(() => Boolean(isFirebaseConfigured && auth))

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setIsAuthenticated(false)
      setUser(null)
      setIsAuthLoading(false)
      return undefined
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser)
      setIsAuthenticated(Boolean(nextUser))
      setIsAuthLoading(false)
    })

    return () => unsubscribe()
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

  const completeOnboarding = () => {
    setIsOnboarded(true)
    localStorage.setItem('padiguard_onboarded', '1')
  }

  const resetOnboarding = () => {
    setIsOnboarded(false)
    localStorage.removeItem('padiguard_onboarded')
  }

  return useMemo(
    () => ({
      isAuthenticated,
      isOnboarded,
      user,
      isAuthLoading,
      login,
      logout,
      completeOnboarding,
      resetOnboarding,
    }),
    [isAuthenticated, isAuthLoading, isOnboarded, user],
  )
}
