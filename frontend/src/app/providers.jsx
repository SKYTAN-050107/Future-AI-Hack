import { BrowserRouter } from 'react-router-dom'
import { SessionProvider } from '../hooks/useSessionContext'

export default function AppProviders({ children }) {
  return (
    <BrowserRouter>
      <SessionProvider>{children}</SessionProvider>
    </BrowserRouter>
  )
}
