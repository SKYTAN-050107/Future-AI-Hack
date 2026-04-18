import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  IconApple,
  IconEye,
  IconEyeOff,
  IconGoogle,
  IconPhone,
} from '../../components/icons/UiIcons'
import {
  createUserProfile,
  getUserProfile,
} from '../../services/userProfile'
import {
  confirmPhoneOtp,
  isCredentialNewUser,
  sendResetPassword,
  signInWithAppleProvider,
  signInWithEmail,
  signInWithGoogleProvider,
  signOutCurrentUser,
  signUpWithEmail,
  startPhoneAuth,
} from '../../services/auth'
import '../../styles/landing-additions.css'

function toFriendlyAuthError(error) {
  const code = error?.code || ''

  switch (code) {
    case 'auth/email-already-in-use':
      return 'This email is already registered. Please sign in instead.'
    case 'auth/invalid-email':
      return 'Please enter a valid email address.'
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 6 characters.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.'
    case 'auth/popup-closed-by-user':
      return 'Sign-in was cancelled before completion.'
    case 'auth/popup-blocked':
      return 'Popup was blocked. Please allow popups and try again.'
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled in Firebase Console yet.'
    case 'auth/missing-phone-number':
      return 'Please enter a valid phone number with country code, like +60123456789.'
    case 'auth/invalid-verification-code':
      return 'OTP code is invalid. Please try again.'
    case 'auth/code-expired':
      return 'OTP code expired. Request a new one.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait and try again shortly.'
    default:
      return error?.message || 'Unable to continue authentication right now.'
  }
}

