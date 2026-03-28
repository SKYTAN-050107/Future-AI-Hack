import { useNavigate } from 'react-router-dom'
import { useMemo, useState, useEffect, useRef } from 'react'
import { usePWA } from '../../hooks/usePWA'
import '../../styles/landing-additions.css'

/* ── Data ───────────────────────────────────────────── */
const featureCards = [
  {
    tag: 'AI Scanner',
    title: 'Detect disease early',
    copy: 'Capture leaf images and receive disease + severity output in seconds.',
    icon: '🔬',
    stat: '90%+',
    statLabel: 'accuracy',
    accent: 'var(--pg-primary)',
  },
  {
    tag: 'Farm Mapper',
    title: 'Track by zone',
    copy: 'Divide your farm into sectors so actions stay targeted and measurable.',
    icon: '🗺️',
    stat: '∞',
    statLabel: 'sectors',
    accent: 'var(--pg-secondary)',
  },
  {
    tag: 'Treatment ROI',
    title: 'Spend where it pays',
    copy: 'Compare cost, yield impact, and safer alternatives before applying treatment.',
    icon: '📊',
    stat: '3×',
    statLabel: 'ROI insight',
    accent: 'var(--pg-accent)',
  },
  {
    tag: 'Climate Timing',
    title: 'Avoid rain mistakes',
    copy: 'Get weather-aware spray timing advice to reduce wasted pesticide usage.',
    icon: '🌦️',
    stat: '30%',
    statLabel: 'less waste',
    accent: '#e47f1f',
  },
]

const flowSteps = [
  {
    num: '01',
    title: 'Map your farm area',
    desc: 'Draw farm sectors and estimate hectares for targeted monitoring.',
    icon: '🗺️',
    visual: {
      label: 'Farm Layout',
      zones: ['Zone A', 'Zone B', 'Zone C'],
      zoneColors: ['rgba(18,163,108,0.22)', 'rgba(15,164,174,0.18)', 'rgba(11,112,117,0.12)'],
    },
  },
  {
    num: '02',
    title: 'Scan crop condition',
    desc: 'Capture padi leaf symptoms and get disease severity with confidence score.',
    icon: '🔬',
    visual: {
      label: 'Scan Result',
      disease: 'Leaf Blast',
      severity: 72,
      confidence: '94%',
    },
  },
  {
    num: '03',
    title: 'Apply action plan',
    desc: 'Follow treatment timing, dosage, and ROI recommendation with weather context.',
    icon: '💊',
    visual: {
      label: 'Action Plan',
      items: ['Spray at 3–5 PM', 'Dosage: 200ml/ha', 'ROI: RM640'],
    },
  },
]

const statsData = [
  { n: 90, suffix: '%+', label: 'Disease Accuracy' },
  { n: 20, suffix: '%', label: 'Yield Uplift' },
  { n: 30, suffix: '%', label: 'Less Waste' },
  { n: 100, suffix: '%', label: 'Offline Ready' },
]

