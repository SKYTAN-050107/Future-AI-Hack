import { useNavigate } from 'react-router-dom'
import { IconArrowLeft } from '../icons/UiIcons'

export default function BackButton({ fallback = '/app', label = 'Go back' }) {
  const navigate = useNavigate()

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate(fallback, { replace: true })
  }

  return (
    <button type="button" className="pg-back-btn" onClick={handleBack} aria-label={label}>
      <IconArrowLeft className="pg-icon" />
    </button>
  )
}