export default function Auth() {
  const navigate = useNavigate()

  const [isLogin, setIsLogin] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [socialSubmitting, setSocialSubmitting] = useState('')
  const [selectedMethod, setSelectedMethod] = useState('none')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState('')

  // Sign-in fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Sign-up extra fields
  const [fullName, setFullName] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Phone auth fields
  const [phoneNumber, setPhoneNumber] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpSent, setOtpSent] = useState(false)
  const [phoneSubmitting, setPhoneSubmitting] = useState(false)
  const [confirmationResult, setConfirmationResult] = useState(null)
  const [info, setInfo] = useState('')

  // Reset fields when toggling mode
  useEffect(() => {
    setEmail('')
    setPassword('')
    setFullName('')
    setConfirmPassword('')
    setShowPassword(false)
    setShowConfirmPassword(false)
    setError('')
    setInfo('')
    setSelectedMethod('none')
    setPhoneNumber('')
    setOtpCode('')
    setOtpSent(false)
    setConfirmationResult(null)
  }, [isLogin])

  const validateEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
  const validatePhone = (phone) => /^\+[1-9]\d{7,14}$/.test(phone)

  const goAfterAuth = () => {
    // Re-enter auth route without state so central redirect logic can resolve
    // onboarding and intended app destination consistently.
    navigate('/auth', { replace: true })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setInfo('')

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

    try {
      if (isLogin) {
        await signInWithEmail(email.trim(), password)
        goAfterAuth()
      } else {
        const credential = await signUpWithEmail(email.trim(), password, fullName)
        await createUserProfile(credential.user, {
          displayName: fullName.trim() || credential.user.displayName || null,
        })
        goAfterAuth()
      }
    } catch (submitError) {
      setError(toFriendlyAuthError(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setError('')
    setInfo('')
    setSocialSubmitting('google')

    try {
      const credential = await signInWithGoogleProvider()
      if (isLogin) {
        const profile = await getUserProfile(credential.user.uid)
        if (!profile || isCredentialNewUser(credential)) {
          await signOutCurrentUser()
          setError('Google account not registered yet. Switch to Sign Up first.')
          return
        }
        goAfterAuth()
      } else {
        await createUserProfile(credential.user)
        goAfterAuth()
      }
    } catch (providerError) {
      setError(toFriendlyAuthError(providerError))
    } finally {
      setSocialSubmitting('')
    }
  }

  const handleAppleSignIn = async () => {
    setError('')
    setInfo('')
    setSocialSubmitting('apple')

    try {
      const credential = await signInWithAppleProvider()
      if (isLogin) {
        const profile = await getUserProfile(credential.user.uid)
        if (!profile || isCredentialNewUser(credential)) {
          await signOutCurrentUser()
          setError('Apple account not registered yet. Switch to Sign Up first.')
          return
        }
        goAfterAuth()
      } else {
        await createUserProfile(credential.user)
        goAfterAuth()
      }
    } catch (providerError) {
      setError(toFriendlyAuthError(providerError))
    } finally {
      setSocialSubmitting('')
    }
  }

  const handleForgotPassword = async () => {
    setError('')
    setInfo('')

    if (!validateEmail(email)) {
      setError('Enter your email first, then tap Forgot password again.')
      return
    }

    try {
      await sendResetPassword(email.trim())
      setInfo('Password reset email sent. Check your inbox.')
    } catch (resetError) {
      setError(toFriendlyAuthError(resetError))
    }
  }

  const handleSendOtp = async () => {
    setError('')
    setInfo('')

    if (!validatePhone(phoneNumber.trim())) {
      setError('Use international format, for example +60123456789.')
      return
    }

    setPhoneSubmitting(true)

    try {
      const result = await startPhoneAuth(phoneNumber.trim(), 'recaptcha-container')
      setConfirmationResult(result)
      setOtpSent(true)
      setInfo('OTP sent. Enter the 6-digit code to continue.')
    } catch (phoneError) {
      setError(toFriendlyAuthError(phoneError))
    } finally {
      setPhoneSubmitting(false)
    }
  }

  const handleVerifyOtp = async () => {
    setError('')
    setInfo('')

    if (!otpCode.trim()) {
      setError('Please enter the OTP code.')
      return
    }

    setPhoneSubmitting(true)

    try {
      const credential = await confirmPhoneOtp(confirmationResult, otpCode.trim())
      if (isLogin) {
        const profile = await getUserProfile(credential.user.uid)
        if (!profile || isCredentialNewUser(credential)) {
          await signOutCurrentUser()
          setError('Phone number not registered yet. Switch to Sign Up first.')
          return
        }
        goAfterAuth()
      } else {
        await createUserProfile(credential.user)
        goAfterAuth()
      }
    } catch (verifyError) {
      setError(toFriendlyAuthError(verifyError))
    } finally {
      setPhoneSubmitting(false)
    }
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
            <div className="pg-auth-logo-circle" style={{ overflow: 'hidden', border: 'none', background: 'transparent' }}>
              <img src="/futurehack.png" alt="AcreZen" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
            <h1 className="pg-auth-title">
              {isLogin ? 'Welcome Back' : 'Join AcreZen'}
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

          {info ? (
            <div className="pg-auth-error-banner" style={{ borderColor: 'rgba(33, 150, 83, 0.28)' }}>
              <span>{info}</span>
              <button className="pg-auth-error-close" onClick={() => setInfo('')}>×</button>
            </div>
          ) : null}

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
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <IconEyeOff className="pg-icon" /> : <IconEye className="pg-icon" />}
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
                    aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    tabIndex={-1}
                  >
                    {showConfirmPassword ? <IconEyeOff className="pg-icon" /> : <IconEye className="pg-icon" />}
                  </button>
                </div>
              </div>
            )}

            {/* Forgot password (sign in only) */}
            {isLogin && (
              <div className="pg-auth-forgot-row">
                <button type="button" className="pg-auth-forgot-btn" onClick={handleForgotPassword}>
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
            <span>or choose a method</span>
          </div>

          {/* Provider auth methods */}
          <div className="pg-auth-social-row">
            <button
              type="button"
              className="pg-auth-social-btn"
              title="Sign in with Google"
              onClick={handleGoogleSignIn}
              disabled={socialSubmitting.length > 0 || phoneSubmitting}
            >
              <IconGoogle className="pg-icon" />
              <span className="pg-auth-social-label">{socialSubmitting === 'google' ? 'Connecting…' : 'Google'}</span>
            </button>
            <button
              type="button"
              className="pg-auth-social-btn"
              title="Sign in with Apple"
              onClick={handleAppleSignIn}
              disabled={socialSubmitting.length > 0 || phoneSubmitting}
            >
              <IconApple className="pg-icon" />
              <span className="pg-auth-social-label">{socialSubmitting === 'apple' ? 'Connecting…' : 'Apple'}</span>
            </button>
            <button
              type="button"
              className="pg-auth-social-btn"
              title="Sign in with phone"
              onClick={() => {
                setSelectedMethod('phone')
                setError('')
                setInfo('Enter your number to receive an OTP code.')
              }}
              disabled={socialSubmitting.length > 0}
            >
              <IconPhone className="pg-icon" />
              <span className="pg-auth-social-label">Phone</span>
            </button>
          </div>

          {selectedMethod === 'phone' ? (
            <>
              <div className="pg-auth-divider">
                <span>Phone verification</span>
              </div>

              <div className="pg-auth-form">
                <div className="pg-auth-field">
                  <label className="pg-auth-label">Phone number</label>
                  <div className="pg-auth-input-wrapper">
                    <input
                      type="tel"
                      value={phoneNumber}
                      onChange={(event) => setPhoneNumber(event.target.value)}
                      placeholder="+60123456789"
                      className="pg-auth-input"
                    />
                  </div>
                </div>

                {otpSent ? (
                  <div className="pg-auth-field pg-auth-field--animate">
                    <label className="pg-auth-label">OTP code</label>
                    <div className="pg-auth-input-wrapper">
                      <input
                        type="text"
                        value={otpCode}
                        onChange={(event) => setOtpCode(event.target.value)}
                        placeholder="6-digit code"
                        className="pg-auth-input"
                      />
                    </div>
                  </div>
                ) : null}

                <div className="pg-cta-row">
                  {!otpSent ? (
                    <button type="button" className="pg-auth-submit-btn" onClick={handleSendOtp} disabled={phoneSubmitting}>
                      {phoneSubmitting ? 'Sending code…' : 'Send OTP'}
                    </button>
                  ) : (
                    <>
                      <button type="button" className="pg-btn pg-btn-ghost" onClick={handleSendOtp} disabled={phoneSubmitting}>
                        Resend OTP
                      </button>
                      <button type="button" className="pg-auth-submit-btn" onClick={handleVerifyOtp} disabled={phoneSubmitting}>
                        {phoneSubmitting ? 'Verifying…' : 'Verify and continue'}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="pg-btn pg-btn-ghost"
                    onClick={() => {
                      setSelectedMethod('none')
                      setPhoneNumber('')
                      setOtpCode('')
                      setOtpSent(false)
                      setConfirmationResult(null)
                      setInfo('')
                      setError('')
                    }}
                    disabled={phoneSubmitting}
                  >
                    Cancel phone method
                  </button>
                </div>
              </div>
            </>
          ) : null}

          <div id="recaptcha-container" />

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
