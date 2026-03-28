import { useNavigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useSessionContext } from '../../hooks/useSessionContext'
import { clearPostAuthPath, getPostAuthPath } from '../../utils/navigationState'

export default function Onboarding() {
  const navigate = useNavigate()
  const { completeOnboarding } = useSessionContext()
  const [step, setStep] = useState(0)
  const [farmName, setFarmName] = useState('')
  const [location, setLocation] = useState('')
  const [variety, setVariety] = useState('')
  const [language, setLanguage] = useState('BM')

  const progress = useMemo(() => ((step + 1) / 3) * 100, [step])

  const canProceed =
    (step === 0 && farmName.trim().length > 2) ||
    (step === 1 && location.trim().length > 2) ||
    (step === 2 && variety.trim().length > 1)

  const onNext = () => {
    if (!canProceed) {
      return
    }

    if (step < 2) {
      setStep((value) => value + 1)
      return
    }

    completeOnboarding()
    const resumePath = getPostAuthPath()
    clearPostAuthPath()
    navigate(resumePath && resumePath.startsWith('/app') ? resumePath : '/app', { replace: true })
  }

  return (
    <div className="pg-public-screen">
      <section className="pg-auth-card">
        <p className="pg-eyebrow">Step {step + 1} of 3</p>
        <h1 className="pg-title">Quick Farm Setup</h1>
        <p className="pg-copy">We only ask what is required to personalize your advice.</p>
        <div className="pg-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress}%` }} />
        </div>

        {step === 0 ? (
          <>
            <label className="pg-field-label" htmlFor="farmName">Farm Name</label>
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
            <label className="pg-field-label" htmlFor="location">Farm Location</label>
            <input
              id="location"
              className="pg-input"
              placeholder="Mukim, district, state"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <label className="pg-field-label" htmlFor="variety">Padi Variety</label>
            <input
              id="variety"
              className="pg-input"
              placeholder="MR219"
              value={variety}
              onChange={(event) => setVariety(event.target.value)}
            />

            <label className="pg-field-label" htmlFor="language">Preferred Language</label>
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

        <div className="pg-cta-row">
          {step > 0 ? (
            <button type="button" className="pg-btn pg-btn-ghost" onClick={() => setStep((value) => value - 1)}>
              Back
            </button>
          ) : null}
          <button className="pg-btn pg-btn-primary" onClick={onNext} disabled={!canProceed}>
            {step === 2 ? 'Save and Continue' : 'Next'}
          </button>
        </div>
      </section>
    </div>
  )
}
