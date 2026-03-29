export default function SectionHeader({
  title,
  action,
  leadingAction,
  align = 'center',
}) {
  return (
    <header className={`pg-section-header ${align === 'left' ? 'is-left' : 'is-center'}`}>
      <div className="pg-section-leading-action">{leadingAction}</div>
      <h1 className="pg-page-title">{title}</h1>
      <div className="pg-section-action">{action}</div>
    </header>
  )
}
