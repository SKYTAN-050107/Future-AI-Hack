export default function SectionHeader({ eyebrow, title, subtitle, action, leadingAction }) {
  return (
    <header className="pg-section-header">
      {leadingAction ? <div className="pg-section-leading-action">{leadingAction}</div> : null}
      <div>
        {eyebrow ? <p className="pg-eyebrow">{eyebrow}</p> : null}
        <h1 className="pg-page-title">{title}</h1>
        {subtitle ? <p className="pg-page-copy">{subtitle}</p> : null}
      </div>
      {action ? <div className="pg-section-action">{action}</div> : null}
    </header>
  )
}
