import { useState } from 'react'
import SectionHeader from '../../components/ui/SectionHeader'
import BottomSheet from '../../components/ui/BottomSheet'
import SkeletonBlock from '../../components/feedback/SkeletonBlock'
import { scanDisease } from '../../api/scan'

export default function Scanner() {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [scanResult, setScanResult] = useState(null)
  const [isScanning, setIsScanning] = useState(false)

  const onCaptureScan = async () => {
    setIsScanning(true)
    const result = await scanDisease({ source: 'camera' })
    setScanResult(result)
    setIsScanning(false)
  }

  return (
    <section className="pg-page">
      <SectionHeader
        eyebrow="Leaf check"
        title="Photo a leaf"
        subtitle="Use the camera, or pick a photo if the signal is weak."
      />

      <article className="pg-scan-viewfinder">
        <div className="pg-scan-overlay">
          <p>Put the sick leaf in the frame</p>
          <small>Tip: avoid strong sun on the leaf so the photo is clear.</small>
        </div>
      </article>

      <div className="pg-scan-actions">
        <button type="button" className="pg-btn pg-btn-ghost" onClick={() => setSheetOpen(true)}>Photo source</button>
        <button type="button" className="pg-btn pg-btn-primary pg-capture-btn" onClick={onCaptureScan} disabled={isScanning}>
          {isScanning ? 'Checking…' : 'Take photo'}
        </button>
      </div>

      {isScanning ? (
        <article className="pg-card pg-skeleton-card pg-scan-result">
          <SkeletonBlock width="40%" height={13} />
          <SkeletonBlock width="100%" height={11} />
          <SkeletonBlock width="72%" height={11} />
        </article>
      ) : null}

      {scanResult ? (
        <article className="pg-card pg-scan-result">
          <h2>Latest check</h2>
          <p>{scanResult.disease} in {scanResult.zone}. Problem level about {scanResult.severity}%. Match about {scanResult.confidence}%.</p>
        </article>
      ) : null}

      <BottomSheet open={sheetOpen} title="Choose photo source" onClose={() => setSheetOpen(false)}>
        <div className="pg-sheet-actions">
          <button type="button" className="pg-btn pg-btn-ghost">Camera</button>
          <button type="button" className="pg-btn pg-btn-ghost">Gallery</button>
          <button type="button" className="pg-btn pg-btn-ghost">Last saved photo</button>
        </div>
      </BottomSheet>
    </section>
  )
}
