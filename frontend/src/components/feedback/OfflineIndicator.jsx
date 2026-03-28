export default function OfflineIndicator({ isOnline }) {
  return (
    <div className={`pg-offline-indicator ${isOnline ? 'is-online' : 'is-offline'}`} role="status" aria-live="polite">
      <span className="pg-offline-dot" aria-hidden="true" />
      <span>{isOnline ? 'Connected' : 'Offline — changes save on your phone first'}</span>
    </div>
  )
}
