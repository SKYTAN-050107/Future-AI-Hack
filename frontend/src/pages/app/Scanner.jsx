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
        eyebrow="AI Scanner"
        title="Capture Crop Condition"
        subtitle="Use camera first, with upload fallback for lower-connectivity sessions."
      />

      <article className="pg-scan-viewfinder">
        <div className="pg-scan-overlay">
          <p>Align affected leaf in frame</p>
          <small>Lighting tip: avoid direct sun glare on leaf surface</small>
        </div>
      </article>

      <div className="pg-scan-actions">
        <button className="pg-btn pg-btn-ghost" onClick={() => setSheetOpen(true)}>Choose Source</button>
        <button className="pg-btn pg-btn-primary pg-capture-btn" onClick={onCaptureScan} disabled={isScanning}>
          {isScanning ? 'Scanning...' : 'Capture Scan'}
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
          <h2>Latest Result</h2>
          <p>{scanResult.disease} detected in {scanResult.zone}. Severity {scanResult.severity}% with {scanResult.confidence}% confidence.</p>
        </article>
      ) : null}

      <BottomSheet open={sheetOpen} title="Select Input Source" onClose={() => setSheetOpen(false)}>
        <div className="pg-sheet-actions">
          <button className="pg-btn pg-btn-ghost">Use Camera</button>
          <button className="pg-btn pg-btn-ghost">Upload from Gallery</button>
          <button className="pg-btn pg-btn-ghost">Use Cached Last Image</button>
        </div>
      </BottomSheet>
    </section>
  )
}
