export default function BottomSheet({ open, title, onClose, children }) {
  if (!open) {
    return null
  }

  return (
    <div className="pg-sheet-overlay" onClick={onClose}>
      <section
        className="pg-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pg-sheet-header">
          <div className="pg-sheet-handle" aria-hidden="true" />
          <h2>{title}</h2>
          <button type="button" className="pg-btn pg-btn-ghost pg-btn-inline" onClick={onClose}>Close</button>
        </header>
        <div className="pg-sheet-body">{children}</div>
      </section>
    </div>
  )
}
