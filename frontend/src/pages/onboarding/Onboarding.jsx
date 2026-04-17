import { useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSessionContext } from '../../hooks/useSessionContext'
import { geocodeLocation } from '../../services/locationResolver'
import { clearPostAuthPath, getPostAuthPath } from '../../utils/navigationState'

export default function Onboarding() {
  const routerLocation = useLocation()
  const navigate = useNavigate()
  const { completeOnboarding, profile } = useSessionContext()
  const fromProfile = Boolean(routerLocation.state?.fromProfile)
  const [step, setStep] = useState(0)
  const [farmName, setFarmName] = useState('')
  const [location, setLocation] = useState('')
  const [variety, setVariety] = useState('')
  const [language, setLanguage] = useState('BM')
  const [isSaving, setIsSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const hydratedFromProfileRef = useRef(false)

  const progress = useMemo(() => ((step + 1) / 3) * 100, [step])

  const canProceed =
    (step === 0 && farmName.trim().length > 2) ||
    (step === 1 && location.trim().length > 5) ||
    (step === 2 && variety.trim().length > 1)

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

  const onNext = async () => {
    if (!canProceed) {
      return
    }

    if (step < 2) {
      setStep((value) => value + 1)
      return
    }

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

  return (
    <div className="pg-public-screen">
      <section className="pg-auth-card">
        <p className="pg-eyebrow">Step {step + 1} of 3</p>
        <h1 className="pg-title">Set up your farm</h1>
        <p className="pg-copy">A few details help tailor tips to your field.</p>
        <div className="pg-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress}%` }} />
        </div>

        {step === 0 ? (
          <>
            <label className="pg-field-label" htmlFor="farmName">Farm name</label>
            <input
              id="farmName"
              className="pg-input"
              placeholder="Kampung Seri Murni Plot"
              value={farmName}
              onChange={(event) => setFarmName(event.target.value)}
            />
          </>
        ) : null}

        {step === 1 ? (
          <>
            <label className="pg-field-label" htmlFor="location">Farm address</label>
            <input
              id="location"
              className="pg-input"
              placeholder="Lot, village, district, state"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
            <p className="pg-copy">Enter the most precise farm address you have. You can update it anytime from Profile.</p>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <label className="pg-field-label" htmlFor="variety">Padi type</label>
            <input
              id="variety"
              className="pg-input"
              placeholder="MR219"
              value={variety}
              onChange={(event) => setVariety(event.target.value)}
            />

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
          </>
        ) : null}

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
          {step > 0 ? (
            <button type="button" className="pg-btn pg-btn-ghost" onClick={() => setStep((value) => value - 1)}>
              Back
            </button>
          ) : null}
          <button type="button" className="pg-btn pg-btn-primary" onClick={onNext} disabled={!canProceed || isSaving}>
            {isSaving ? 'Saving…' : step === 2 ? 'Save and continue' : 'Next'}
          </button>
        </div>
      </section>
    </div>
  )
}
