import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useSessionContext } from '../../hooks/useSessionContext'
import '../../styles/landing-additions.css'

export default function Auth() {
  const navigate = useNavigate()
  const { login } = useSessionContext()

  const [isLogin, setIsLogin] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState('')

  // Sign-in fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Sign-up extra fields
  const [fullName, setFullName] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Reset fields when toggling mode
  useEffect(() => {
    setEmail('')
    setPassword('')
    setFullName('')
    setConfirmPassword('')
    setShowPassword(false)
    setShowConfirmPassword(false)
    setError('')
  }, [isLogin])

  const validateEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')

    if (!email.trim()) {
      setError('Please enter your email address.')
      return
    }
    if (!validateEmail(email)) {
      setError('Please enter a valid email address.')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    if (!isLogin) {
      if (!fullName.trim()) {
        setError('Please enter your full name.')
        return
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }
    }

    setSubmitting(true)

    // Simulate auth delay
    setTimeout(() => {
      login()
      navigate('/onboarding', { replace: true })
    }, 800)
  }

  return (
    <div className="pg-auth-page">
      {/* Back button */}
      <button
        className="pg-auth-back-btn"
        onClick={() => navigate('/landing')}
        aria-label="Back to landing page"
      >
        ← Back
      </button>

      <div className="pg-auth-container">
        <div className="pg-auth-card-glass">

          {/* Sign In / Sign Up toggle */}
          <div className="pg-auth-toggle-wrapper">
            <button
              className={`pg-auth-toggle-btn ${isLogin ? 'is-active' : ''}`}
              onClick={() => setIsLogin(true)}
            >
              Sign In
            </button>
            <button
              className={`pg-auth-toggle-btn ${!isLogin ? 'is-active' : ''}`}
              onClick={() => setIsLogin(false)}
            >
              Sign Up
            </button>
          </div>

          {/* Header */}
          <div className="pg-auth-header">
            <div className="pg-auth-logo-circle">
              <span className="pg-auth-logo-text">PG</span>
            </div>
            <h1 className="pg-auth-title">
              {isLogin ? 'Welcome Back' : 'Join PadiGuard AI'}
            </h1>
            <p className="pg-auth-subtitle">
              {isLogin
                ? 'Sign in to see your farm summary and tools.'
                : 'Create an account to save your farm details.'}
            </p>
          </div>

          {/* Error banner */}
          {error && (
            <div className="pg-auth-error-banner">
              <span className="pg-auth-error-icon">⚠</span>
              <span>{error}</span>
              <button className="pg-auth-error-close" onClick={() => setError('')}>×</button>
            </div>
          )}

          {/* Form */}
          <form className="pg-auth-form" onSubmit={handleSubmit}>

            {/* Full Name (sign up only) */}
            {!isLogin && (
              <div className="pg-auth-field pg-auth-field--animate">
                <label className="pg-auth-label">Full Name</label>
                <div className="pg-auth-input-wrapper">
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Ahmad Rizal"
                    className="pg-auth-input"
                  />
                </div>
              </div>
            )}

            {/* Email */}
            <div className="pg-auth-field">
              <label className="pg-auth-label">Email</label>
              <div className="pg-auth-input-wrapper">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="pg-auth-input"
                />
              </div>
            </div>

            {/* Password */}
            <div className="pg-auth-field">
              <label className="pg-auth-label">Password</label>
              <div className="pg-auth-input-wrapper pg-auth-input-wrapper--password">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pg-auth-input"
                />
                <button
                  type="button"
                  className="pg-auth-password-eye"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            {/* Confirm Password (sign up only) */}
            {!isLogin && (
              <div className="pg-auth-field pg-auth-field--animate">
                <label className="pg-auth-label">Confirm Password</label>
                <div className="pg-auth-input-wrapper pg-auth-input-wrapper--password">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pg-auth-input"
                  />
                  <button
                    type="button"
                    className="pg-auth-password-eye"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
            )}

            {/* Forgot password (sign in only) */}
            {isLogin && (
              <div className="pg-auth-forgot-row">
                <button type="button" className="pg-auth-forgot-btn">
                  Forgot password?
                </button>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              className="pg-auth-submit-btn"
              disabled={submitting}
            >
              {submitting
                ? (isLogin ? 'Signing In…' : 'Creating Account…')
                : (isLogin ? 'Sign In' : 'Create Account')
              }
            </button>
          </form>

          {/* Divider */}
          <div className="pg-auth-divider">
            <span>or continue with</span>
          </div>

          {/* Social auth — neutral style, no brand colors */}
          <div className="pg-auth-social-row">
            <button type="button" className="pg-auth-social-btn" title="Sign in with Google">
              <span className="pg-auth-social-label">Google</span>
            </button>
            <button type="button" className="pg-auth-social-btn" title="Sign in with Apple">
              <span className="pg-auth-social-label">Apple</span>
            </button>
          </div>

          {/* Footer toggle */}
          <div className="pg-auth-footer-toggle">
            <p>
              {isLogin ? "New here? " : "Already a member? "}
              <button
                className="pg-auth-switch-btn"
                onClick={() => setIsLogin(!isLogin)}
              >
                {isLogin ? 'Create account' : 'Sign in'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
