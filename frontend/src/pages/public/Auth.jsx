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
      {/* Decorative background */}
      <div className="pg-auth-bg-orb pg-auth-bg-orb--1" aria-hidden="true" />
      <div className="pg-auth-bg-orb pg-auth-bg-orb--2" aria-hidden="true" />

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
                ? 'Sign in to access your dashboard'
                : 'Start your smart farming journey today'}
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

          {/* Social auth */}
          <div className="pg-auth-social-row">
            <button className="pg-auth-social-btn" title="Sign in with Google">
              <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/><path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/><path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/><path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/></svg>
            </button>
            <button className="pg-auth-social-btn" title="Sign in with Apple">
              🍎
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
