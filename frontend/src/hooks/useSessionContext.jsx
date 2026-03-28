import { createContext, useContext } from 'react'
import { useSession } from './useSession'

const SessionContext = createContext(null)

export function SessionProvider({ children }) {
  const value = useSession()
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSessionContext() {
  const ctx = useContext(SessionContext)

  if (!ctx) {
    throw new Error('useSessionContext must be used inside SessionProvider')
  }

  return ctx
}
