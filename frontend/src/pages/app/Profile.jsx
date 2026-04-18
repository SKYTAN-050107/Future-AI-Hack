import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionContext } from '../../hooks/useSessionContext'
import { getCrops } from '../../api/crops'
import { getTreatmentPlan } from '../../api/treatment'
import { geocodeLocation } from '../../services/locationResolver'
import { signOutCurrentUser } from '../../services/auth'
import { saveActiveCropSelection } from '../../services/userProfile'
import SectionHeader from '../../components/ui/SectionHeader'
import { IconUser, IconMap, IconSprout, IconChart } from '../../components/icons/UiIcons'

function toSafeNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeCrop(rawCrop) {
  return {
    id: String(rawCrop?.id || ''),
    name: String(rawCrop?.name || 'Unnamed Crop'),
    expectedYieldKg: toSafeNumber(rawCrop?.expected_yield_kg, 0),
    status: String(rawCrop?.status || 'growing').trim().toLowerCase() || 'growing',
  }
}

function formatRoiLabel(plan) {
  const roiPercent = Number(plan?.roi_percent)
  if (Number.isFinite(roiPercent)) {
    return `${roiPercent.toFixed(1)}%`
  }

  if (plan?.roi_note === 'infinite') {
    return 'infinite'
  }

  if (plan?.roi_note === 'undefined') {
    return 'undefined'
  }

  return '--'
}

