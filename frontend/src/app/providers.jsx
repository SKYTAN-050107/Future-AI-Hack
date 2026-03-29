import { BrowserRouter } from 'react-router-dom'
import { SessionProvider } from '../hooks/useSessionContext'
import { ThemeProvider } from '../hooks/useThemeContext'

export default function AppProviders({ children }) {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <SessionProvider>{children}</SessionProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
