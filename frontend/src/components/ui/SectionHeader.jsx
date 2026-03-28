export default function SectionHeader({ eyebrow, title, subtitle, action }) {
  return (
    <header className="pg-section-header">
      <div>
        {eyebrow ? <p className="pg-eyebrow">{eyebrow}</p> : null}
        <h1 className="pg-page-title">{title}</h1>
        {subtitle ? <p className="pg-page-copy">{subtitle}</p> : null}
      </div>
      {action ? <div className="pg-section-action">{action}</div> : null}
    </header>
  )
}
