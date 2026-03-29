import { IconMoon, IconSun } from '../icons/UiIcons'
import { useThemeContext } from '../../hooks/useThemeContext'

export default function ThemeToggle({ showLabel = false, className = '' }) {
  const { isDarkMode, toggleTheme } = useThemeContext()
  const labelText = isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <button
      type="button"
      className={`pg-theme-toggle ${showLabel ? 'is-label' : ''} ${className}`.trim()}
      onClick={toggleTheme}
      aria-label={labelText}
      title={labelText}
    >
      {isDarkMode ? <IconSun className="pg-icon" /> : <IconMoon className="pg-icon" />}
      {showLabel ? <span>{isDarkMode ? 'Light mode' : 'Dark mode'}</span> : null}
    </button>
  )
}
