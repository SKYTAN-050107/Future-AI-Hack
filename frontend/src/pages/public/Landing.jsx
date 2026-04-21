import { useNavigate } from 'react-router-dom'
import { useMemo, useState, useEffect, useRef } from 'react'
import { usePWA } from '../../hooks/usePWA'
import {
  IconMicroscope,
  IconMap,
  IconChart,
  IconCloud,
  IconClipboard,
  IconDownload,
} from '../../components/icons/UiIcons'
import ThemeToggle from '../../components/ui/ThemeToggle'
import '../../styles/landing-additions.css'

const zoneTint = 'color-mix(in srgb, var(--primary) 16%, transparent)'

/* ── Data ───────────────────────────────────────────── */
const featureCards = [
  {
    tag: 'Leaf check',
    title: 'Catch disease early',
    copy: 'Photo leaves and see the disease name and how serious it looks.',
    Icon: IconMicroscope,
  },
  {
    tag: 'Farm map',
    title: 'Work by zone',
    copy: 'Split the farm into areas so sprays and checks stay clear.',
    Icon: IconMap,
  },
  {
    tag: 'Treatment',
    title: 'Spend wisely',
    copy: 'Compare cost and safer options before you buy and apply.',
    Icon: IconChart,
  },
  {
    tag: 'Weather',
    title: 'Spray at the right time',
    copy: 'Get timing tips so rain does not wash your spray away.',
    Icon: IconCloud,
  },
]

const flowSteps = [
  {
    num: '01',
    title: 'Map your farm area',
    desc: 'Draw farm areas and size so checks stay tied to each part of the field.',
    Icon: IconMap,
    visual: {
      label: 'Farm layout',
      zones: ['Zone A', 'Zone B', 'Zone C'],
      zoneColors: [zoneTint, zoneTint, zoneTint],
    },
  },
  {
    num: '02',
    title: 'Scan crop condition',
    desc: 'Photo padi leaves to see the problem level and how sure the read is.',
    Icon: IconMicroscope,
    visual: {
      label: 'Scan result',
      disease: 'Leaf blast',
      severity: 72,
      confidence: '94%',
    },
  },
  {
    num: '03',
    title: 'Apply action plan',
    desc: 'Follow spray time, amount, and cost tips with weather in mind.',
    Icon: IconClipboard,
    visual: {
      label: 'Action plan',
      items: ['Spray at 3–5 PM', 'Dosage: 200ml/ha', 'Est. return: RM640'],
    },
  },
]

const statsData = [
  { n: 90, suffix: '%+', label: 'Disease accuracy' },
  { n: 20, suffix: '%', label: 'Yield uplift' },
  { n: 30, suffix: '%', label: 'Less waste' },
  { n: 100, suffix: '%', label: 'Works offline' },
]

const previewZones = [
  { label: 'Zone A', pct: 84 },
  { label: 'Zone B', pct: 64 },
  { label: 'Zone C', pct: 76 },
]

/* ── Utility: intersection observer hook ── */
function useIntersection(ref, options = {}) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true)
        obs.disconnect()
      }
    }, { threshold: 0.15, ...options })
    obs.observe(el)
    return () => obs.disconnect()
  }, [ref])
  return visible
}

/* ── Utility: count-up animation ── */
function CountUp({ target, duration = 1400, delay = 0, suffix = '' }) {
  const [val, setVal] = useState(0)
  const [started, setStarted] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setStarted(true)
        obs.disconnect()
      }
    }, { threshold: 0.3 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!started) return
    const t = setTimeout(() => {
      const start = Date.now()
      const frame = () => {
        const elapsed = Date.now() - start
        const progress = Math.min(elapsed / duration, 1)
        const ease = 1 - Math.pow(1 - progress, 3)
        setVal(Math.round(ease * target))
        if (progress < 1) requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    }, delay)
    return () => clearTimeout(t)
  }, [started, target, duration, delay])

  return <span ref={ref}>{val}{suffix}</span>
}

/* ── Animated progress bar ── */
function AnimatedBar({ value, delay = 0 }) {
  const [width, setWidth] = useState(0)
  const ref = useRef(null)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setStarted(true)
        obs.disconnect()
      }
    }, { threshold: 0.3 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!started) return
    const t = setTimeout(() => setWidth(value), 200 + delay)
    return () => clearTimeout(t)
  }, [started, value, delay])

  return (
    <div ref={ref} className="pg-animated-bar-track">
      <div
        className="pg-animated-bar-fill"
        style={{ width: `${width}%` }}
      />
    </div>
  )
}

