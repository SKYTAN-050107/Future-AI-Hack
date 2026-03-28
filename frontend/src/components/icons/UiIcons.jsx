/**
 * Monochrome UI icons — stroke style, inherit color via currentColor.
 * Use with className="pg-icon" from parent for size.
 */

const stroke = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

function Svg({ children, className, ...rest }) {
  return (
    <svg {...stroke} className={className} aria-hidden="true" {...rest}>
      {children}
    </svg>
  )
}

export function IconHome({ className }) {
  return (
    <Svg className={className}>
      <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9.5z" />
    </Svg>
  )
}

export function IconMap({ className }) {
  return (
    <Svg className={className}>
      <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
      <path d="M9 4v14" />
      <path d="M15 6v14" />
    </Svg>
  )
}

export function IconCamera({ className }) {
  return (
    <Svg className={className}>
      <path d="M4 8h3l2-2h6l2 2h3a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" />
      <circle cx="12" cy="14" r="3.5" />
    </Svg>
  )
}

export function IconList({ className }) {
  return (
    <Svg className={className}>
      <path d="M8 6h13M8 12h13M8 18h13M4 6h.01M4 12h.01M4 18h.01" />
    </Svg>
  )
}

export function IconUser({ className }) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20v-1a7 7 0 0 1 14 0v1" />
    </Svg>
  )
}

export function IconDownload({ className }) {
  return (
    <Svg className={className}>
      <path d="M12 4v11" />
      <path d="M8 12l4 4 4-4" />
      <path d="M5 20h14" />
    </Svg>
  )
}

export function IconMicroscope({ className }) {
  return (
    <Svg className={className}>
      <path d="M6 18h12M9 18V9a3 3 0 0 1 6 0v9" />
      <path d="M8 14h8" />
      <circle cx="12" cy="6" r="2" />
    </Svg>
  )
}

export function IconChart({ className }) {
  return (
    <Svg className={className}>
      <path d="M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6" />
    </Svg>
  )
}

export function IconCloud({ className }) {
  return (
    <Svg className={className}>
      <path d="M7 18h9a4 4 0 0 0 0-8 1 1 0 0 0-1-1 5 5 0 0 0-9.7 1.5A3 3 0 0 0 7 18z" />
    </Svg>
  )
}

export function IconClipboard({ className }) {
  return (
    <Svg className={className}>
      <path d="M9 4h6a1 1 0 0 1 1 1v16H8V5a1 1 0 0 1 1-1z" />
      <path d="M10 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
      <path d="M10 12h4M10 16h4" />
    </Svg>
  )
}
