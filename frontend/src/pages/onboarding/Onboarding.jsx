import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useSessionContext } from '../../hooks/useSessionContext'
import { geocodeLocation } from '../../services/locationResolver'
import { clearPostAuthPath, getPostAuthPath } from '../../utils/navigationState'

export default function Onboarding() {
  const routerLocation = useLocation()
  const navigate = useNavigate()
  const { completeOnboarding, profile } = useSessionContext()
  const fromProfile = Boolean(routerLocation.state?.fromProfile)
  const [farmName, setFarmName] = useState('')
  const [location, setLocation] = useState('')
  const [variety, setVariety] = useState('')
  const [language, setLanguage] = useState('BM')
  const [isSaving, setIsSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const hydratedFromProfileRef = useRef(false)

  const canSubmit =
    farmName.trim().length > 2 &&
    location.trim().length > 5 &&
    language.trim().length > 0

  const saveOnboarding = async () => {
    setIsSaving(true)
    setFeedback('')

    try {
      const trimmedLocation = location.trim()
      let resolvedLocation = null

      if (trimmedLocation) {
        try {
          resolvedLocation = await geocodeLocation(trimmedLocation)
        } catch {
          resolvedLocation = null
        }
      }

      const result = await completeOnboarding({
        farmName: farmName.trim(),
        location: trimmedLocation,
        locationLabel: resolvedLocation?.label || trimmedLocation,
        locationLat: resolvedLocation?.lat ?? null,
        locationLng: resolvedLocation?.lng ?? null,
        locationSource: resolvedLocation ? 'geocoded' : 'manual',
        variety: variety.trim(),
        language,
      })

      if (result?.persisted === false) {
        setFeedback('Saved locally. Cloud sync will retry when connection is ready.')
      }

      const resumePath = fromProfile ? '/app/profile' : getPostAuthPath()
      clearPostAuthPath()
      navigate(resumePath && resumePath.startsWith('/app') ? resumePath : '/app', { replace: true })
    } catch (error) {
      setFeedback(error?.message || 'Unable to complete setup right now. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  useEffect(() => {
    const onboarding = profile?.onboarding
    if (!onboarding || hydratedFromProfileRef.current) {
      return
    }

    setFarmName(String(onboarding.farmName || '').trim())
    setLocation(String(onboarding.locationLabel || onboarding.location || '').trim())
    setVariety(String(onboarding.variety || '').trim())
    setLanguage(String(onboarding.language || 'BM').trim() || 'BM')
    hydratedFromProfileRef.current = true
  }, [profile?.onboarding])

  const onSubmit = async () => {
    if (!canSubmit) {
      return
    }

    await saveOnboarding()
  }

  return (
    <div className="pg-public-screen">
      <section className="pg-auth-card">
        <h1 className="pg-title">Set up your farm</h1>
        <p className="pg-copy">Fill in your farm name, address, and language.</p>

        <label className="pg-field-label" htmlFor="farmName">Farm name</label>
        <input
          id="farmName"
          className="pg-input"
          placeholder="Kampung Seri Murni Plot"
          value={farmName}
          onChange={(event) => setFarmName(event.target.value)}
        />

        <label className="pg-field-label" htmlFor="location">Farm address</label>
        <input
          id="location"
          className="pg-input"
          placeholder="Lot, village, district, state"
          value={location}
          onChange={(event) => setLocation(event.target.value)}
        />
        <p className="pg-copy">Enter the most precise farm address you have. You can update it anytime from Profile.</p>

        <label className="pg-field-label" htmlFor="language">Language</label>
        <select
          id="language"
          className="pg-input"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
        >
          <option value="BM">Bahasa Melayu</option>
          <option value="EN">English</option>
        </select>

        {feedback ? <p className="pg-copy">{feedback}</p> : null}

        <div className="pg-cta-row">
          {fromProfile ? (
            <button
              type="button"
              className="pg-btn pg-btn-ghost"
              onClick={() => navigate('/app/profile')}
            >
              Back to profile
            </button>
          ) : null}
          <button type="button" className="pg-btn pg-btn-primary" onClick={onSubmit} disabled={!canSubmit || isSaving}>
            {isSaving ? 'Saving…' : (fromProfile ? 'Save changes' : 'Save and continue')}
          </button>
        </div>
      </section>
    </div>
  )
}