/* ── Step visual component ── */
function StepVisual({ step }) {
  const v = step.visual
  if (step.num === '01') {
    return (
      <div className="pg-flow-visual">
        <p className="pg-flow-visual-label">{v.label}</p>
        <div className="pg-flow-zone-grid">
          {v.zones.map((z, i) => (
            <div key={z} className="pg-flow-zone" style={{ background: v.zoneColors[i] }}>
              <span>{z}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (step.num === '02') {
    return (
      <div className="pg-flow-visual">
        <p className="pg-flow-visual-label">{v.label}</p>
        <p className="pg-flow-visual-disease">{v.disease}</p>
        <div className="pg-flow-severity-bar">
          <div className="pg-flow-severity-fill" style={{ width: `${v.severity}%` }} />
        </div>
        <div className="pg-flow-visual-meta">
          <span>Problem level {v.severity}%</span>
          <span>How sure {v.confidence}</span>
        </div>
      </div>
    )
  }
  if (step.num === '03') {
    return (
      <div className="pg-flow-visual">
        <p className="pg-flow-visual-label">{v.label}</p>
        <ul className="pg-flow-action-list">
          {v.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    )
  }
  return null
}

/* ── Main Landing Component ── */
export default function Landing() {
  const navigate = useNavigate()
  const [installHint, setInstallHint] = useState('')
  const [selectedStep, setSelectedStep] = useState(0)
  const [hoveredFeature, setHoveredFeature] = useState(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { canInstall, isIos, isInstalled, promptInstall } = usePWA()
  const previouslyInstalled = typeof window !== 'undefined'
    && localStorage.getItem('padiguard_install_accepted') === '1'

  const selectedFlow = useMemo(() => flowSteps[selectedStep], [selectedStep])
  const SpotlightIcon = selectedFlow.Icon

  // Section refs for scroll-reveal
  const featuresRef = useRef(null)
  const flowRef = useRef(null)
  const ctaRef = useRef(null)
  const statsRef = useRef(null)
  const featuresVisible = useIntersection(featuresRef)
  const flowVisible = useIntersection(flowRef)
  const ctaVisible = useIntersection(ctaRef)
  const statsVisible = useIntersection(statsRef)

  // Auto-cycle workflow steps
  useEffect(() => {
    const interval = setInterval(() => {
      setSelectedStep(s => (s + 1) % flowSteps.length)
    }, 3500)
    return () => clearInterval(interval)
  }, [])

  // Smooth scroll to section
  const scrollToSection = (id) => {
    setMobileMenuOpen(false)
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const onInstall = async () => {
    setInstallHint('')

    if (isInstalled) {
      setInstallHint('AcreZen is already installed. Open it from your home screen.')
      return
    }

    if (canInstall) {
      const accepted = await promptInstall()
      if (accepted) {
        localStorage.setItem('padiguard_install_accepted', '1')
        setInstallHint('Install started. Check your home screen for AcreZen.')
      }
      if (!accepted) {
        setInstallHint('Install was dismissed. You can still continue in browser mode.')
      }
      return
    }
    if (isIos) {
      setInstallHint('On iPhone: tap Share, then Add to Home Screen to install AcreZen.')
      return
    }
    setInstallHint('Install prompt is unavailable right now. You can still continue in browser mode.')
  }

  const onOpenInstalledApp = () => {
    window.location.href = '/'
    setInstallHint('If the app does not open automatically, launch AcreZen from your home screen.')
  }

  const goToAuth = () => {
    navigate('/auth', { state: { forceAuth: true } })
  }

  return (
    <div className="pg-landing-page">
      {/* ── STICKY NAV ── */}
      <nav className="pg-landing-nav">
        <div className="pg-landing-nav-inner">
          <button
            type="button"
            className="pg-landing-nav-logo"
            onClick={() => scrollToSection('hero')}
            aria-label="PadiGuard AI, go to top"
          >
            <span className="pg-landing-nav-logo-dot" aria-hidden="true" />
            <span className="pg-landing-nav-logo-text">
              Acre<strong>Zen</strong>
            </span>
          </button>

          {/* Desktop nav links */}
          <div className="pg-landing-nav-links">
            <button type="button" className="pg-landing-nav-link" onClick={() => scrollToSection('features')}>Features</button>
            <button type="button" className="pg-landing-nav-link" onClick={() => scrollToSection('workflow')}>How it works</button>
            <button type="button" className="pg-landing-nav-link" onClick={() => scrollToSection('cta')}>Get started</button>
          </div>

          {/* Nav CTA */}
          <button type="button" className="pg-landing-nav-cta" onClick={goToAuth}>
            Sign in
          </button>

          {/* Mobile hamburger */}
          <button
            type="button"
            className={`pg-landing-hamburger ${mobileMenuOpen ? 'is-open' : ''}`}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation"
            aria-expanded={mobileMenuOpen}
          >
            <span /><span /><span />
          </button>
        </div>

        {/* Mobile dropdown */}
        {mobileMenuOpen && (
          <div className="pg-landing-mobile-menu">
            <button type="button" className="pg-landing-mobile-link" onClick={() => scrollToSection('features')}>Features</button>
            <button type="button" className="pg-landing-mobile-link" onClick={() => scrollToSection('workflow')}>How it works</button>
            <button type="button" className="pg-landing-mobile-link" onClick={() => scrollToSection('cta')}>Get started</button>
            <ThemeToggle showLabel className="pg-landing-mobile-link pg-landing-mobile-link--theme" />
            <button type="button" className="pg-landing-mobile-link pg-landing-mobile-link--cta" onClick={goToAuth}>Sign in or sign up</button>
          </div>
        )}
      </nav>

      {/* ── MAIN CONTENT ── */}
      <main className="pg-landing-main">

        {/* ── HERO ── */}
        <section id="hero" className="pg-landing-hero-section">
          <div className="pg-landing-hero-content">
            <div className="pg-landing-badge">
              Works offline · For smallholder padi farmers
            </div>
            <h1 className="pg-landing-hero-title">
              Protect your crop with{' '}
              <span className="pg-landing-hero-emphasis">clear, simple</span>{' '}
              decisions in the field.
            </h1>
            <p className="pg-landing-hero-desc">
              Spot problems early, plan sprays and costs, and avoid bad weather timing — in the browser or from your home screen.
            </p>

            {/* Primary CTA — one clear action */}
            <div className="pg-landing-hero-ctas">
              <button type="button" className="pg-btn pg-btn-primary pg-btn-landing pg-btn-landing--primary" onClick={onInstall}>
                <IconDownload className="pg-icon pg-icon--btn" aria-hidden="true" />
                Install app
              </button>
              <button type="button" className="pg-btn pg-btn-ghost pg-btn-landing" onClick={goToAuth}>
                Sign in or sign up
              </button>
              {(isInstalled || previouslyInstalled) && (
                <button type="button" className="pg-btn pg-btn-ghost pg-btn-landing" onClick={onOpenInstalledApp}>
                  Open installed app
                </button>
              )}
            </div>

            {installHint && <p className="pg-install-hint">{installHint}</p>}
          </div>

          {/* Hero preview card */}
          <div className="pg-landing-hero-visual">
            <div className="pg-landing-preview-card-wrapper">
              <p className="pg-landing-preview-label-new">Sample screen</p>
              <div className="pg-landing-preview-card-new">
                <div className="pg-preview-header">
                  <h3>Farm health today</h3>
                  <span className="pg-preview-status-example">Example</span>
                </div>
                <div className="pg-preview-zones-new">
                  {previewZones.map((z, i) => (
                    <div key={z.label} className="pg-preview-zone-item">
                      <span className="pg-preview-zone-name">{z.label}</span>
                      <AnimatedBar value={z.pct} delay={i * 200} />
                      <span className="pg-preview-zone-pct">{z.pct}%</span>
                    </div>
                  ))}
                </div>
                <ul className="pg-preview-alerts">
                  <li>
                    <span className="pg-preview-dot pg-preview-dot--warn" aria-hidden="true" />
                    Leaf blast risk: Zone C
                  </li>
                  <li>
                    <span className="pg-preview-dot pg-preview-dot--ok" aria-hidden="true" />
                    Good spray window: 3 – 5 PM
                  </li>
                  <li>
                    <span className="pg-preview-dot pg-preview-dot--ok" aria-hidden="true" />
                    Est. return: RM110 – RM640
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── TRUST STRIP (single proof block) ── */}
        <section
          ref={statsRef}
          className={`pg-landing-stats-strip ${statsVisible ? 'is-revealed' : ''}`}
          aria-label="What the app can help with"
        >
          {statsData.map((s, i) => (
            <div key={s.label} className="pg-landing-stat-item">
              <span className="pg-landing-stat-num">
                <CountUp target={s.n} delay={300 + i * 150} suffix={s.suffix} />
              </span>
              <span className="pg-landing-stat-label">{s.label}</span>
            </div>
          ))}
        </section>

        {/* ── FEATURES ── */}
        <section
          id="features"
          ref={featuresRef}
          className={`pg-landing-features-section ${featuresVisible ? 'is-revealed' : ''}`}
        >
          <div className="pg-section-tag">What you can do</div>
          <h2 className="pg-landing-section-title">Tools for day-to-day field work</h2>
          <div className="pg-landing-feature-grid-new">
            {featureCards.map((feature, i) => {
              const FeatureIcon = feature.Icon
              return (
              <article
                key={feature.title}
                className={`pg-landing-feature-card-new ${hoveredFeature === i ? 'is-hovered' : ''}`}
                style={{
                  animationDelay: `${i * 100}ms`,
                }}
                onMouseEnter={() => setHoveredFeature(i)}
                onMouseLeave={() => setHoveredFeature(null)}
              >
                <div className="pg-feature-card-icon">
                  <FeatureIcon className="pg-icon pg-icon--feature" />
                </div>
                <div className="pg-feature-card-head">
                  <span className="pg-feature-tag-new">{feature.tag}</span>
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
                <div className="pg-feature-accent-bar" aria-hidden="true" />
              </article>
              )
            })}
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section
          id="workflow"
          ref={flowRef}
          className={`pg-landing-workflow-section ${flowVisible ? 'is-revealed' : ''}`}
        >
          <div className="pg-section-tag">How it works</div>
          <h2 className="pg-landing-section-title">From map to action in three steps</h2>
          <div className="pg-landing-workflow-grid">
            <div className="pg-landing-workflow-steps">
              {flowSteps.map((step, index) => {
                const StepIcon = step.Icon
                return (
                <button
                  key={step.num}
                  type="button"
                  className={`pg-landing-step-new ${selectedStep === index ? 'is-active' : ''}`}
                  onClick={() => setSelectedStep(index)}
                >
                  <span className="pg-step-num-new">{step.num}</span>
                  <div className="pg-step-body-new">
                    <h3 className="pg-step-title-row">
                      <StepIcon className="pg-icon pg-icon--step" />
                      <span>{step.title}</span>
                    </h3>
                    <p>{step.desc}</p>
                  </div>
                  {selectedStep === index && <div className="pg-step-active-bar" />}
                  <span className="pg-step-chevron-new" aria-hidden="true">›</span>
                </button>
                )
              })}
            </div>

            <div className="pg-landing-workflow-spotlight">
              <div className="pg-spotlight-content" key={selectedFlow.num}>
                <div className="pg-spotlight-tag-new">Step {selectedFlow.num}</div>
                <div className="pg-spotlight-icon-wrap" aria-hidden="true">
                  <SpotlightIcon className="pg-icon pg-icon--spotlight" />
                </div>
                <h3>{selectedFlow.title}</h3>
                <p>{selectedFlow.desc}</p>
                <StepVisual step={selectedFlow} />
                <div className="pg-spotlight-progress">
                  {flowSteps.map((_, i) => (
                    <div
                      key={i}
                      className={`pg-spotlight-progress-dot ${selectedStep === i ? 'is-active' : ''}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── FINAL CTA ── */}
        <section
          id="cta"
          ref={ctaRef}
          className={`pg-landing-cta-section ${ctaVisible ? 'is-revealed' : ''}`}
        >
          <div className="pg-section-tag">Get started</div>
          <h2 className="pg-landing-cta-title">Start in the browser, add to home screen when you like</h2>
          <p className="pg-landing-cta-desc">After you sign in, the same steps work whether you use the browser or the installed app.</p>
          <div className="pg-landing-cta-buttons">
            <button type="button" className="pg-btn pg-btn-primary pg-btn-landing pg-btn-landing--primary" onClick={onInstall}>
              <IconDownload className="pg-icon pg-icon--btn" aria-hidden="true" />
              Install AcreZen
            </button>
            <button type="button" className="pg-btn pg-btn-ghost pg-btn-landing" onClick={goToAuth}>
              Sign in or sign up
            </button>
          </div>
        </section>

        {/* ── FOOTER ── */}
        <footer className="pg-landing-footer">
          <span className="pg-landing-footer-brand">
            <span className="pg-landing-nav-logo-dot" aria-hidden="true" /> AcreZen
          </span>
          <span className="pg-landing-footer-copy">© 2026 — Enterprise agronomy in your pocket</span>
        </footer>
      </main>
    </div>
  )
}