const previewZones = [
  { label: 'Zone A', pct: 84, color: 'var(--pg-primary)' },
  { label: 'Zone B', pct: 64, color: '#ea8c14' },
  { label: 'Zone C', pct: 76, color: 'var(--pg-secondary)' },
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
function AnimatedBar({ value, color, delay = 0 }) {
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
        style={{
          width: `${width}%`,
          background: color,
          boxShadow: width > 0 ? `0 0 10px ${color}44` : 'none',
        }}
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
          <span>Severity {v.severity}%</span>
          <span>Confidence {v.confidence}</span>
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
  const { canInstall, isIos, promptInstall } = usePWA()
  const previouslyInstalled = localStorage.getItem('padiguard_install_accepted') === '1'

  const selectedFlow = useMemo(() => flowSteps[selectedStep], [selectedStep])

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
    if (canInstall) {
      const accepted = await promptInstall()
      if (accepted) {
        localStorage.setItem('padiguard_install_accepted', '1')
      }
      if (!accepted) {
        setInstallHint('Install was dismissed. You can still continue in browser mode.')
      }
      return
    }
    if (isIos) {
      setInstallHint('On iPhone: tap Share, then Add to Home Screen to install PadiGuard AI.')
      return
    }
    setInstallHint('Install prompt is unavailable right now. You can still continue in browser mode.')
  }

  const onOpenInstalledApp = () => {
    window.location.href = '/'
    setInstallHint('If the app does not open automatically, launch PadiGuard AI from your home screen.')
  }

  return (
    <div className="pg-landing-page">
      {/* Decorative background blobs */}
      <div className="pg-landing-bg-blob pg-landing-bg-blob--1" aria-hidden="true" />
      <div className="pg-landing-bg-blob pg-landing-bg-blob--2" aria-hidden="true" />
      <div className="pg-landing-bg-blob pg-landing-bg-blob--3" aria-hidden="true" />

      {/* ── STICKY NAV ── */}
      <nav className="pg-landing-nav">
        <div className="pg-landing-nav-inner">
          <div className="pg-landing-nav-logo" onClick={() => scrollToSection('hero')}>
            <span className="pg-landing-nav-logo-dot" />
            <span className="pg-landing-nav-logo-text">
              Padi<strong>Guard</strong> AI
            </span>
          </div>

          {/* Desktop nav links */}
          <div className="pg-landing-nav-links">
            <button className="pg-landing-nav-link" onClick={() => scrollToSection('features')}>Features</button>
            <button className="pg-landing-nav-link" onClick={() => scrollToSection('workflow')}>How It Works</button>
            <button className="pg-landing-nav-link" onClick={() => scrollToSection('cta')}>Get Started</button>
          </div>

          {/* Nav CTA */}
          <button className="pg-landing-nav-cta" onClick={() => navigate('/auth')}>
            Sign In
          </button>

          {/* Mobile hamburger */}
          <button
            className={`pg-landing-hamburger ${mobileMenuOpen ? 'is-open' : ''}`}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation"
          >
            <span /><span /><span />
          </button>
        </div>

        {/* Mobile dropdown */}
        {mobileMenuOpen && (
          <div className="pg-landing-mobile-menu">
            <button className="pg-landing-mobile-link" onClick={() => scrollToSection('features')}>Features</button>
            <button className="pg-landing-mobile-link" onClick={() => scrollToSection('workflow')}>How It Works</button>
            <button className="pg-landing-mobile-link" onClick={() => scrollToSection('cta')}>Get Started</button>
            <button className="pg-landing-mobile-link pg-landing-mobile-link--cta" onClick={() => navigate('/auth')}>Sign In / Sign Up</button>
          </div>
        )}
      </nav>

      {/* ── MAIN CONTENT ── */}
      <main className="pg-landing-main">

        {/* ── HERO ── */}
        <section id="hero" className="pg-landing-hero-section">
          <div className="pg-landing-hero-content">
            <div className="pg-landing-badge">
              <span className="pg-landing-badge-dot" />
              Offline-first PWA · Smallholder Padi Farmers
            </div>
            <h1 className="pg-landing-hero-title">
              Protect crop yield with{' '}
              <span className="pg-title-accent">AI-guided</span>{' '}
              farm decisions.
            </h1>
            <p className="pg-landing-hero-desc">
              PadiGuard AI helps you detect diseases early, optimize treatment cost, and avoid
              weather-timing mistakes — available in browser and installed mode.
            </p>

            {/* KPI row */}
            <div className="pg-landing-kpi-row">
              {[
                { value: 90, suffix: '%+', label: 'Disease accuracy' },
                { value: 20, suffix: '%', label: 'Yield uplift' },
                { value: 30, suffix: '%', label: 'Less waste' },
              ].map((kpi, i) => (
                <div key={kpi.label} className="pg-landing-kpi-card">
                  <strong>
                    <CountUp target={kpi.value} delay={i * 200} suffix={kpi.suffix} />
                  </strong>
                  <span>{kpi.label}</span>
                </div>
              ))}
            </div>

            {/* CTA buttons */}
            <div className="pg-landing-hero-ctas">
              <button className="pg-btn pg-btn-primary pg-btn-landing" onClick={onInstall}>
                <span className="pg-btn-icon">⬇</span>
                Install App
              </button>
              <button className="pg-btn pg-btn-ghost pg-btn-landing" onClick={() => navigate('/auth')}>
                Sign In / Sign Up
              </button>
              {previouslyInstalled && (
                <button className="pg-btn pg-btn-ghost pg-btn-landing" onClick={onOpenInstalledApp}>
                  Open Installed App
                </button>
              )}
            </div>

            {installHint && <p className="pg-install-hint">{installHint}</p>}
          </div>

          {/* Hero preview card */}
          <div className="pg-landing-hero-visual">
            <div className="pg-landing-preview-card-wrapper">
              <p className="pg-landing-preview-label-new">Live App Preview</p>
              <div className="pg-landing-preview-card-new">
                <div className="pg-preview-header">
                  <h3>Farm Health Today</h3>
                  <span className="pg-preview-status-live">● Live</span>
                </div>
                <div className="pg-preview-zones-new">
                  {previewZones.map((z, i) => (
                    <div key={z.label} className="pg-preview-zone-item">
                      <span className="pg-preview-zone-name">{z.label}</span>
                      <AnimatedBar value={z.pct} color={z.color} delay={i * 200} />
                      <span className="pg-preview-zone-pct">{z.pct}%</span>
                    </div>
                  ))}
                </div>
                <ul className="pg-preview-alerts">
                  <li>
                    <span className="pg-preview-dot pg-preview-dot--warn" />
                    Leaf blast risk: Zone C
                  </li>
                  <li>
                    <span className="pg-preview-dot pg-preview-dot--ok" />
                    Best spray window: 3 – 5 PM
                  </li>
                  <li>
                    <span className="pg-preview-dot pg-preview-dot--ok" />
                    ROI estimate: RM110 – RM640
                  </li>
                </ul>
              </div>
              {/* Floating chips */}
              <div className="pg-preview-chip pg-preview-chip--tl">AI ✓</div>
              <div className="pg-preview-chip pg-preview-chip--br">Offline-ready</div>
            </div>
          </div>
        </section>

        {/* ── STATS STRIP ── */}
        <section
          ref={statsRef}
          className={`pg-landing-stats-strip ${statsVisible ? 'is-revealed' : ''}`}
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
          <div className="pg-section-tag">Core Features</div>
          <h2 className="pg-landing-section-title">Everything needed for practical field decisions</h2>
          <div className="pg-landing-feature-grid-new">
            {featureCards.map((feature, i) => (
              <article
                key={feature.title}
                className={`pg-landing-feature-card-new ${hoveredFeature === i ? 'is-hovered' : ''}`}
                style={{
                  animationDelay: `${i * 100}ms`,
                  '--card-accent': feature.accent,
                }}
                onMouseEnter={() => setHoveredFeature(i)}
                onMouseLeave={() => setHoveredFeature(null)}
              >
                <div className="pg-feature-card-icon">{feature.icon}</div>
                <div className="pg-feature-card-top">
                  <span className="pg-feature-tag-new">{feature.tag}</span>
                  <span className="pg-feature-stat-new">
                    <strong>{feature.stat}</strong>
                    <em>{feature.statLabel}</em>
                  </span>
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.copy}</p>
                <div className="pg-feature-accent-bar" />
              </article>
            ))}
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section
          id="workflow"
          ref={flowRef}
          className={`pg-landing-workflow-section ${flowVisible ? 'is-revealed' : ''}`}
        >
          <div className="pg-section-tag">How It Works</div>
          <h2 className="pg-landing-section-title">Simple workflow from scan to action</h2>
          <div className="pg-landing-workflow-grid">
            <div className="pg-landing-workflow-steps">
              {flowSteps.map((step, index) => (
                <button
                  key={step.num}
                  type="button"
                  className={`pg-landing-step-new ${selectedStep === index ? 'is-active' : ''}`}
                  onClick={() => setSelectedStep(index)}
                >
                  <span className="pg-step-num-new">{step.num}</span>
                  <div className="pg-step-body-new">
                    <h3>{step.icon} {step.title}</h3>
                    <p>{step.desc}</p>
                  </div>
                  {selectedStep === index && <div className="pg-step-active-bar" />}
                  <span className="pg-step-chevron-new">›</span>
                </button>
              ))}
            </div>

            <div className="pg-landing-workflow-spotlight">
              <div className="pg-spotlight-content" key={selectedFlow.num}>
                <div className="pg-spotlight-tag-new">Step {selectedFlow.num}</div>
                <div className="pg-spotlight-big-icon">{selectedFlow.icon}</div>
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
          <div className="pg-landing-cta-glow" />
          <div className="pg-section-tag">Get Started</div>
          <h2 className="pg-landing-cta-title">Start in browser now, install when ready</h2>
          <p className="pg-landing-cta-desc">Your workflow stays identical after sign-in across both entry modes.</p>
          <div className="pg-landing-cta-buttons">
            <button className="pg-btn pg-btn-primary pg-btn-landing" onClick={onInstall}>
              <span className="pg-btn-icon">⬇</span>
              Install PadiGuard AI
            </button>
            <button className="pg-btn pg-btn-ghost pg-btn-landing" onClick={() => navigate('/auth')}>
              Sign In / Sign Up
            </button>
          </div>
        </section>

        {/* ── FOOTER ── */}
        <footer className="pg-landing-footer">
          <span className="pg-landing-footer-brand">
            <span className="pg-landing-nav-logo-dot" /> PadiGuard AI
          </span>
          <span className="pg-landing-footer-copy">© 2026 — Crop intelligence in your pocket</span>
        </footer>
      </main>
    </div>
  )
}
