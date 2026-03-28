export default function OfflineIndicator({ isOnline }) {
  return (
    <div className={`pg-offline-indicator ${isOnline ? 'is-online' : 'is-offline'}`} role="status" aria-live="polite">
      <span className="pg-offline-dot" aria-hidden="true" />
      <span>{isOnline ? 'Online sync active' : 'Offline mode: changes will sync later'}</span>
    </div>
  )
}
