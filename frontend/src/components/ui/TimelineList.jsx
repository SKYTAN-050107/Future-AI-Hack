export default function TimelineList({ items }) {
  return (
    <ul className="pg-timeline">
      {items.map((item) => (
        <li key={item.id}>
          <div className="pg-timeline-dot" aria-hidden="true" />
          <div className="pg-timeline-body">
            <p className="pg-timeline-date">{item.date}</p>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