export default function Profile() {
  const navigate = useNavigate()
  const { logout, user, profile, completeOnboarding } = useSessionContext()
  const [crops, setCrops] = useState([])
  const [selectedCropId, setSelectedCropId] = useState('')
  const [cropSummary, setCropSummary] = useState(null)
  const [isCropLoading, setIsCropLoading] = useState(false)
  const [cropError, setCropError] = useState('')
  const [isEditAddressOpen, setIsEditAddressOpen] = useState(false)
  const [editFarmName, setEditFarmName] = useState('')
  const [editLocation, setEditLocation] = useState('')
  const [editLanguage, setEditLanguage] = useState('BM')
  const [isSavingFarmDetails, setIsSavingFarmDetails] = useState(false)
  const [editFarmFeedback, setEditFarmFeedback] = useState('')
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Farmer'
  const email = user?.email || 'Not signed in'
  const farmName = profile?.onboarding?.farmName || 'My Farm'
  const variety = profile?.onboarding?.variety || 'Not set'
  const location = profile?.onboarding?.locationLabel || profile?.onboarding?.location || 'Not set'
  const language = profile?.onboarding?.language || 'BM'
  const userId = String(user?.uid || '').trim()

  const selectedCrop = useMemo(
    () => crops.find((item) => item.id === selectedCropId) || null,
    [crops, selectedCropId],
  )

  const canSaveFarmDetails =
    editFarmName.trim().length > 2 &&
    editLocation.trim().length > 5 &&
    editLanguage.trim().length > 0

  function openEditFarmDetailsModal() {
    setEditFarmName(farmName === 'My Farm' ? '' : farmName)
    setEditLocation(location === 'Not set' ? '' : location)
    setEditLanguage(language)
    setEditFarmFeedback('')
    setIsEditAddressOpen(true)
  }

  function closeEditFarmDetailsModal() {
    setIsEditAddressOpen(false)
    setEditFarmFeedback('')
  }

  async function handleSaveFarmDetails(event) {
    event.preventDefault()

    if (!canSaveFarmDetails || isSavingFarmDetails) {
      return
    }

    setIsSavingFarmDetails(true)
    setEditFarmFeedback('')

    try {
      const trimmedLocation = editLocation.trim()
      let resolvedLocation = null

      if (trimmedLocation) {
        try {
          resolvedLocation = await geocodeLocation(trimmedLocation)
        } catch {
          resolvedLocation = null
        }
      }

      const result = await completeOnboarding({
        farmName: editFarmName.trim(),
        location: trimmedLocation,
        locationLabel: resolvedLocation?.label || trimmedLocation,
        locationLat: resolvedLocation?.lat ?? null,
        locationLng: resolvedLocation?.lng ?? null,
        locationSource: resolvedLocation ? 'geocoded' : 'manual',
        variety: String(profile?.onboarding?.variety || '').trim() || null,
        language: editLanguage,
      })

      if (result?.persisted === false) {
        setEditFarmFeedback('Saved locally. Cloud sync will retry when connection is ready.')
        return
      }

      closeEditFarmDetailsModal()
    } catch (error) {
      setEditFarmFeedback(error?.message || 'Unable to save farm details right now. Please try again.')
    } finally {
      setIsSavingFarmDetails(false)
    }
  }

  async function handleSignOut() {
    if (isSigningOut) {
      return
    }

    setIsSigningOut(true)
    setSignOutError('')

    try {
      await logout()
      navigate('/auth', { replace: true })
    } catch (error) {
      try {
        // Frontend-only fallback if context logout fails transiently.
        await signOutCurrentUser()
        navigate('/auth', { replace: true })
      } catch {
        setSignOutError(error?.message || 'Unable to sign out right now. Please try again.')
      }
    } finally {
      setIsSigningOut(false)
    }
  }

  useEffect(() => {
    let active = true

    if (!userId) {
      setCrops([])
      setSelectedCropId('')
      return undefined
    }

    setIsCropLoading(true)
    setCropError('')

    getCrops({ userId })
      .then((response) => {
        if (!active) {
          return
        }

        const nextCrops = Array.isArray(response?.items)
          ? response.items.map(normalizeCrop)
          : []

        setCrops(nextCrops)

        const preferredCropId = String(profile?.activeCropId || '').trim()
        if (preferredCropId && nextCrops.some((item) => item.id === preferredCropId)) {
          setSelectedCropId(preferredCropId)
          return
        }

        setSelectedCropId(nextCrops[0]?.id || '')
      })
      .catch((error) => {
        if (!active) {
          return
        }

        setCrops([])
        setSelectedCropId('')
        setCropError(error?.message || 'Unable to load crop summary')
      })
      .finally(() => {
        if (active) {
          setIsCropLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [profile?.activeCropId, userId])

  useEffect(() => {
    if (!userId || !selectedCropId) {
      setCropSummary(null)
      return
    }

    let active = true
    setCropSummary(null)

    getTreatmentPlan({
      userId,
      cropId: selectedCropId,
      sellingChannel: 'middleman',
      marketCondition: 'normal',
    })
      .then((response) => {
        if (active) {
          setCropSummary(response)
        }
      })
      .catch(() => {
        if (active) {
          setCropSummary(null)
        }
      })

    return () => {
      active = false
    }
  }, [selectedCropId, userId])

  useEffect(() => {
    if (!userId || !selectedCropId) {
      return
    }

    saveActiveCropSelection(userId, selectedCropId).catch(() => {
      // Keep profile UX responsive even if persistence is temporarily unavailable.
    })
  }, [selectedCropId, userId])

  return (
    <section className="pg-page">
      <SectionHeader
        title="Profile"
        align="center"
      />

      <div className="pg-profile-hero pg-ios-glass-bg pg-profile-hero-glass">
        <div className="pg-profile-avatar pg-glass-panel" aria-hidden="true">
          <IconUser className="pg-icon pg-avatar-icon" />
        </div>
        <h2 className="pg-profile-name pg-glass-text">{displayName}</h2>
        <p className="pg-profile-email pg-glass-text">{email}</p>
        <div className="pg-cta-row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="pg-btn pg-btn-primary pg-btn-inline pg-profile-signout-btn"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
        {signOutError ? (
          <p style={{ margin: '8px 0 0', fontSize: '0.8rem', color: 'var(--danger)' }}>{signOutError}</p>
        ) : null}
      </div>

      <article className="pg-card pg-glass-panel pg-profile-card">
        <h2>Farm Details</h2>
        <div className="pg-profile-details">
          <div className="pg-profile-detail-row">
            <IconSprout className="pg-icon" />
            <div>
              <span className="pg-profile-detail-label">Farm Name</span>
              <span className="pg-profile-detail-value">{farmName}</span>
            </div>
          </div>
          <div className="pg-profile-detail-row">
            <IconMap className="pg-icon" />
            <div>
              <span className="pg-profile-detail-label">Farm address</span>
              <span className="pg-profile-detail-value">{location}</span>
            </div>
          </div>

          <div className="pg-profile-detail-row">
            <IconUser className="pg-icon" />
            <div>
              <span className="pg-profile-detail-label">Language</span>
              <span className="pg-profile-detail-value">{language === 'BM' ? 'Bahasa Melayu' : language}</span>
            </div>
          </div>

          <div className="pg-profile-detail-actions">
            <button
              type="button"
              className="pg-btn pg-btn-ghost pg-profile-edit-address-btn"
              onClick={openEditFarmDetailsModal}
            >
              Edit farm details
            </button>
          </div>
        </div>
      </article>

      <article className="pg-card pg-glass-panel pg-profile-card">
        <h2>Crop Summary</h2>

        {cropError ? <p>{cropError}</p> : null}

        <label className="pg-field-label" htmlFor="pg-profile-crop-select">Selected crop</label>
        <select
          id="pg-profile-crop-select"
          className="pg-input"
          value={selectedCropId}
          onChange={(event) => setSelectedCropId(event.target.value)}
          disabled={isCropLoading || crops.length === 0}
        >
          {crops.length === 0 ? (
            <option value="">No crops yet</option>
          ) : (
            crops.map((crop) => (
              <option key={crop.id} value={crop.id}>{crop.name}</option>
            ))
          )}
        </select>

        <p style={{ marginTop: 10 }}>
          {selectedCrop
            ? `Yield: ${selectedCrop.expectedYieldKg.toFixed(1)}kg | ROI: ${formatRoiLabel(cropSummary)} | Status: ${selectedCrop.status}`
            : 'Add your first crop to unlock crop-level ROI and inventory planning.'}
        </p>

        <div className="pg-cta-row">
          <button
            type="button"
            className="pg-btn pg-btn-primary"
            onClick={() => navigate('/app/crops')}
          >
            Manage Crops
          </button>
        </div>
      </article>

      {/* Edit Farm Details Slide-up Modal */}
      {isEditAddressOpen && (
        <div className="pg-modal-backdrop" onClick={closeEditFarmDetailsModal}>
          <div className="pg-modal-drawer pg-modal-drawer-themed" onClick={(e) => e.stopPropagation()}>
            <div className="pg-modal-close-bar" onClick={closeEditFarmDetailsModal}></div>
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>Edit Farm Details</h2>
            <p style={{ margin: '0 0 20px', fontSize: '0.88rem', opacity: 0.7 }}>
              Update your farm details here. Changes will be saved without leaving this page.
            </p>

            <form onSubmit={handleSaveFarmDetails}>
              <label className="pg-field-label" htmlFor="pg-edit-farm-name">Farm Name</label>
              <input
                id="pg-edit-farm-name"
                className="pg-input"
                type="text"
                value={editFarmName}
                onChange={(event) => setEditFarmName(event.target.value)}
                placeholder="Kampung Seri Murni Plot"
              />

              <label className="pg-field-label" htmlFor="pg-edit-farm-location">Farm address</label>
              <input
                id="pg-edit-farm-location"
                className="pg-input"
                type="text"
                value={editLocation}
                onChange={(event) => setEditLocation(event.target.value)}
                placeholder="Lot, village, district, state"
              />

              <label className="pg-field-label" htmlFor="pg-edit-farm-language">Language</label>
              <select
                id="pg-edit-farm-language"
                className="pg-input"
                value={editLanguage}
                onChange={(event) => setEditLanguage(event.target.value)}
              >
                <option value="BM">Bahasa Melayu</option>
                <option value="EN">English</option>
              </select>

              {editFarmFeedback ? (
                <p style={{ marginTop: 12, marginBottom: 0, color: 'var(--danger)' }}>{editFarmFeedback}</p>
              ) : null}

              <div className="pg-cta-row" style={{ flexDirection: 'column', gap: 12 }}>
                <button
                  type="submit"
                  className="pg-btn pg-btn-primary"
                  style={{ width: '100%' }}
                  disabled={!canSaveFarmDetails || isSavingFarmDetails}
                >
                  {isSavingFarmDetails ? 'Saving...' : 'Save Farm Details'}
                </button>
                <button
                  type="button"
                  className="pg-btn pg-btn-ghost"
                  style={{ width: '100%' }}
                  onClick={closeEditFarmDetailsModal}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  )
}
