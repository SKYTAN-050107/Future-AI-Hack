import { useMemo, useState } from 'react'

function loadFlag(key) {
  return localStorage.getItem(key) === '1'
}

export function useSession() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => loadFlag('padiguard_auth'))
  const [isOnboarded, setIsOnboarded] = useState(() => loadFlag('padiguard_onboarded'))

  const login = () => {
    setIsAuthenticated(true)
    localStorage.setItem('padiguard_auth', '1')
  }

  const logout = () => {
    setIsAuthenticated(false)
    localStorage.removeItem('padiguard_auth')
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
      login,
      logout,
      completeOnboarding,
      resetOnboarding,
    }),
    [isAuthenticated, isOnboarded],
  )
}
