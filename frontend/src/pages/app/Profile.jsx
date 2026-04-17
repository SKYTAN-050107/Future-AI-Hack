import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionContext } from '../../hooks/useSessionContext'
import { getCrops } from '../../api/crops'
import { getTreatmentPlan } from '../../api/treatment'
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
  const { logout, user, profile } = useSessionContext()
  const [crops, setCrops] = useState([])
  const [selectedCropId, setSelectedCropId] = useState('')
  const [cropSummary, setCropSummary] = useState(null)
  const [isCropLoading, setIsCropLoading] = useState(false)
  const [cropError, setCropError] = useState('')

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

      <div className="pg-profile-hero">
        <div className="pg-profile-avatar" aria-hidden="true">
          <IconUser className="pg-icon" />
        </div>
        <h2 className="pg-profile-name">{displayName}</h2>
        <p className="pg-profile-email">{email}</p>
      </div>

      <article className="pg-card">
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
            <IconChart className="pg-icon" />
            <div>
              <span className="pg-profile-detail-label">Rice Variety</span>
              <span className="pg-profile-detail-value">{variety}</span>
            </div>
          </div>
          <div className="pg-profile-detail-row">
            <IconUser className="pg-icon" />
            <div>
              <span className="pg-profile-detail-label">Language</span>
              <span className="pg-profile-detail-value">{language === 'BM' ? 'Bahasa Melayu' : language}</span>
            </div>
          </div>
        </div>
      </article>

      <article className="pg-card">
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

      <article className="pg-card">
        <h2>Account</h2>
        <p style={{ marginTop: 0 }}>You can update your farm address anytime.</p>
        <div className="pg-cta-row">
          <button type="button" className="pg-btn pg-btn-ghost" onClick={() => {
            navigate('/onboarding', { state: { fromProfile: true } })
          }}>
            Edit farm address
          </button>
          <button type="button" className="pg-btn pg-btn-primary" onClick={async () => {
            await logout()
            navigate('/auth', { replace: true })
          }}>
            Sign out
          </button>
        </div>
      </article>
    </section>
  )
}
